"""Matrice de similarité entre jeux : calcule chaque critère du matcher pour
toutes les paires, plus une piste de gameplay pondéré. Lecture seule sur le snapshot.

    .venv/bin/python similarity_matrix.py /chemin/sortie.npz
"""
from __future__ import annotations

import pickle
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

import baseline.matcher as M
from snapshot import load_snapshot

# La page compare l'ancien score aux tags pondérés : elle garde les anciens poids.
AXES = list(M.PREVIOUS_SIMILARITY_WEIGHTS)
TAG_POS_DECAY = 0.15  # un tag perd de son poids à mesure qu'il descend dans la liste Steam
GENRE_WEIGHT = 0.5  # le genre boutique pèse moins qu'un tag communautaire


def scores(a: M.Features, b: M.Features) -> list[float]:
    return [
        M.gameplay_type_similarity(a.steam_tags, a.genres, b.steam_tags, b.genres),
        M.homegrown_rank_similarity(a.rank, b.rank),
        M.publisher_match(a.publisher_id, a.publisher, b.publisher_id, b.publisher),
        M.identity_match(M._norm_name(a.developer), M._norm_name(b.developer)),
        M.era_similarity(a.release_era, b.release_era),
        1.0,  # scaleBucket : le resolver ne passe jamais de scaleHint, axe constant en prod
        M.platform_jaccard(a.platforms, b.platforms),
        M.dlc_tier_similarity(a.dlc_tier, b.dlc_tier),
        M.identity_match(a.franchise_slug, b.franchise_slug),
        1.0 if a.live_service == b.live_service else 0.0,
        M.track_record_similarity(a.track_record, b.track_record),
        1.0 if a.is_annual_iteration == b.is_annual_iteration else 0.0,
        M.playtime_similarity(a.playtime, b.playtime),
    ]


def weighted_gameplay(feats: list[M.Features]) -> np.ndarray:
    """Cosinus sur tous les tags, pondérés par rareté (IDF) et par rang Steam."""
    df: Counter = Counter()
    for f in feats:
        df.update(set(f.steam_tags) | set(f.genres))
    n = len(feats)
    vocab = {t: i for i, t in enumerate(df)}
    idf = np.array([np.log(1 + n / df[t]) for t in vocab])
    X = np.zeros((n, len(vocab)), dtype=np.float32)
    for i, f in enumerate(feats):
        for pos, t in enumerate(f.steam_tags):
            X[i, vocab[t]] = idf[vocab[t]] / (1 + TAG_POS_DECAY * pos)
        for t in f.genres:
            j = vocab[t]
            X[i, j] = max(X[i, j], idf[j] * GENRE_WEIGHT)
    X /= np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-9)
    return X @ X.T


def main(out: Path) -> None:
    snap = load_snapshot()
    m = M.Matcher(snap.games, snap.reference_profiles, snap.track_record, snap.game_rank, snap.signals)
    g = snap.games[snap.games.deletedAt.isna()]
    anchors = {a.game_id for a in m.corpus}
    tagged = g[g.steamTags.map(lambda x: len(M.parse_text_array(x, trim=True)) > 0)].id
    ids = sorted(anchors | set(tagged))
    feats = [m.target_features(i) for i in ids]
    n = len(ids)
    print(f"{n} jeux ({len(anchors)} ancres)", flush=True)

    S = np.zeros((len(AXES), n, n), dtype=np.float32)
    for i in range(n):
        for j in range(i, n):
            S[:, i, j] = S[:, j, i] = scores(feats[i], feats[j])
        if i % 200 == 0:
            print(i, flush=True)

    # Parité avec le matcher du site sur un échantillon de paires.
    w = np.array([M.PREVIOUS_SIMILARITY_WEIGHTS[a] for a in AXES])
    rng = np.random.default_rng(0)
    for i, j in rng.integers(0, n, (2000, 2)):
        assert abs(w @ S[:, i, j] - M.previous_similarity(feats[i], feats[j])) < 1e-5

    modes = np.array([f.play_mode for f in feats])
    same_mode = modes[:, None] == modes[None, :]
    overlap = np.array([[bool(a.platforms & b.platforms) for b in feats] for a in feats])
    reviews = snap.signals[snap.signals.metric == "STEAM_REVIEWS"].groupby("gameId").value.max()
    meta = {
        "ids": ids,
        "feats": feats,
        "anchors": anchors,
        "reviews": {i: float(reviews.get(i, 0)) for i in ids},
        "names": dict(zip(g.id, g.name)),
        "profiles": snap.reference_profiles.set_index("gameId")[["reviewsToUnits", "globalReviewsToUnits", "curveM1", "qualityScore"]],
        "snapshot": snap.path.name,
    }
    np.savez_compressed(out, S=S, W=weighted_gameplay(feats), same_mode=same_mode, overlap=overlap)
    with open(out.with_suffix(".pkl"), "wb") as f:
        pickle.dump(meta, f)
    print("écrit", out, flush=True)

    # Les 15 voisins réellement utilisés par l'estimation (jeu retiré de son propre corpus).
    real = {}
    for i, gid in enumerate(ids):
        res = m.find_neighbours(gid, holdout_game_id=gid)
        real[gid] = [(a[0], a[1]) for a in res.anchors]
    meta["real"] = real
    with open(out.with_suffix(".pkl"), "wb") as f:
        pickle.dump(meta, f)
    print("voisins réels ok", flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))

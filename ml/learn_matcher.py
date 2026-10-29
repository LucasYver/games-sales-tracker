"""Apprendre les 13 poids de similarité du matcher à partir des données.

Les poids actuels (`SIMILARITY_WEIGHTS`) ont été posés à la main. Ici on
cherche ceux qui donnent la meilleure estimation du site (le total affiché),
avec le protocole habituel :

- Validation croisée par jeu (5 groupes) : les poids sont choisis sur 4
  groupes et jugés sur le 5e. Pendant le choix, les jeux du groupe testé sont
  AUSSI retirés des jeux de référence (ancres), pour que leurs ventes
  n'influencent pas le choix, même indirectement.
- Test dans le temps : poids choisis sur les chiffres d'avant 2025 (sans les
  ancres des jeux testés), jugés sur les chiffres 2025+ de jeux neufs.

Recherche : poids actuels, poids égaux, poids actuels avec un critère retiré
(×13), et des tirages au hasard. Chaque essai = recalcul du profil des ~630
jeux puis de l'estimation du site à chaque chiffre publié.

Pour aller vite, l'agrégation du matcher est réécrite en numpy ; avec les
poids actuels elle doit redonner exactement les profils du site (vérifié au
démarrage).

Usage (depuis ml/) :
    .venv/bin/python learn_matcher.py              # ~10 minutes
    .venv/bin/python learn_matcher.py --trials 40  # plus rapide
"""

from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import baseline.matcher as M
from backtest import to_us
from baseline import Estimator
from baseline.profile import overlay
from bench import SEED, TIME_CUTOFF, load_saved_bench, paired_gain
from metrics import add_error_columns, summarize
from snapshot import load_snapshot

REPORTS = Path(__file__).resolve().parent / "reports"
CRITERIA = list(M.SIMILARITY_WEIGHTS)
CURVE_KEYS = M.CURVE_KEYS
K = M.DEFAULT_NEIGHBOURS


def feature_scores(row: M.Features, target: M.Features) -> list[float]:
    """Les 13 scores de `matcher.similarity`, dans l'ordre de SIMILARITY_WEIGHTS."""
    s = {
        "gameplayType": M.gameplay_type_similarity(row.steam_tags, row.genres, target.steam_tags, target.genres),
        "rank": M.homegrown_rank_similarity(row.rank, target.rank),
        "publisherMatch": M.publisher_match(row.publisher_id, row.publisher, target.publisher_id, target.publisher),
        "developerMatch": M.identity_match(M._norm_name(row.developer), M._norm_name(target.developer)),
        "releaseEra": M.era_similarity(row.release_era, target.release_era),
        "scaleBucket": 1.0 if target.scale_bucket == "UNKNOWN" else M.match_or_zero(row.scale_bucket, target.scale_bucket),
        "platformsOverlap": M.platform_jaccard(row.platforms, target.platforms),
        "dlcTier": M.dlc_tier_similarity(row.dlc_tier, target.dlc_tier),
        "franchise": M.identity_match(row.franchise_slug, target.franchise_slug),
        "liveService": 1.0 if row.live_service == target.live_service else 0.0,
        "devTrackRecord": M.track_record_similarity(row.track_record, target.track_record),
        "annualIteration": 1.0 if row.is_annual_iteration == target.is_annual_iteration else 0.0,
        "playtime": M.playtime_similarity(row.playtime, target.playtime),
    }
    return [s[c] for c in CRITERIA]


class FastMatcher:
    """Le matcher du site, vectorisé pour un ensemble fixe de jeux cibles."""

    def __init__(self, est: Estimator, targets: list[str]):
        corpus = est.matcher.corpus
        self.targets = targets
        self.anchor_game = np.array([a.game_id for a in corpus])
        self.quality = np.array([a.quality_score for a in corpus])
        nan = lambda v: np.nan if v is None else v  # noqa: E731
        self.curve = np.array([[nan(a.curve[k]) for k in CURVE_KEYS] for a in corpus], dtype=float)
        self.rtu = np.array([nan(a.reviews_to_units) for a in corpus], dtype=float)
        self.grtu = np.array([nan(a.global_reviews_to_units) for a in corpus], dtype=float)
        self.pcr = np.array([nan(a.peak_ccu_ratio) for a in corpus], dtype=float)
        self.has_shares = np.array([a.platform_shares is not None for a in corpus])
        self.shares = np.array([[a.platform_shares[k] if a.platform_shares else 0.0
                                 for k in ("pc", "ps", "xbox", "switch")] for a in corpus])
        n_t, n_a = len(targets), len(corpus)
        self.S = np.zeros((n_t, n_a, len(CRITERIA)))
        self.same_mode = np.zeros((n_t, n_a), dtype=bool)
        self.overlap = np.zeros((n_t, n_a), dtype=bool)
        for i, g in enumerate(targets):
            tf = est.matcher.target_features(g)
            for j, a in enumerate(corpus):
                self.S[i, j] = feature_scores(a.features, tf)
                self.same_mode[i, j] = a.features.play_mode == tf.play_mode
                self.overlap[i, j] = bool(tf.platforms & a.features.platforms)

    @staticmethod
    def _wmean(values: np.ndarray, weights: np.ndarray) -> float | None:
        ok = np.isfinite(values) & np.isfinite(weights) & (weights > 0)
        if not ok.any():
            return None
        return float((values[ok] * weights[ok]).sum() / weights[ok].sum())

    @staticmethod
    def _log_mean(values: np.ndarray, weights: np.ndarray, reject: bool) -> float | None:
        ok = np.isfinite(values) & (values > 0)
        v, w = values[ok], weights[ok]
        if reject and len(v) >= 4:  # rejectHighOutliers (médiane non pondérée, facteur 2)
            med = float(np.median(v))
            if np.isfinite(med) and med > 0:
                kept = v <= M.REVIEWS_TO_UNITS_OUTLIER_FACTOR * med
                if kept.sum() >= 3:
                    v, w = v[kept], w[kept]
        m = FastMatcher._wmean(np.log10(v), w) if len(v) else None
        return None if m is None else 10 ** m

    def profiles(self, weights: np.ndarray, excluded_games: set[str] = frozenset()) -> dict:
        """Profil de chaque jeu cible (ancre du jeu lui-même toujours exclue)."""
        excluded = np.isin(self.anchor_game, list(excluded_games)) if excluded_games else np.zeros(len(self.anchor_game), bool)
        sims = self.S @ weights
        out = {}
        for i, g in enumerate(self.targets):
            corpus = ~excluded & (self.anchor_game != g)
            mode = corpus & self.same_mode[i]
            primary = mode & self.overlap[i]
            cand = np.where(primary if primary.sum() >= M.MIN_NEIGHBOURS
                            else mode if mode.sum() >= M.MIN_NEIGHBOURS else corpus)[0]
            s = sims[i, cand]
            order = np.argsort(-s, kind="stable")[:K]
            top, s_top = cand[order], s[order]
            w = s_top ** M.SIMILARITY_WEIGHT_EXPONENT * self.quality[top]
            curve = {k: self._wmean(self.curve[top, j], w) for j, k in enumerate(CURVE_KEYS)}
            shares = None
            hs = self.has_shares[top]
            if hs.any() and w[hs].sum() != 0:
                raw = (self.shares[top][hs] * w[hs, None]).sum(0) / w[hs].sum()
                if raw.sum() > 0:
                    raw = raw / raw.sum()
                    shares = dict(zip(("pc", "ps", "xbox", "switch"), raw.tolist()))
            match = M.MatchResult(curve=curve, reviews_to_units=self._log_mean(self.rtu[top], w, True),
                                  global_reviews_to_units=self._log_mean(self.grtu[top], w, True),
                                  peak_ccu_ratio=self._log_mean(self.pcr[top], w, False),
                                  platform_shares=shares, neighbours_used=len(top), cold_start=False)
            out[g] = overlay(match)
        return out


def log_errors(est: Estimator, rows: pd.DataFrame, profiles: dict) -> np.ndarray:
    """Erreur (log) de l'estimation du site à chaque chiffre publié, avec ces profils."""
    est._profiles.clear()
    for g, p in profiles.items():
        est._profiles[(g, g)] = p
    out = np.full(len(rows), np.nan)
    for i, r in enumerate(rows.itertuples(index=False)):
        e = est.estimate(r.gameId, to_us(r.reportedAt), holdout_game_id=r.gameId)
        if e and e.total and e.total[1] > 0:
            out[i] = math.log(sum(e.total) / 2) - math.log(r.units)
    return out


def candidates(n_random: int) -> list[tuple[str, np.ndarray]]:
    current = np.array([M.SIMILARITY_WEIGHTS[c] for c in CRITERIA])
    cands = [("poids actuels", current), ("poids égaux", np.full(len(CRITERIA), 1 / len(CRITERIA)))]
    for k, c in enumerate(CRITERIA):
        w = current.copy()
        w[k] = 0
        cands.append((f"actuels sans {c}", w / w.sum()))
    rng = np.random.default_rng(SEED)
    for i in range(n_random):
        cands.append((f"tirage {i + 1}", rng.dirichlet(np.full(len(CRITERIA), 0.7))))
    return cands


def median_factor(errors: np.ndarray) -> float:
    return math.exp(np.nanmedian(np.abs(errors)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=120, help="nombre de tirages au hasard")
    args = parser.parse_args()

    snap = load_snapshot()
    est = Estimator(snap)
    b = load_saved_bench(snap.path.name)
    rows = b.table[["milestoneId", "gameId", "gameName", "reportedAt", "units"]].reset_index(drop=True)
    targets = list(rows.gameId.unique())

    t0 = time.time()
    fm = FastMatcher(est, targets)
    print(f"{len(targets)} jeux × {len(fm.anchor_game)} ancres préparés en {time.time() - t0:.0f}s")

    # Parité : avec les poids actuels, les profils doivent être exactement ceux du site.
    current = np.array([M.SIMILARITY_WEIGHTS[c] for c in CRITERIA])
    fast = fm.profiles(current)
    worst = 0.0
    for g in targets:
        ref, mine = est.profile(g, g), fast[g]
        for f in ("pc_share", "playstation_share", "xbox_share", "m1", "tail_y2", "peak_ccu_to_week_one_low",
                  "pc_boxleiter_low", "ps_boxleiter_low"):
            a, c = getattr(ref, f), getattr(mine, f)
            if (a is None) != (c is None):
                raise SystemExit(f"Parité KO pour {g} / {f} : {a} vs {c}")
            if a is not None:
                worst = max(worst, abs(a - c) / max(abs(a), 1e-12))
    print(f"Parité avec le matcher du site : écart relatif max {worst:.1e}")
    if worst > 1e-9:
        raise SystemExit("Parité KO : arrêt.")

    games = np.array(targets)
    folds = list(GroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(games, groups=games))
    fold_games = [set(games[te]) for _, te in folds]
    row_fold = rows.gameId.map({g: i for i, gs in enumerate(fold_games) for g in gs}).to_numpy()
    t_train_rows = (rows.reportedAt < TIME_CUTOFF).to_numpy()
    t_test_rows = ~t_train_rows & ~rows.gameId.isin(set(rows.gameId[t_train_rows])).to_numpy()
    t_test_games = set(rows.gameId[t_test_rows])

    cands = candidates(args.trials)
    full_err = np.zeros((len(cands), len(rows)))          # corpus complet : sert à juger les jeux testés
    fold_train = np.zeros((len(cands), 5))                # erreur d'entraînement de chaque pli
    time_train = np.zeros(len(cands))
    t0 = time.time()
    for c, (name, w) in enumerate(cands):
        full_err[c] = log_errors(est, rows, fm.profiles(w))
        for f in range(5):
            tr = row_fold != f
            err = log_errors(est, rows[tr], fm.profiles(w, fold_games[f]))
            fold_train[c, f] = np.nanmedian(np.abs(err))
        err = log_errors(est, rows[t_train_rows], fm.profiles(w, t_test_games))
        time_train[c] = np.nanmedian(np.abs(err))
        if c % 10 == 0:
            print(f"  essai {c + 1}/{len(cands)} ({name}) — {time.time() - t0:.0f}s")

    # Validation croisée : pour chaque pli, les poids qui marchent le mieux SANS ce pli.
    chosen = fold_train.argmin(0)
    oof = np.full(len(rows), np.nan)
    for f in range(5):
        te = row_fold == f
        oof[te] = full_err[chosen[f], te]
    cur_err = full_err[0]

    def scored(sub: pd.DataFrame, errors: np.ndarray) -> pd.DataFrame:
        point = sub.units.to_numpy() * np.exp(errors)
        return add_error_columns(sub.assign(estPoint=point, estLow=point, estHigh=point)).set_index("milestoneId")

    t_choice = int(time_train.argmin())
    cv_cur, cv_new = scored(rows, cur_err), scored(rows, oof)
    tm_rows = rows[t_test_rows]
    tm_cur, tm_new = scored(tm_rows, cur_err[t_test_rows]), scored(tm_rows, full_err[t_choice, t_test_rows])

    final_choice = int(np.nanmedian(np.abs(full_err), axis=1).argmin())
    lines = [
        f"# Poids du matcher appris (snapshot {snap.path.name})\n",
        f"{len(cands)} jeux de poids essayés sur {len(targets)} jeux ({len(rows)} chiffres monde réels).\n",
        "## Validation croisée (poids choisis sans le groupe testé)\n",
        f"- poids actuels : ×{summarize(cv_cur.reset_index())['facteur_median']:.3f}, "
        f"≤ ×2 {summarize(cv_cur.reset_index())['part_x2']:.0%}",
        f"- poids appris : ×{summarize(cv_new.reset_index())['facteur_median']:.3f}, "
        f"≤ ×2 {summarize(cv_new.reset_index())['part_x2']:.0%} — meilleurs que les actuels dans "
        f"{paired_gain(cv_cur, cv_new, 1000)['proba_meilleur']:.0%} des tirages",
        "- poids choisis dans chaque pli : " + ", ".join(cands[c][0] for c in chosen), "",
        f"## Test dans le temps (choisis avant 2025, testés sur 2025+ : {int(t_test_rows.sum())} chiffres)\n",
        f"- poids actuels : ×{summarize(tm_cur.reset_index())['facteur_median']:.3f}",
        f"- poids appris ({cands[t_choice][0]}) : ×{summarize(tm_new.reset_index())['facteur_median']:.3f} — "
        f"meilleurs dans {paired_gain(tm_cur, tm_new, 1000)['proba_meilleur']:.0%} des tirages", "",
        f"## Meilleurs poids sur tous les jeux : {cands[final_choice][0]}\n",
        pd.DataFrame({"critère": CRITERIA, "poids actuel": current, "poids appris": cands[final_choice][1]})
        .assign(**{"poids actuel": lambda d: d["poids actuel"].map("{:.1%}".format),
                   "poids appris": lambda d: d["poids appris"].map("{:.1%}".format)}).to_markdown(index=False), "",
        "## Sensibilité : erreur du site sur tous les jeux pour chaque essai structuré\n",
        pd.DataFrame({"essai": [n for n, _ in cands[:15]],
                      "erreur typique": [f"×{median_factor(full_err[c]):.3f}" for c in range(15)]}).to_markdown(index=False),
    ]
    text = "\n".join(lines)
    print(text)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "matcher_weights.md").write_text(text)
    np.savez(REPORTS / "matcher_weights.npz", names=np.array([n for n, _ in cands]),
             weights=np.array([w for _, w in cands]), full_err=full_err, fold_train=fold_train, time_train=time_train)
    print(f"\n→ {REPORTS / 'matcher_weights.md'}")


if __name__ == "__main__":
    main()

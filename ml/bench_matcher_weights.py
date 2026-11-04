"""Les poids appris du matcher améliorent-ils le modèle ML ?

Recalcule toutes les informations venues des voisins avec chaque jeu de poids,
puis réentraîne le modèle en prod (v1.4) avec le protocole du banc. Les chiffres
suspects restent ceux des poids du site, pour juger tout le monde pareil.

Découverte locale : rien n'est écrit en base, ni le gel du modèle, ni les
rapports du banc.

Usage (depuis ml/) :
    .venv/bin/python bench_matcher_weights.py   → reports/bench_matcher_weights.md
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
import bench
from backtest import compute_backtest
from baseline import Estimator
from bench import ML_MODEL, SEED
from features import build_feature_table
from labels import flag_suspects
from learn_matcher import CRITERIA, feature_scores
from learn_matcher_tags import candidates
from metrics import add_error_columns, format_table
from snapshot import load_snapshot

BOOTSTRAP = 1000
SITE = "site, gameplay actuel"
TAGS = "site, tags pondérés"
# Tirages retenus par `learn_matcher_tags.py` (snapshot 2026-11-04) : un par pli.
FOLD_CHOICES = ["tirage 232", "tirage 61", "tirage 77", "tirage 61", "tirage 218"]
TIME_CHOICE = "tirage 232"
BASELINE = "Modèle actuel"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", default=None, help="dossier de snapshot (défaut : le dernier de data/)")
    parser.add_argument("--out", default=str(bench.REPORTS / "bench_matcher_weights.md"))
    parser.add_argument("--folds", default=",".join(FOLD_CHOICES), help="tirage retenu par pli, séparés par des virgules")
    parser.add_argument("--time-choice", default=TIME_CHOICE)
    args = parser.parse_args()
    fold_choices = args.folds.split(",")
    time_choice = args.time_choice

    t0 = time.time()
    snap = load_snapshot(args.snapshot)
    original = M.similarity
    targets: list[str] = []
    weights = dict(candidates(300))

    flags = None
    cv: dict[str, pd.DataFrame] = {}
    tm: dict[str, pd.DataFrame] = {}
    for name in dict.fromkeys([SITE, TAGS, "tirage 180", time_choice, *fold_choices]):
        if name == SITE:
            M.similarity = M.previous_similarity
        else:
            w = weights[name]

            def patched(row: M.Features, target: M.Features, w: np.ndarray = w) -> float:
                return float(np.dot(feature_scores(row, target), w))

            M.similarity = patched
        est = Estimator(snap)
        res = compute_backtest(snap, est)
        table, tag_cols = build_feature_table(snap, est, res)
        by = {s.name: s for s in bench.model_specs(tag_cols)}
        if flags is None:
            targets = list(table.gameId.unique())
            flags = flag_suspects(table, [by["Forêt aléatoire"], by["Linéaire + interactions"]], SEED)
        table = table.join(flags)
        dev = table.reset_index(drop=True)
        specs = [by[BASELINE], by[ML_MODEL]]
        preds, _ = bench.cross_validate(specs, dev)
        cv[name] = add_error_columns(preds)
        tm[name] = add_error_columns(bench.temporal_check(specs, dev))
        print(f"{name} : fait ({time.time() - t0:.0f}s)", flush=True)
    M.similarity = original

    games = np.array(targets)
    folds = list(GroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(games, groups=games))
    choice = {g: fold_choices[i] for i, (_, te) in enumerate(folds) for g in games[te]}

    def rows_of(preds: pd.DataFrame, model: str) -> pd.DataFrame:
        return preds[preds.model == model].set_index("milestoneId")

    def nested(model: str) -> pd.DataFrame:
        names = list(dict.fromkeys(fold_choices))
        return pd.concat([rows_of(cv[n], model)[lambda d, n=n: d.gameId.map(choice) == n] for n in names])

    def line(label: str, ref: pd.DataFrame, new: pd.DataFrame) -> str:
        e = new.logErr.to_numpy()
        return (f"| {label} | {len(new)} | ×{math.exp(np.median(np.abs(e))):.3f} | {np.mean(np.abs(e) <= math.log(2)):.0%} | "
                f"×{math.exp(np.median(e)):.2f} | {bench.paired_gain(ref, new, BOOTSTRAP)['proba_meilleur']:.0%} |")

    head = "| poids | chiffres | erreur typique | part ≤ ×2 | biais | meilleur que le site |\n|:--|--:|--:|--:|--:|--:|"
    lines = [f"# Poids appris du matcher dans le modèle ML (snapshot {snap.path.name})\n"]
    for title, model in [("Modèle ML en prod (v1.4)", ML_MODEL), ("Formule sans ML", BASELINE)]:
        ref = rows_of(cv[SITE], model)
        ref_t = rows_of(tm[SITE], model)
        lines += [
            f"## {title} : validation croisée\n", head, line("site, gameplay actuel", ref, ref),
            line("site, tags pondérés", ref, rows_of(cv[TAGS], model)),
            line("appris, choisis sans le jeu testé", ref, nested(model)),
            line("tirage 180 partout (flatteur)", ref, rows_of(cv["tirage 180"], model)), "",
            f"## {title} : test dans le temps (2025+, poids choisis avant 2025)\n", head,
            line("site, gameplay actuel", ref_t, ref_t),
            line("site, tags pondérés", ref_t, rows_of(tm[TAGS], model)),
            line(time_choice, ref_t, rows_of(tm[time_choice], model)),
            line("tirage 180 (déjà dans le code)", ref_t, rows_of(tm["tirage 180"], model)), "",
        ]
    move = np.abs(rows_of(cv[time_choice], ML_MODEL).logErr - rows_of(cv[SITE], ML_MODEL).logErr)
    lines += [f"Écart typique entre les estimations ML de {time_choice} et du site : ×{math.exp(move.median()):.3f} ; "
              f"un écart de plus de ×1,25 sur {(move > math.log(1.25)).mean():.0%} des chiffres.\n",
              "Critères : " + ", ".join(CRITERIA)]
    text = "\n".join(lines)
    print(text, flush=True)
    Path(args.out).write_text(text)


if __name__ == "__main__":
    main()

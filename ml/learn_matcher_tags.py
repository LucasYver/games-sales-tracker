"""Chercher les meilleurs poids du matcher avec le gameplay en tags pondérés.

Même protocole que `learn_matcher.py` (validation croisée par jeu, test dans le
temps, ancres des jeux testés retirées pendant le choix). Seule différence : le
critère gameplay devient un cosinus sur tous les tags, pondérés par rareté et
par rang Steam. Le critère de taille, constant en production, reste à zéro.

Découverte locale : rien n'est écrit en base, les poids du site ne changent pas.

Usage (depuis ml/) :
    .venv/bin/python learn_matcher_tags.py --trials 300
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import baseline.matcher as M
from backtest import compute_backtest
from baseline import Estimator
from bench import SEED, TIME_CUTOFF, load_saved_bench, paired_gain
from features import build_feature_table
from learn_matcher import CRITERIA, FastMatcher, log_errors, median_factor
from metrics import add_error_columns, summarize
from snapshot import load_snapshot

REPORTS = Path(__file__).resolve().parent / "reports"
GAMEPLAY = CRITERIA.index("gameplayType")
SCALE = CRITERIA.index("scaleBucket")


def previous_gameplay(est: Estimator, targets: list[str]) -> np.ndarray:
    """L'ancien critère gameplay (6 premiers tags), cibles × ancres."""
    anchors = [a.features for a in est.matcher.corpus]
    out = np.zeros((len(targets), len(anchors)))
    for i, g in enumerate(targets):
        t = est.matcher.target_features(g)
        for j, a in enumerate(anchors):
            out[i, j] = M.gameplay_type_similarity(a.steam_tags, a.genres, t.steam_tags, t.genres)
    return out


def candidates(n_random: int) -> list[tuple[str, np.ndarray]]:
    site = np.array([M.PREVIOUS_SIMILARITY_WEIGHTS[c] for c in CRITERIA])
    base = site.copy()
    base[SCALE] = 0
    base /= base.sum()
    cands = [("site, gameplay actuel", site), ("site, tags pondérés", site), ("site sans taille, tags pondérés", base)]
    for k, c in enumerate(CRITERIA):
        if k == SCALE:
            continue
        w = base.copy()
        w[k] = 0
        cands.append((f"sans {c}", w / w.sum()))
    rng = np.random.default_rng(SEED)
    active = np.array([k != SCALE for k in range(len(CRITERIA))])
    for i in range(n_random):
        w = np.zeros(len(CRITERIA))
        # Une moitié explore large, l'autre affine autour des poids du site.
        alpha = np.full(active.sum(), 0.7) if i % 2 == 0 else base[active] * 30
        w[active] = rng.dirichlet(alpha)
        cands.append((f"tirage {i + 1}", w))
    return cands


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=300)
    parser.add_argument("--out", default=str(REPORTS / "matcher_weights_tags.md"))
    parser.add_argument("--snapshot", default=None, help="dossier de snapshot (défaut : le dernier de data/)")
    args = parser.parse_args()

    snap = load_snapshot(args.snapshot)
    est = Estimator(snap)
    b = load_saved_bench(snap.path.name)
    table = b.table if b else build_feature_table(snap, est, compute_backtest(snap, est))[0]
    rows = table[["milestoneId", "gameId", "gameName", "reportedAt", "units"]].reset_index(drop=True)
    targets = list(rows.gameId.unique())

    t0 = time.time()
    fm = FastMatcher(est, targets)
    s_tags = fm.S
    s_current = s_tags.copy()
    s_current[:, :, GAMEPLAY] = previous_gameplay(est, targets)
    print(f"{len(targets)} jeux × {len(fm.anchor_game)} ancres préparés en {time.time() - t0:.0f}s", flush=True)

    games = np.array(targets)
    folds = list(GroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(games, groups=games))
    fold_games = [set(games[te]) for _, te in folds]
    row_fold = rows.gameId.map({g: i for i, gs in enumerate(fold_games) for g in gs}).to_numpy()
    t_train_rows = (rows.reportedAt < TIME_CUTOFF).to_numpy()
    t_test_rows = ~t_train_rows & ~rows.gameId.isin(set(rows.gameId[t_train_rows])).to_numpy()
    t_test_games = set(rows.gameId[t_test_rows])

    cands = candidates(args.trials)
    full_err = np.zeros((len(cands), len(rows)))
    fold_train = np.zeros((len(cands), 5))
    time_train = np.zeros(len(cands))
    t0 = time.time()
    for c, (name, w) in enumerate(cands):
        fm.S = s_current if c == 0 else s_tags
        full_err[c] = log_errors(est, rows, fm.profiles(w))
        for f in range(5):
            err = log_errors(est, rows[row_fold != f], fm.profiles(w, fold_games[f]))
            fold_train[c, f] = np.nanmedian(np.abs(err))
        err = log_errors(est, rows[t_train_rows], fm.profiles(w, t_test_games))
        time_train[c] = np.nanmedian(np.abs(err))
        if c % 10 == 0:
            print(f"essai {c + 1}/{len(cands)} ({name}) : {time.time() - t0:.0f}s", flush=True)

    def scored(sub: pd.DataFrame, errors: np.ndarray) -> pd.DataFrame:
        point = sub.units.to_numpy() * np.exp(errors)
        return add_error_columns(sub.assign(estPoint=point, estLow=point, estHigh=point)).set_index("milestoneId")

    def line(label: str, ref: pd.DataFrame, new: pd.DataFrame) -> str:
        s = summarize(new.reset_index())
        return (f"| {label} | ×{s['facteur_median']:.3f} | {s['part_x2']:.0%} | "
                f"{paired_gain(ref, new, 1000)['proba_meilleur']:.0%} |")

    # Le choix se fait uniquement parmi les poids avec tags pondérés.
    tag_rows = np.arange(1, len(cands))
    chosen = tag_rows[fold_train[tag_rows].argmin(0)]
    oof = np.full(len(rows), np.nan)
    for f in range(5):
        oof[row_fold == f] = full_err[chosen[f], row_fold == f]
    t_choice = int(tag_rows[time_train[tag_rows].argmin()])
    final = int(tag_rows[np.nanmedian(np.abs(full_err[tag_rows]), axis=1).argmin()])

    cv_ref = scored(rows, full_err[0])
    tm_rows = rows[t_test_rows]
    tm_ref = scored(tm_rows, full_err[0, t_test_rows])
    head = "| poids | erreur typique | part ≤ ×2 | meilleur que le site |\n|:--|--:|--:|--:|"
    site_w = cands[0][1]
    order = tag_rows[np.nanmedian(np.abs(full_err[tag_rows]), axis=1).argsort()[:10]]
    top10 = np.array([cands[c][1] for c in order])
    table = pd.DataFrame({"critère": CRITERIA, "site": site_w, "meilleur": cands[final][1],
                          "top 10 min": top10.min(0), "top 10 max": top10.max(0)})
    for col in ("site", "meilleur", "top 10 min", "top 10 max"):
        table[col] = table[col].map("{:.1%}".format)
    lines = [
        f"# Poids du matcher avec tags pondérés (snapshot {snap.path.name})\n",
        f"{len(cands)} jeux de poids sur {len(targets)} jeux ({len(rows)} chiffres monde réels).\n",
        "## Validation croisée (poids choisis sans le groupe testé)\n", head,
        line("site, gameplay actuel", cv_ref, cv_ref),
        line("site, tags pondérés", cv_ref, scored(rows, full_err[1])),
        line("appris, tags pondérés", cv_ref, scored(rows, oof)), "",
        "Choisis dans chaque pli : " + ", ".join(cands[c][0] for c in chosen) + "\n",
        f"## Test dans le temps (choisis avant 2025, testés sur 2025+ : {int(t_test_rows.sum())} chiffres)\n", head,
        line("site, gameplay actuel", tm_ref, tm_ref),
        line("site, tags pondérés", tm_ref, scored(tm_rows, full_err[1, t_test_rows])),
        line(f"appris ({cands[t_choice][0]})", tm_ref, scored(tm_rows, full_err[t_choice, t_test_rows])), "",
        f"## Meilleurs poids sur tous les jeux : {cands[final][0]} (×{median_factor(full_err[final]):.3f})\n",
        "Ce chiffre est flatteur : ces poids ont été choisis sur les jeux qu'ils notent.\n",
        table.to_markdown(index=False), "",
        "## Retirer un critère (tags pondérés, erreur sur tous les jeux)\n",
        pd.DataFrame({"essai": [n for n, _ in cands[:15]],
                      "erreur typique": [f"×{median_factor(full_err[c]):.3f}" for c in range(15)]}).to_markdown(index=False),
    ]
    text = "\n".join(lines)
    print(text, flush=True)
    Path(args.out).write_text(text)


if __name__ == "__main__":
    main()

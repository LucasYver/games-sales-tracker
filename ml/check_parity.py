"""Test de parité : le portage Python reproduit-il la prod TypeScript ?

Pour chaque jeu, on prend le dernier lot d'estimations écrit par la prod
(`sales_estimate`, toutes méthodes), on relance le portage à la même date
SANS holdout, et on compare méthode par méthode.

Pourquoi : un backtest n'a de valeur que si on mesure le vrai modèle. Si le
portage diverge, les chiffres du backtest décrivent un autre modèle.

Comparaison juste = mêmes entrées. Le matcher lit `game_rank`, recalculé en
bloc chaque semaine : on ne compare donc que les lots prod calculés APRÈS
le dernier recalcul du rang (sinon les écarts mesurent la dérive des
données, pas le portage). Le tableau « tous lots » est affiché pour info.

Usage (depuis ml/) :
    .venv/bin/python check_parity.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from baseline import Estimator
from snapshot import load_snapshot

REPORTS = Path(__file__).resolve().parent / "reports"
EPOCH = pd.Timestamp("1970-01-01", tz="UTC")
MAIN_METHODS = [
    "aggregated", "boxleiter-default", "first-week-extrapolation-pc",
    "ps-ratings-boxleiter-default", "xbox-ratings-boxleiter-default",
    "genre-console-split-from-pc-playstation", "genre-console-split-from-ps-xbox",
    "genre-console-split-from-pc-xbox",
]


def compare(est: Estimator, prod: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for game_id, g in prod.groupby("gameId"):
        as_of = int((g.computedAt.iloc[0] - EPOCH) // pd.Timedelta(microseconds=1))
        e = est.estimate(game_id, as_of)
        mine = {}
        if e:
            mine = {(m.platform, m.method): m for m in e.methods}
            mine.update({(p, "aggregated"): a for p, a in e.aggregates.items()})
        for r in g.itertuples(index=False):
            m = mine.get((r.platform, r.method))
            rel = None
            if m is not None:
                rel = max(abs(m.low - r.estimatedLow) / max(r.estimatedLow, 1),
                          abs(m.high - r.estimatedHigh) / max(r.estimatedHigh, 1))
            rows.append({
                "gameId": game_id, "platform": r.platform, "method": r.method,
                "prodLow": r.estimatedLow, "prodHigh": r.estimatedHigh,
                "pyLow": m.low if m else None, "pyHigh": m.high if m else None,
                "exact": m is not None and abs(m.low - r.estimatedLow) <= 1 and abs(m.high - r.estimatedHigh) <= 1,
                "relDiff": rel,
            })
    return pd.DataFrame(rows)


def summarise(df: pd.DataFrame) -> pd.DataFrame:
    df = df[df.method.isin(MAIN_METHODS)]
    return df.groupby("method").agg(
        lignes=("exact", "size"),
        identique=("exact", "mean"),
        ecart_lt_1pct=("relDiff", lambda s: (s < 0.01).mean()),
    ).round(3).reindex([m for m in MAIN_METHODS if m in set(df.method)])


def main() -> None:
    snap = load_snapshot()
    est = Estimator(snap)

    prod = snap.prod_latest_estimates.copy()
    # `computedAt` est un `timestamp` sans fuseau, écrit en UTC par la prod.
    prod["computedAt"] = pd.to_datetime(prod.computedAt).dt.tz_localize("UTC")
    rank_at = snap.game_rank.computedAt.max()
    same_inputs = prod[(prod.computedAt > rank_at) & (prod.computedAt <= pd.Timestamp(snap.path.name, tz="UTC") + pd.Timedelta(days=1))]

    df_same = compare(est, same_inputs)
    df_all = compare(est, prod)
    s_same, s_all = summarise(df_same), summarise(df_all)

    text = "\n".join([
        f"# Parité portage Python vs prod (snapshot {snap.path.name})\n",
        f"## Lots prod calculés après le dernier recalcul de game_rank ({rank_at:%Y-%m-%d %H:%M} UTC)\n",
        f"{same_inputs.gameId.nunique()} jeux. C'est le vrai test du portage.\n",
        s_same.to_markdown(), "",
        f"## Tous les derniers lots ({prod.gameId.nunique()} jeux, entrées parfois différentes)\n",
        s_all.to_markdown(), "",
        "`identique` = low et high à ±1 unité près. `ecart_lt_1pct` = écart relatif < 1 %.",
    ])
    print(text)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "parity.md").write_text(text)
    df_all.to_csv(REPORTS / "parity.csv", index=False)


if __name__ == "__main__":
    main()

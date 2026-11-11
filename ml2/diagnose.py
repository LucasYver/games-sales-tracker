"""Step 4: where the remaining error comes from, to choose what to try next.

Works on the best hypothesis so far and writes `data/<stamp>/diagnosis.json`:
  - how much of the error is a per-game offset (the same for every figure of a game);
  - what a game's own earlier figure is worth (anchoring);
  - how the error moves with the number of training games (is more data worth it?).

    ../ml/.venv/bin/python diagnose.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

import bench
from dataset import latest_snapshot
from learned import BEST_KEY
from models import REGISTRY
from stats import game_weights, weighted_quantile

MODEL = BEST_KEY
SHARES = (0.25, 0.5, 0.75, 1.0)
CURVE_REPEATS = 3


def _factor(log_errors) -> float:
    return float(np.exp(np.median(np.abs(log_errors))))


def offsets(e: pd.DataFrame) -> dict:
    several = e[e.groupby("gameId").err.transform("size") >= 2]
    mean = several.groupby("gameId").err.transform("mean")
    between, within = float(mean.var()), float((several.err - mean).var())
    return {"games": int(several.gameId.nunique()), "gameShare": between / (between + within),
            "factorNow": _factor(several.err), "factorIfGameKnown": _factor(several.err - mean)}


def anchoring(e: pd.DataFrame) -> dict:
    e = e.sort_values(["gameId", "reportedAt"])
    by_game = e.groupby("gameId")
    prev = pd.DataFrame({"units": by_game.units.shift(), "estimate": by_game.estimate.shift(),
                         "reviews": by_game.steamReviewsAtDate.shift(), "at": by_game.reportedAt.shift()})
    a = e[prev.units.notna()]
    prev = prev.loc[a.index]
    gap = pd.cut((a.reportedAt - prev["at"]).dt.days, [-1, 30, 180, 365, 1e6],
                 labels=["moins d'un mois", "1 à 6 mois", "6 à 12 mois", "plus d'un an"])
    methods = {"model": a.estimate, "flat": prev.units, "reviews": prev.units * a.steamReviewsAtDate / prev.reviews,
               "modelGrowth": prev.units * a.estimate / prev.estimate}
    errors = pd.DataFrame({k: np.log(v / a.units) for k, v in methods.items()})
    rows = [{"gap": "tous", "figures": len(a), **{k: _factor(errors[k].dropna()) for k in methods}}]
    for name, part in errors.groupby(gap, observed=True):
        rows.append({"gap": str(name), "figures": len(part), **{k: _factor(part[k].dropna()) for k in methods}})
    return {"games": int(a.gameId.nunique()), "rows": rows}


def learning_curve(figures: pd.DataFrame) -> list[dict]:
    dev = figures[~figures.locked]
    totals = bench.judged(dev)
    totals = totals[(totals.target == "TOTAL") & (totals.measure == "ventes")]

    def one(share: float, repeat: int, k: int) -> pd.DataFrame:
        folds = dev.gameId.map(lambda g: bench.fold_of(g, repeat))
        train = dev[folds != k]
        keep = train.gameId.map(lambda g: bench._hash(f"v2-curve-{repeat}:{g}") % 100 < share * 100)
        test = totals[totals.gameId.map(lambda g: bench.fold_of(g, repeat)) == k]
        return bench._predict(REGISTRY[MODEL], train[keep], test).assign(share=share, repeat=repeat,
                                                                           trainGames=train[keep & (train.measure == "ventes")].gameId.nunique())

    parts = Parallel(n_jobs=-1)(delayed(one)(s, r, k) for s in SHARES for r in range(CURVE_REPEATS) for k in range(bench.FOLDS))
    p = bench.with_errors(pd.concat(parts, ignore_index=True), figures)
    out = []
    for share, rows in p.groupby("share"):
        per = [bench.score(r)["factor"] for _, r in rows.groupby("repeat")]
        out.append({"share": share, "trainGames": int(rows.groupby(["repeat"]).trainGames.mean().mean()),
                    "factor": float(np.mean(per)), "min": float(min(per)), "max": float(max(per))})
    return out


def main() -> None:
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    p = bench.with_errors(pd.read_parquet(bench.predictions_dir(snapshot) / f"{MODEL}.parquet"), figures)
    p = p[(p.test == "cv") & (p.target == "TOTAL")]
    e = p.assign(logEstimate=np.log(p.estimate)).groupby("figureId").agg(
        logEstimate=("logEstimate", "mean"), gameId=("gameId", "first"), units=("units", "first"),
        reportedAt=("reportedAt", "first")).reset_index()
    e = e.merge(figures[["figureId", "steamReviewsAtDate"]], on="figureId")
    e["estimate"] = np.exp(e.logEstimate)
    e["err"] = e.logEstimate - np.log(e.units)
    result = {"model": MODEL, "offsets": offsets(e), "anchoring": anchoring(e), "learningCurve": learning_curve(figures)}
    (snapshot / "diagnosis.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps(result, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()

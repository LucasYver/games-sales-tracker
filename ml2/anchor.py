"""Step 5: anchoring. A game that has published a total is estimated from that total.

One number per game: its sales per Steam review. A published total gives it at that
date; later sales are that number times the reviews, corrected for the launch (a game
sells before it is reviewed, so its sales per review are higher in its first days).
Games with no published total keep the model.

The test never sees the future: each total is estimated from the game's EARLIER totals
only, and the launch correction is fitted on other games.

    ../ml/.venv/bin/python anchor.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

import bench
from dataset import latest_snapshot, with_available_at
from learned import BEST_KEY
from stats import game_weights, weighted_quantile

MODEL = BEST_KEY
REAL_READING = "relevé du jour"
GAPS = ([-1, 30, 180, 365, 1e6], ["moins d'un mois", "1 à 6 mois", "6 à 12 mois", "plus d'un an"])
COVERAGE = 0.80


def model_logs(snapshot, figures: pd.DataFrame) -> pd.Series:
    """log(estimate) of the model for each judged figure, by models that never saw the game."""
    p = pd.read_parquet(bench.predictions_dir(snapshot) / f"{MODEL}.parquet")
    p = p[p.test == "cv"]
    return np.log(p.estimate).groupby(p.figureId).mean()


def pairs(figures: pd.DataFrame, model_log: pd.Series) -> pd.DataFrame:
    """Each total with the previous total of the same game (its anchor)."""
    t = figures[(figures.target == "TOTAL") & (figures.measure == "ventes")].sort_values(["gameId", "reportedAt"]).copy()
    t["modelLog"] = t.figureId.map(model_log)
    by_game = t.groupby("gameId")
    for col in ("units", "steamReviewsAtDate", "steamReviewsBasis", "ageDays", "reportedAt", "modelLog"):
        t[f"anchor_{col}"] = by_game[col].shift()
    t = t[t.anchor_units.notna()].copy()
    t["gapDays"] = (t.reportedAt - t.anchor_reportedAt).dt.days
    t["gap"] = pd.cut(t.gapDays, GAPS[0], labels=GAPS[1])
    t["byReviews"] = (t.anchor_steamReviewsAtDate > 0) & (t.steamReviewsAtDate >= t.anchor_steamReviewsAtDate)
    # How much further from the launch the estimate is than its anchor (0 once both are old).
    t["launchShift"] = 1 / t.anchor_ageDays.clip(lower=1) - 1 / t.ageDays.clip(lower=1)
    t["anchorIsReal"] = t.anchor_steamReviewsBasis == REAL_READING
    return t


def review_growth(p: pd.DataFrame) -> pd.Series:
    return np.log(p.steamReviewsAtDate / p.anchor_steamReviewsAtDate)


def fit_launch(p: pd.DataFrame) -> dict[bool, float]:
    """Strength of the launch correction, for anchors whose review count was really read
    that day and for those rebuilt from monthly rows (the rebuilt ones run low at launch)."""
    p = p[p.byReviews]
    gap = review_growth(p) - np.log(p.units / p.anchor_units)
    grid = np.linspace(0, 4, 81)
    out = {}
    for real in (True, False):
        part = p.anchorIsReal == real
        out[real] = float(grid[np.argmin([np.abs(gap[part] - k * p.launchShift[part]).sum() for k in grid])]) if part.sum() >= 20 else 0.0
    return out


def anchored_log(p: pd.DataFrame, launch: dict[bool, float]) -> pd.Series:
    """log(estimate) from the anchor: review growth with the launch correction, or the
    model's growth when the reviews cannot say; never below the anchor."""
    strength = p.anchorIsReal.map(launch)
    by_reviews = review_growth(p) - strength * p.launchShift
    by_model = p.modelLog - p.anchor_modelLog
    growth = by_reviews.where(p.byReviews, by_model).fillna(0)
    return np.log(p.anchor_units) + growth.clip(lower=0)


def prequential(figures: pd.DataFrame, model_log: pd.Series) -> tuple[pd.DataFrame, dict]:
    """Estimate every anchored total of the development games; the launch correction and
    the width of the range come from the other folds."""
    p = pairs(figures[~figures.locked], model_log)
    folds = p.gameId.map(lambda g: bench.fold_of(g, 0))
    p["anchoredLog"], p["width"] = np.nan, np.nan
    for k in range(bench.FOLDS):
        train, test = p[folds != k], folds == k
        launch = fit_launch(train)
        p.loc[test, "anchoredLog"] = anchored_log(p[test], launch)
        miss = np.abs(anchored_log(train, launch) - np.log(train.units))
        widths = {g: weighted_quantile(miss[train.gap == g], game_weights(train.gameId[train.gap == g]), COVERAGE) for g in GAPS[1]}
        p.loc[test, "width"] = p.gap[test].map(widths).astype(float)
    p["reviewsOnlyLog"] = np.log(p.anchor_units) + review_growth(p).where(p.byReviews)
    final = fit_launch(p)
    miss = np.abs(anchored_log(p, final) - np.log(p.units))
    settings = {"launch": {"real": final[True], "rebuilt": final[False]},
                "widths": {g: weighted_quantile(miss[p.gap == g], game_weights(p.gameId[p.gap == g]), COVERAGE) for g in GAPS[1]}}
    return p, settings


def _factor(log_estimate: pd.Series, units: pd.Series, games: pd.Series) -> dict:
    ok = log_estimate.notna()
    if not ok.any():
        return {"figures": 0, "games": 0, "factor": None, "bias": None, "within20": None, "within2": None}
    err = (log_estimate - np.log(units))[ok]
    w = game_weights(games[ok])
    return {"figures": int(ok.sum()), "games": int(games[ok].nunique()),
            "factor": float(np.exp(weighted_quantile(err.abs(), w, 0.5))), "bias": float(np.exp(weighted_quantile(err, w, 0.5))),
            "within20": float(np.average(err.abs() <= np.log(1.25), weights=w)),
            "within2": float(np.average(err.abs() <= np.log(2), weights=w))}


def summary(p: pd.DataFrame, figures: pd.DataFrame, model_log: pd.Series) -> dict:
    methods = {"model": p.modelLog, "reviewsOnly": p.reviewsOnlyLog, "anchored": p.anchoredLog}
    rows = [{"cut": "Tous", "name": "tous", **{k: _factor(v, p.units, p.gameId) for k, v in methods.items()}}]
    cuts = {"Temps écoulé depuis le chiffre d'ancrage": p.gap,
            "Âge du jeu à la date du chiffre d'ancrage": pd.cut(p.anchor_ageDays, [-1, 7, 30, 365, 1e6],
                                                               labels=["1re semaine", "8 à 30 jours", "1 à 12 mois", "plus d'un an"]),
            "Comment l'ancre est prolongée": np.where(p.byReviews, "par les reviews", "par le modèle (pas de reviews)")}
    for cut, keys in cuts.items():
        for name, part in p.groupby(keys, observed=True):
            rows.append({"cut": cut, "name": str(name), **{k: _factor(v[part.index], part.units, part.gameId) for k, v in methods.items()}})
    inside = ((np.log(p.units) - p.anchoredLog).abs() <= p.width)
    # The whole system on every development total: the anchor when the game had one, else the model.
    dev = figures[~figures.locked & (figures.target == "TOTAL") & (figures.measure == "ventes")]
    model = dev.figureId.map(model_log)
    system = dev.figureId.map(p.set_index("figureId").anchoredLog).fillna(model)
    return {"rows": rows, "coverage": float(np.average(inside, weights=game_weights(p.gameId))),
            "system": {"model": _factor(model, dev.units, dev.gameId), "withAnchor": _factor(system, dev.units, dev.gameId),
                       "anchoredShare": float(dev.figureId.isin(p.figureId).mean())}}


def curve(figures: pd.DataFrame, signals: pd.DataFrame, game_id: str, settings: dict) -> pd.DataFrame:
    """The anchored estimate of one game at each of its review readings, after its first total."""
    totals = figures[(figures.gameId == game_id) & (figures.target == "TOTAL") & (figures.measure == "ventes")].sort_values("reportedAt")
    reviews = with_available_at(signals[(signals.gameId == game_id) & (signals.metric == "STEAM_REVIEWS")]).sort_values("availableAt")
    if totals.empty or reviews.empty:
        return pd.DataFrame(columns=["at", "estimate", "low", "high"])
    release = totals.releaseDate.iloc[0]
    out = []
    for at, value in zip(reviews.availableAt, reviews.value):
        before = totals[totals.reportedAt <= at]
        if before.empty or value <= 0:
            continue
        a = before.iloc[-1]
        if not a.steamReviewsAtDate > 0 or value < a.steamReviewsAtDate:
            continue
        age = max((at - release) / pd.Timedelta(days=1), 1)
        k = settings["launch"]["real" if a.steamReviewsBasis == REAL_READING else "rebuilt"]
        growth = np.log(value / a.steamReviewsAtDate) - k * (1 / max(a.ageDays, 1) - 1 / age)
        gap = pd.cut([(at - a.reportedAt).days], GAPS[0], labels=GAPS[1])[0]
        mid, width = np.log(a.units) + max(growth, 0), settings["widths"][gap]
        out.append((at, np.exp(mid), max(np.exp(mid - width), a.units), np.exp(mid + width)))
    return pd.DataFrame(out, columns=["at", "estimate", "low", "high"])


def main() -> None:
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    model_log = model_logs(snapshot, figures)
    p, settings = prequential(figures, model_log)
    result = {"model": MODEL, "settings": settings, **summary(p, figures, model_log)}
    p.to_parquet(snapshot / "anchor.parquet", index=False)
    (snapshot / "anchor.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps(result["settings"], ensure_ascii=False), "| range holds", f"{result['coverage']:.0%}")
    for r in result["rows"]:
        print(f"{r['cut'][:28]:<28} {r['name']:<32} n={r['anchored']['figures']:<4} model ×{r['model']['factor']:.2f}  "
              f"reviews only ×{r['reviewsOnly']['factor'] or float('nan'):.2f}  anchored ×{r['anchored']['factor']:.2f} "
              f"(bias ×{r['anchored']['bias']:.2f})")
    s = result["system"]
    print(f"system on all {s['model']['figures']} totals ({s['anchoredShare']:.0%} anchored): model ×{s['model']['factor']:.2f}, "
          f"±20 % {s['model']['within20']:.0%}, ×2 {s['model']['within2']:.0%}  →  with anchors ×{s['withAnchor']['factor']:.2f}, "
          f"±20 % {s['withAnchor']['within20']:.0%}, ×2 {s['withAnchor']['within2']:.0%}")


if __name__ == "__main__":
    main()

"""Step 8: freeze the chosen model, for the backend.

The model (`learned.BEST`) is trained once on every kept figure of the snapshot, the
locked games included: the locked test is spent, and more games is what helps. Written
to `models/<snapshot>/` (kept in git, never edited afterwards):

  - v2.json                 everything the backend needs: the two boosted models (tree by
                            tree), the range widths, the anchoring settings, the console
                            coefficients, the rules after the model;
  - catalog_reference.parquet  every catalog game estimated by the frozen file, with the
                            feature values it was given: what the backend must return.

Checks on the way that reading the file back (`frozen.py`, no scikit-learn) returns the
predictions of scikit-learn exactly.

    ../ml/.venv/bin/python freeze.py             # refuses to overwrite an existing freeze
    ../ml/.venv/bin/python freeze.py --install   # copy v2.json into the backend, and write the rows
                                                 # its reader is checked on (`data/<snapshot>/v2_parity.json`)
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import anchor
import bench
import consoles
import estimate_catalog
import features
import learned
from dataset import latest_snapshot
from frozen import FILE, MODELS, Frozen, FrozenBest

VERSION = "v2.0"
BACKEND_MODEL = Path(__file__).resolve().parents[1] / "backend/src/estimation/ml2/v2-frozen.json"


def raw_inputs(catalog: pd.DataFrame, now: pd.Timestamp) -> dict:
    """What the backend reads in its base for each game, before any transformation: the
    input of `buildV2Features`. The columns it builds from it must be those of `rows`."""
    ctx = features.context()
    none = lambda v: None if v is None or pd.isna(v) else float(v)
    ms = lambda d: None if pd.isna(d) else int(pd.Timestamp(d).value // 1_000_000)
    t = now.to_datetime64()
    out = {}
    for r in catalog.itertuples():
        g = ctx.games.loc[r.gameId]
        series = ctx.series.get(r.gameId)
        s_best, s_n = ctx.best_before(r.gameId, ctx.by_series.get(series, []), t)
        d_best, d_n = ctx.best_before(r.gameId, ctx.by_studio.get(ctx.studio.get(r.gameId), []), t)
        out[r.gameId] = {
            "asOf": ms(now), "firstRelease": ms(pd.to_datetime(r.firstRelease, utc=True)),
            "releaseDates": {p: ms(ctx.release[p].get(r.gameId, pd.NaT)) if p in ctx.release else None for p in features.PLATFORMS},
            "platforms": [] if g.platforms is None else [str(p) for p in g.platforms],
            **{k: none(getattr(r, k)) for k in ("steamReviews", "steamPositiveShare", "steamReviewsAgeDays", "steamPeakPlayers", "psRatings",
                                                "psAverage", "xboxRatings", "xboxAverage", "steamFollowers", "twitchViewers30d",
                                                "steamBestSalesRank", "steamMedianPlaytime")},
            "priceCents": none(ctx.price.get(r.gameId)), "timeToBeatSeconds": none(g.timeToBeatSeconds), "dlcCount": none(g.dlcCount),
            "isAnnualIteration": bool(g.isAnnualIteration) if pd.notna(g.isAnnualIteration) else False,
            "liveService": bool(g.liveService) if pd.notna(g.liveService) else False,
            "inSeries": series is not None and pd.notna(series), "gameType": None if pd.isna(g.gameType) else str(g.gameType),
            "gameModes": None if g.gameModes is None else [str(m) for m in g.gameModes],
            "tags": features._split(g.steamTags)[:10], "genres": features._split(g.genres),
            "seriesBest": none(s_best), "seriesGames": int(s_n), "studioBest": none(d_best), "studioGames": int(d_n),
        }
    return out


def install(snapshot, out: Path) -> None:
    """Copy the frozen file into the backend, and write what its reader must return:
    for every catalog game, as a total and as a PC figure, the input columns and the
    estimate and range `frozen.py` gives."""
    shutil.copyfile(out / FILE, BACKEND_MODEL)
    frozen = FrozenBest(out / FILE)
    lab = learned.VARIANTS[frozen.frozen.doc["model"]]()
    catalog = estimate_catalog.released(pd.read_parquet(snapshot / "catalog.parquet"), snapshot)
    columns = frozen.frozen.doc["direct"]["columns"]
    none = lambda v: None if pd.isna(v) else float(v)
    rows = []
    for target in ("TOTAL", "PC"):
        asked = lab._prep(estimate_catalog.rows_today(catalog, estimate_catalog.export_time(snapshot), target))
        x = features.matrix(asked, tuple(frozen.frozen.doc["inputs"]["families"]))[columns]
        expected = frozen.predict(asked)
        console = asked.psRatings.fillna(0) + asked.xboxRatings.fillna(0)
        for i in range(len(asked)):
            rows.append({"gameId": asked.gameId.iloc[i], "asked": target, "target": asked.target.iloc[i], "x": [none(v) for v in x.iloc[i]],
                         "steamReviews": none(asked.steamReviews.iloc[i]), "steamPeakPlayers": none(asked.steamPeakPlayers.iloc[i]),
                         "consoleRatings": float(console.iloc[i]),
                         "expected": [float(v) for v in expected.iloc[i][["estimate", "low", "high"]]]})
    # The rules after the model: what they are given for each game, and the estimate kept.
    final = estimate_catalog.main(frozen=frozen.frozen.doc, model=frozen, out_path=snapshot / "v2_reference.parquet", quiet=True)
    reference = pd.read_parquet(out / "catalog_reference.parquet")
    for col in ("estimate", "low", "high"):
        assert np.allclose(final[col].to_numpy(float), reference[col].to_numpy(float), rtol=1e-12, equal_nan=True), f"{col} differs from the frozen reference"
    assert (final.basis.to_numpy() == reference.basis.to_numpy()).all(), "basis differs from the frozen reference"
    games = raw_inputs(catalog, estimate_catalog.export_time(snapshot))
    for r in final.itertuples():
        has_anchor = pd.notna(r.anchored)
        games[r.gameId]["rules"] = {
            "onPc": bool(r.onPc), "onPlaystation": bool(r.onPlaystation), "onXbox": bool(r.onXbox), "gamePass": bool(r.gamePass),
            "bestPublished": none(r.bestPublished),
            "anchor": {"units": float(r.anchorUnits), "reportedAt": int(pd.Timestamp(r.anchorDate).value // 1_000_000),
                       "steamReviewsAtDate": none(r.anchorReviewsAtDate), "reviewsReadThatDay": bool(r.anchorReviewsReadThatDay),
                       "modelLogAtDate": float(r.anchorModelLog)} if has_anchor else None,
            "expected": {"basis": r.basis, "units": none(r.estimate), "low": none(r.low), "high": none(r.high)},
        }
    path = snapshot / "v2_parity.json"
    path.write_text(json.dumps({"version": frozen.frozen.doc["version"], "columns": columns, "rows": rows,
                                "games": games}, separators=(",", ":")))
    print(f"copied to {BACKEND_MODEL}; {len(rows):,} parity rows in {path}")


def export_tree(nodes: np.ndarray) -> dict:
    """One boosted tree. `f`: column asked (-1 on a leaf); `t`: threshold, or the leaf's
    value; `l`, `r`: children; `m`: 1 when a missing value goes left."""
    assert not nodes["is_categorical"].any(), "no categorical column is expected"
    leaf = nodes["is_leaf"].astype(bool)
    # A split that only sets missing values apart has an infinite threshold: JSON has no
    # infinity, and the largest number says the same for every real value.
    finite = lambda t: float(np.clip(t, -np.finfo(float).max, np.finfo(float).max))
    return {"f": [-1 if z else int(v) for z, v in zip(leaf, nodes["feature_idx"])],
            "t": [float(v) if z else finite(t) for z, v, t in zip(leaf, nodes["value"], nodes["num_threshold"])],
            "l": [-1 if z else int(v) for z, v in zip(leaf, nodes["left"])],
            "r": [-1 if z else int(v) for z, v in zip(leaf, nodes["right"])],
            "m": [0 if z else int(v) for z, v in zip(leaf, nodes["missing_go_to_left"])]}


def export_boosting(model, columns: list[str]) -> dict:
    assert all(len(stage) == 1 for stage in model._predictors)
    return {"columns": columns, "baseline": float(np.ravel(model._baseline_prediction)[0]),
            "trees": [export_tree(stage[0].nodes) for stage in model._predictors]}


def main() -> None:
    snapshot = latest_snapshot()
    out = MODELS / snapshot.name
    if (out / FILE).exists():
        print(f"Already frozen in {out}: left untouched.")
        if "--install" in sys.argv:
            install(snapshot, out)
        return
    figures = bench.load_figures(snapshot)  # kept figures only, locked games included
    model = learned.BEST()
    model.fit(figures)
    core = model.predict_log
    catalog = pd.read_parquet(snapshot / "catalog.parquet")
    released = estimate_catalog.released(catalog, snapshot)
    released["gamePass"] = released.gameId.map(pd.read_parquet(snapshot / "raw" / "games.parquet").set_index("id").gamePass).fillna(False).to_numpy(bool)
    sales = figures[figures.measure == "ventes"]
    doc = {
        "version": VERSION, "model": learned.BEST_KEY, "label": model.label, "snapshot": snapshot.name,
        "frozenAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "training": {"figures": len(figures), "games": int(figures.gameId.nunique()),
                     "salesFigures": len(sales), "salesGames": int(sales.gameId.nunique()),
                     "lockedGamesIncluded": int(figures[figures.locked].gameId.nunique())},
        # What the feature columns are made of (`features.py`), and how a row is read first.
        "inputs": {"families": list(model.families), "reviews": model.reviews, "peak": model.peak,
                   "pcOnlyTotalIsPc": bool(model.pc_only_is_pc), "missing": "NaN, never 0"},
        # log(sales). `perReview` answers log(sales per Steam review) and is used, plus
        # log(reviews), whenever the game has Steam reviews; `direct` answers otherwise.
        "direct": export_boosting(core.direct, core.columns),
        "perReview": export_boosting(core.per_review, core.columns) if core.per_review is not None else None,
        # Range: exp(log estimate ± width of the figure type × scale of the game's group).
        "coverage": learned.COVERAGE, "widths": {k: float(v) for k, v in model.widths.items()},
        "widthScales": {str(k): float(v) for k, v in model.width_scales.items()},
        "widthGroups": {"manyReviews": learned.MANY_REVIEWS, "order": ["reviews / peak / console ratings", "reviews / peak", "reviews"]},
        "anchor": {**json.loads((snapshot / "anchor.json").read_text())["settings"],
                   "gapDays": [None if not np.isfinite(g) else g for g in anchor.GAPS[0]], "gapNames": list(anchor.GAPS[1])},
        "consoles": {"ratios": consoles.fit_ratios(consoles.platform_figures(figures, released)),
                     "minSteamReviews": consoles.MIN_REVIEWS, "consoleOnlyRange": estimate_catalog.CONSOLE_RANGE},
        "exclusions": pd.read_csv("exclusions.csv").drop(columns="added").astype(object).fillna("").to_dict("records"),
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / FILE).write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")

    # The file read back must give what scikit-learn gave, on every figure and every game today.
    frozen = FrozenBest(out / FILE)
    now = estimate_catalog.export_time(snapshot)
    checks = {"figures": figures, "catalog TOTAL": estimate_catalog.rows_today(released, now, "TOTAL"),
              "catalog PC": estimate_catalog.rows_today(released, now, "PC")}
    for name, rows in checks.items():
        a, b = model.predict(rows), frozen.predict(rows)
        gap = float(np.abs(np.log(a[["estimate", "low", "high"]].to_numpy() / b[["estimate", "low", "high"]].to_numpy())).max())
        assert gap < 1e-12, f"{name}: the file read back differs from scikit-learn by {gap}"
        print(f"read back identical on {name}: {len(rows):,} rows (largest gap {gap:.1e})")

    reference = estimate_catalog.main(frozen=frozen.frozen.doc, model=frozen, out_path=out / "catalog_reference.parquet", quiet=True)
    x = features.matrix(learned.BEST()._prep(checks["catalog TOTAL"]), tuple(doc["inputs"]["families"]))
    x.insert(0, "gameId", released.gameId.to_numpy())
    x.to_parquet(out / "catalog_features.parquet", index=False)
    size = (out / FILE).stat().st_size / 1e6
    print(f"frozen {VERSION} in {out}: {size:.2f} MB, {len(doc['direct']['trees'])} + {len(doc['perReview']['trees'])} trees, "
          f"{len(core.columns)} columns; reference catalog {len(reference):,} games")
    if "--install" in sys.argv:
        install(snapshot, out)


if __name__ == "__main__":
    main()

"""Step 6: every game of the catalog estimated today by the whole system.

The bench only judges games that published a figure. This estimates the other 89 %
too, and checks the numbers against what little is known: the published figures, the
2018 Steam leak and the sales per review. Nothing here is compared with the estimates
currently online: only published figures can say whether a number is right.

The model is learned on the development games only (the locked games stay unseen by
it); every published total, locked or not, anchors its own game, as it would on the site.

    ../ml/.venv/bin/python estimate_catalog.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

import anchor
import bench
import consoles
from dataset import latest_snapshot
from learned import BEST

SIGNALS = ["steamReviews", "steamPositiveShare", "steamReviewsAgeDays", "steamPeakPlayers", "psRatings", "psAverage",
           "xboxRatings", "xboxAverage", "steamFollowers", "steamBestSalesRank", "twitchViewers30d", "steamMedianPlaytime",
           "steamReviewsMeanYear", "steamReviewsShareBefore2020"]
# Under 10 Steam reviews the model has nothing to read: it only ever learned that case
# on console hits, and gives such games hundreds of thousands of sales. Such a game is
# estimated from its console ratings when it has some, and not at all otherwise.
MIN_REVIEWS = consoles.MIN_REVIEWS
NOT_ESTIMATED = f"non estimé : moins de {MIN_REVIEWS} reviews Steam, aucune note console"
NOT_ESTIMATED_EXCLUDED = "non estimé : exclu du modèle, aucun chiffre publié"
CONSOLE_RANGE = 2.0  # console ratings alone: published sales per rating spread about this much
REVIEW_BINS = ([-1, 0, 100, 1_000, 10_000, 100_000, float("inf")],
               ["aucune review Steam", "1–100", "100–1 000", "1 000–10 000", "10 000–100 000", "100 000 +"])


def rows_today(catalog: pd.DataFrame, now: pd.Timestamp, target: str) -> pd.DataFrame:
    """One row per game as the models expect it, with today's signals."""
    rows = pd.DataFrame({"figureId": catalog.gameId, "gameId": catalog.gameId, "target": target, "measure": "ventes",
                         "units": 1.0, "reportedAt": now, "releaseDate": pd.to_datetime(catalog.firstRelease, utc=True)})
    rows["ageDays"] = (now - rows.releaseDate) / pd.Timedelta(days=1)
    for col in SIGNALS:
        rows[col] = catalog[col].to_numpy()
    rows["steamReviewsAtDate"] = rows.steamReviews
    return rows


def export_time(snapshot) -> pd.Timestamp:
    return pd.Timestamp(json.loads((snapshot / "manifest.json").read_text())["exportedAt"])


def game_status(catalog: pd.DataFrame, snapshot) -> np.ndarray:
    first, now = pd.to_datetime(catalog.firstRelease, utc=True), export_time(snapshot)
    # Games excluded from the model stay out, except those estimated from their own figures.
    return np.select([(catalog.excluded != "") & ~catalog.anchorOnly, first.isna() | (first > now)], ["exclu à la main", "pas encore sorti"], "estimé")


def released(catalog: pd.DataFrame, snapshot) -> pd.DataFrame:
    """The games that get an estimate: released, and not excluded by hand."""
    return catalog[game_status(catalog, snapshot) == "estimé"].reset_index(drop=True)


def main(frozen: dict | None = None, model=None, out_path=None, quiet: bool = False) -> pd.DataFrame:
    """Without arguments: the lab's model, learned on the development games. With a
    frozen file (`freeze.py`): its model, its console coefficients and its anchoring
    settings, learned on every game."""
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    catalog = pd.read_parquet(snapshot / "catalog.parquet")
    now = export_time(snapshot)
    settings = frozen["anchor"] if frozen else json.loads((snapshot / "anchor.json").read_text())["settings"]
    status = game_status(catalog, snapshot)
    c = released(catalog, snapshot)

    if model is None:
        model = BEST()
        model.fit(figures[~figures.locked])
    total = model.predict(rows_today(c, now, "TOTAL"))
    pc = model.predict(rows_today(c, now, "PC"))
    c["gamePass"] = c.gameId.map(pd.read_parquet(snapshot / "raw" / "games.parquet").set_index("id").gamePass).fillna(False).to_numpy(bool)
    ratios = frozen["consoles"]["ratios"] if frozen else consoles.fit_ratios(consoles.platform_figures(figures[~figures.locked], c))
    mixed = consoles.combine(pd.Series(total.estimate.to_numpy()), pd.Series(pc.estimate.to_numpy()), consoles.console_units(c, ratios), c)
    out = pd.DataFrame({"gameId": c.gameId, "game": c.name, "slug": c.slug, "releaseDate": pd.to_datetime(c.firstRelease, utc=True),
                        "steamReviews": c.steamReviews, "onPc": c.onPc, "onPlaystation": c.onPlaystation, "onXbox": c.onXbox,
                        "model": total.estimate.to_numpy(), "modelLow": total.low.to_numpy(), "modelHigh": total.high.to_numpy(),
                        # A game cannot sell more on PC than in total.
                        "modelPc": np.where(c.onPc, np.minimum(pc.estimate.to_numpy(), total.estimate.to_numpy()), np.nan),
                        "playersLeak": c.playersLeak,
                        "consoleUnits": mixed.consoleUnits.to_numpy(), "unanchored": mixed.estimate.to_numpy(),
                        "unanchoredBasis": mixed.basis.to_numpy(),
                        # What the rules after the model were given (read by `freeze.py --install`).
                        "modelPcRaw": pc.estimate.to_numpy(), "gamePass": c.gamePass.to_numpy(bool),
                        "psRatings": c.psRatings.to_numpy(float), "xboxRatings": c.xboxRatings.to_numpy(float)})
    # A game excluded from the model has no estimate of its own: only its figures speak.
    own = c.anchorOnly.to_numpy(bool)
    out.loc[own, "unanchored"], out.loc[own, "unanchoredBasis"] = np.nan, ""
    all_figures = pd.read_parquet(snapshot / "figures.parquet")
    figures = pd.concat([figures, all_figures[all_figures.anchorOnly]], ignore_index=True)

    # Anchor: the game's last published total, prolonged to today.
    totals = figures[(figures.target == "TOTAL") & (figures.measure == "ventes")].sort_values("reportedAt")
    last = totals.groupby("gameId").tail(1).set_index("gameId")
    last = last[last.index.isin(out.gameId)]
    at_anchor = np.log(model.predict(last.reset_index()).estimate.to_numpy())
    a = out.set_index("gameId").loc[last.index]
    age_now = ((now - last.releaseDate) / pd.Timedelta(days=1)).clip(lower=1)
    strength = (last.steamReviewsBasis == anchor.REAL_READING).map({True: settings["launch"]["real"], False: settings["launch"]["rebuilt"]})
    by_reviews = (last.steamReviewsAtDate > 0) & (a.steamReviews >= last.steamReviewsAtDate)
    growth = np.where(by_reviews,
                      np.log(a.steamReviews / last.steamReviewsAtDate) - strength * (1 / last.ageDays.clip(lower=1) - 1 / age_now),
                      np.log(a.model) - at_anchor)
    mid = np.log(last.units) + np.clip(np.nan_to_num(growth), 0, None)
    gap = pd.cut((now - last.reportedAt).dt.days, anchor.GAPS[0], labels=anchor.GAPS[1])
    width = gap.map(settings["widths"]).astype(float)
    anchored = pd.DataFrame({"anchored": np.exp(mid), "anchoredLow": np.maximum(np.exp(mid - width), last.units),
                             "anchoredHigh": np.exp(mid + width), "anchorUnits": last.units, "anchorDate": last.reportedAt,
                             "anchorBy": np.where(by_reviews, "reviews", "modèle"),
                             "anchorReviewsAtDate": last.steamReviewsAtDate, "anchorModelLog": at_anchor,
                             "anchorReviewsReadThatDay": (last.steamReviewsBasis == anchor.REAL_READING)}, index=last.index)
    out = out.join(anchored, on="gameId")

    # Without a total, a platform figure is still a floor: a game sold at least that.
    sales = figures[figures.measure == "ventes"]
    out["bestPublished"] = out.gameId.map(sales.groupby("gameId").units.max())
    has_anchor = out.anchored.notna()
    floored = ~has_anchor & (out.bestPublished > out.unanchored.fillna(0))
    # Without an anchor: the model, raised by the console ratings when they say more; its
    # range keeps the model's width, or a flat one when only the console ratings speak.
    scale = out.unanchored / out.model
    console_only = out.unanchoredBasis == consoles.CONSOLE_ONLY
    low = np.where(console_only, out.unanchored / CONSOLE_RANGE, out.modelLow * scale)
    high = np.where(console_only, out.unanchored * CONSOLE_RANGE, out.modelHigh * scale)
    out["estimate"] = np.where(has_anchor, out.anchored, np.where(floored, out.bestPublished, out.unanchored))
    out["low"] = np.where(has_anchor, out.anchoredLow, np.where(floored, out.bestPublished, low))
    out["high"] = np.where(has_anchor, out.anchoredHigh, np.where(floored, np.fmax(high, out.bestPublished), high))
    out["basis"] = np.where(has_anchor, "ancré sur un chiffre publié", np.where(floored, "plancher : chiffre de plateforme",
                                                                               np.where(own, NOT_ESTIMATED_EXCLUDED, np.where(out.unanchoredBasis == "", NOT_ESTIMATED, out.unanchoredBasis))))
    out["perReview"] = (out.estimate / out.steamReviews).where(out.steamReviews > 0)
    out["bucket"] = pd.cut(out.steamReviews.fillna(0), REVIEW_BINS[0], labels=REVIEW_BINS[1])
    out.to_parquet(out_path or snapshot / "catalog_estimates.parquet", index=False)
    if quiet:
        return out

    pd.set_option("display.width", 220)
    print(pd.Series(status).value_counts().to_string(), "\n")
    print(out.basis.value_counts().to_string(), "\n")
    q = lambda s, p: s.quantile(p)
    pc_only = out[out.onPc & ~out.onPlaystation & ~out.onXbox]
    table = out.groupby("bucket", observed=True).agg(
        jeux=("gameId", "size"), mediane=("estimate", "median"), p10=("estimate", lambda s: q(s, .1)), p90=("estimate", lambda s: q(s, .9)))
    table["ventesParReviewPcSeul"] = pc_only.groupby("bucket", observed=True).perReview.median()
    print(table.round(2).to_string(), "\n")
    leak = out[out.playersLeak.notna() & out.modelPc.notna()]
    print(f"leak 2018 ({len(leak)} games): PC estimate today below the 2018 players for {(leak.modelPc < leak.playersLeak).mean():.0%}; "
          f"median PC estimate today / 2018 players ×{(leak.modelPc / leak.playersLeak).median():.2f}")
    blind_games = out[out.basis == NOT_ESTIMATED]
    print(f"not estimated: {len(blind_games)} games ({int((~(blind_games.steamReviews > 0)).sum())} with no review at all); "
          f"the model alone would have given them a median of {blind_games.model.median():,.0f}")
    for basis in (consoles.RAISED, consoles.CONSOLE_ONLY):
        part = out[out.basis == basis]
        print(f"{basis}: {len(part)} games; estimate / model median ×{(part.estimate / part.model).median():.2f}")
    print("console ratios:", {k: round(v, 1) for k, v in ratios.items()})
    anchored_games = out[has_anchor]
    print(f"anchored games: {len(anchored_games)}; anchored / model median ×{(anchored_games.anchored / anchored_games.model).median():.2f} "
          f"(p10 ×{(anchored_games.anchored / anchored_games.model).quantile(.1):.2f}, p90 ×{(anchored_games.anchored / anchored_games.model).quantile(.9):.2f}); "
          f"today / last published median ×{(anchored_games.anchored / anchored_games.anchorUnits).median():.2f}")
    return out


if __name__ == "__main__":
    main()

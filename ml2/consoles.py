"""Step 6b: console sales from the store ratings, for games Steam says little about.

PlayStation and Xbox ratings only exist since 2026, so the model could not learn from
them at past dates. Read today, they are a direct signal: a game sells a fairly steady
number of copies per rating. A console-heavy game is then estimated platform by
platform: PC (the model) + PlayStation + Xbox.

The test compares, on games the model never saw, the model's total, the sum of the
platforms and their mix, against each game's last published total carried to today.

    ../ml/.venv/bin/python consoles.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

import bench
from dataset import latest_snapshot
from learned import BEST

MIN_REVIEWS = 10          # under this, Steam says nothing about the PC version
CARRY_MAX_DAYS = 365      # a total with no Steam reviews to carry it must be this recent
REPEATS = 3


def platform_figures(figures: pd.DataFrame, catalog: pd.DataFrame) -> pd.DataFrame:
    """Last published sales of each game on PlayStation and on Xbox, with today's ratings.
    The total of a game sold on one console only is that console's figure."""
    c = catalog.set_index("gameId")
    sales = figures[figures.measure == "ventes"]
    out = []
    for platform, ratings, flag, others in (("PLAYSTATION", "psRatings", "onPlaystation", ["onPc", "onXbox"]),
                                            ("XBOX", "xboxRatings", "onXbox", ["onPc", "onPlaystation"])):
        alone = c.index[c[flag] & ~c[others].any(axis=1)]
        rows = sales[(sales.target == platform) | ((sales.target == "TOTAL") & sales.gameId.isin(alone))]
        last = rows.sort_values("reportedAt").groupby("gameId").tail(1)
        last = last[last.gameId.isin(c.index)]
        out.append(pd.DataFrame({"gameId": last.gameId, "platform": platform, "units": last.units,
                                 "ratings": last.gameId.map(c[ratings]).to_numpy(), "gamePass": last.gameId.map(c.gamePass).to_numpy()}))
    out = pd.concat(out)
    return out[out.ratings > 0]


def fit_ratios(pairs: pd.DataFrame) -> dict:
    """Typical sales per rating: PlayStation, Xbox, and Xbox for Game Pass games (their
    ratings also come from subscribers who did not buy)."""
    per = pairs.units / pairs.ratings
    xbox = pairs.platform == "XBOX"
    ratios = {"PLAYSTATION": float(per[pairs.platform == "PLAYSTATION"].median()), "XBOX": float(per[xbox & ~pairs.gamePass].median())}
    in_pass = per[xbox & pairs.gamePass]
    ratios["XBOX_GAME_PASS"] = float(in_pass.median()) if len(in_pass) >= 5 else ratios["XBOX"] / 2
    return ratios


def console_units(catalog: pd.DataFrame, ratios: dict) -> pd.DataFrame:
    """PlayStation and Xbox sales of each game from its ratings today (0 when not on the
    console, NaN when on it but without ratings)."""
    ps = np.where(catalog.onPlaystation, catalog.psRatings.where(catalog.psRatings > 0) * ratios["PLAYSTATION"], 0.0)
    xbox_ratio = np.where(catalog.gamePass, ratios["XBOX_GAME_PASS"], ratios["XBOX"])
    xbox = np.where(catalog.onXbox, catalog.xboxRatings.where(catalog.xboxRatings > 0) * xbox_ratio, 0.0)
    return pd.DataFrame({"ps": ps, "xbox": xbox}, index=catalog.index)


RAISED = "modèle, relevé par les notes console"
CONSOLE_ONLY = "notes console"


def combine(model_total: pd.Series, model_pc: pd.Series, consoles: pd.DataFrame, catalog: pd.DataFrame) -> pd.DataFrame:
    """The estimate kept for each game, and how it was reached.

    A game sold at least what its consoles sold plus its PC version. When that sum is
    above the model's total, the model missed a console-heavy game and the sum is kept;
    otherwise the model stands (mixing the two everywhere gained nothing). With fewer
    than 10 Steam reviews there is no model: the console sales alone are kept.
    """
    reviews = (catalog.steamReviews >= MIN_REVIEWS).to_numpy()
    console = (consoles.ps.fillna(0) + consoles.xbox.fillna(0)).to_numpy()
    floor = console + np.where(catalog.onPc & reviews, model_pc, 0.0)
    estimate = np.where(reviews, np.maximum(model_total, floor), np.where(console > 0, console, np.nan))
    basis = np.where(reviews, np.where(floor > model_total, RAISED, "modèle"), np.where(console > 0, CONSOLE_ONLY, ""))
    return pd.DataFrame({"consoleUnits": console, "estimate": estimate, "basis": basis}, index=catalog.index)


def labels_today(figures: pd.DataFrame, catalog: pd.DataFrame, now: pd.Timestamp) -> pd.Series:
    """Each game's last published total carried to today by the growth of its Steam
    reviews; a total with no reviews to carry it counts as is when it is recent."""
    totals = figures[(figures.target == "TOTAL") & (figures.measure == "ventes")].sort_values("reportedAt")
    last = totals.groupby("gameId").tail(1).set_index("gameId")
    last = last[last.index.isin(catalog.gameId)]
    today = catalog.set_index("gameId").steamReviews.reindex(last.index)
    growth = today / last.steamReviewsAtDate
    carried = last.units * growth.where(np.isfinite(growth) & (growth >= 1))
    recent = (now - last.reportedAt).dt.days <= CARRY_MAX_DAYS
    return carried.fillna(last.units.where(recent)).dropna()


def main() -> None:
    from estimate_catalog import rows_today  # same rows as the catalog estimate

    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    catalog = pd.read_parquet(snapshot / "catalog.parquet")
    games = pd.read_parquet(snapshot / "raw" / "games.parquet").set_index("id")
    catalog["gamePass"] = catalog.gameId.map(games.gamePass).fillna(False).to_numpy(bool)
    now = pd.Timestamp(json.loads((snapshot / "manifest.json").read_text())["exportedAt"])
    dev = figures[~figures.locked]
    label = labels_today(dev, catalog, now)
    c = catalog[catalog.gameId.isin(label.index)].reset_index(drop=True)

    def one(repeat: int, k: int) -> pd.DataFrame:
        fold = c.gameId.map(lambda g: bench.fold_of(g, repeat)) == k
        train = dev[dev.gameId.map(lambda g: bench.fold_of(g, repeat)) != k]
        model = BEST()
        model.fit(train)
        test = c[fold]
        ratios = fit_ratios(platform_figures(train, catalog))
        total = pd.Series(model.predict(rows_today(test, now, "TOTAL")).estimate.to_numpy(), index=test.index)
        pc = pd.Series(model.predict(rows_today(test, now, "PC")).estimate.to_numpy(), index=test.index)
        out = combine(total, pc, console_units(test, ratios), test)
        return out.assign(gameId=test.gameId, model=total, repeat=repeat, reviews=test.steamReviews,
                          consoles=test.onPlaystation | test.onXbox)

    p = pd.concat(Parallel(n_jobs=-1)(delayed(one)(r, k) for r in range(REPEATS) for k in range(bench.FOLDS)))
    p["label"] = p.gameId.map(label)
    factor = lambda est, rows: float(np.mean([np.exp(np.abs(np.log(est[rows.repeat == r] / rows.label[rows.repeat == r])).median())
                                              for r in range(REPEATS)]))
    bias = lambda est, rows: float(np.exp(np.log(est / rows.label).median()))
    groups = {"Tous les jeux estimés": p[p.basis != ""],
              "Le modèle est gardé tel quel": p[p.basis == "modèle"],
              "Le modèle est relevé par les notes console": p[p.basis == RAISED],
              "Moins de 10 reviews Steam : notes console seules": p[p.basis == CONSOLE_ONLY]}
    rows = [{"group": name, "games": int(part.gameId.nunique()), "model": factor(part.model, part), "modelBias": bias(part.model, part),
             "kept": factor(part.estimate, part), "keptBias": bias(part.estimate, part)}
            for name, part in groups.items() if part.gameId.nunique() >= 5]
    ratios = fit_ratios(platform_figures(dev, catalog))
    pairs = platform_figures(dev, catalog)
    spread = {plat: float(np.exp((np.log(g.units / g.ratings) - np.log(g.units / g.ratings).median()).abs().median()))
              for plat, g in pairs.groupby("platform")}
    result = {"ratios": ratios, "pairs": pairs.groupby("platform").size().to_dict(), "spread": spread, "rows": rows}
    (snapshot / "consoles.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps({k: result[k] for k in ("ratios", "pairs", "spread")}, ensure_ascii=False))
    for r in rows:
        print(f"{r['group']:<50} {r['games']:>4} jeux | modèle ×{r['model']:.2f} (biais ×{r['modelBias']:.2f}) | "
              f"retenu ×{r['kept']:.2f} (biais ×{r['keptBias']:.2f})")


if __name__ == "__main__":
    main()

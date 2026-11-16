"""Exploration (2026-11-15): could the V2 give per-platform sales (PC, PlayStation, Xbox)?

Read-only, nothing here feeds the catalog or the backend. Three questions:
1. how well each V2 ingredient matches published platform figures;
2. on games that published both a platform figure and a total, whether the V2 shares
   match the published shares, under two split rules;
3. on the catalog today, whether the parts (model PC + console ratings) add up to the
   total the site shows.

    ../ml/.venv/bin/python platforms.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import bench
import consoles

CATALOG = Path("data/2026-11-09T1952")  # the frozen snapshot, the one with catalog_estimates
SAME_PERIOD_DAYS = 90                    # a platform figure and a total this close share a date
MODEL, ANCHORED = "modèle", "ancré sur un chiffre publié"


def factor(log_ratio: pd.Series) -> str:
    return f"×{np.exp(log_ratio.abs().median()):.2f} (biais ×{np.exp(log_ratio.median()):.2f})"


def model_by_platform(snapshot: Path) -> None:
    """Out-of-fold estimates of the reference model, by type of published figure."""
    figures = pd.read_parquet(snapshot / "figures.parquet").set_index("figureId")
    path = snapshot / "bench" / "h27_width_by_signals.parquet"
    if not path.exists():
        print(f"pas de banc H27 dans {snapshot.name}")
        return
    b = pd.read_parquet(path).join(figures[["target", "measure", "units", "gameId"]], on="figureId")
    b = b[b.measure == "ventes"]
    b["r"] = np.log(b.estimate / b.units)
    print(f"\n1a. Modèle seul, par type de chiffre ({snapshot.name})")
    for (test, target), g in b.groupby(["test", "target"]):
        print(f"  {test:<5} {target:<12} {g.gameId.nunique():>4} jeux  {factor(g.r)}")


def ratings_leave_one_out(snapshot: Path) -> None:
    """Console sales = store ratings × the median of the other games, against each game's
    last published console figure."""
    figures = bench.load_figures(snapshot)
    catalog = pd.read_parquet(snapshot / "catalog.parquet")
    games = pd.read_parquet(snapshot / "raw" / "games.parquet").set_index("id")
    catalog["gamePass"] = catalog.gameId.map(games.gamePass).fillna(False).to_numpy(bool)
    now = pd.Timestamp(json.loads((snapshot / "manifest.json").read_text())["exportedAt"])
    pairs = consoles.platform_figures(figures, catalog).reset_index(drop=True)
    sales = figures[figures.measure == "ventes"].sort_values("reportedAt")
    last = sales.groupby(["gameId", "target"]).tail(1).set_index(["gameId", "target"]).reportedAt
    pairs["ageDays"] = [(now - last.get((g, p), last.get((g, "TOTAL")))).days for g, p in zip(pairs.gameId, pairs.platform)]
    pairs["perRating"] = np.log(pairs.units / pairs.ratings)
    print(f"\n1b. Notes du store × coefficient, chaque jeu jugé sans lui-même ({snapshot.name})")
    for platform, q in pairs.groupby("platform"):
        err = []
        for i in q.index:
            rest = q.drop(i)
            same = rest[rest.gamePass == q.gamePass[i]]
            ref = same if platform == "XBOX" and len(same) >= 5 else rest
            err.append(q.perRating[i] - ref.perRating.median())
        q = q.assign(e=err)
        for label, part in (("tous", q), ("chiffre < 1 an", q[q.ageDays < 365]), ("chiffre ≥ 1 an", q[q.ageDays >= 365])):
            print(f"  {platform:<12} {label:<15} {len(part):>3} jeux  {factor(part.e)}")


def catalog_parts(snapshot: Path) -> pd.DataFrame:
    """Each estimated game with its parts today: model PC, PlayStation and Xbox from ratings."""
    e = pd.read_parquet(snapshot / "catalog_estimates.parquet").set_index("gameId")
    c = pd.read_parquet(snapshot / "catalog.parquet").set_index("gameId").reindex(e.index)
    games = pd.read_parquet(snapshot / "raw" / "games.parquet").set_index("id")
    ratios = json.loads((snapshot / "consoles.json").read_text())["ratios"]
    game_pass = games.gamePass.reindex(e.index).fillna(False).astype(bool)
    xbox_ratio = np.where(game_pass, ratios["XBOX_GAME_PASS"], ratios["XBOX"])
    e["ps"] = np.where(e.onPlaystation, c.psRatings.fillna(0) * ratios["PLAYSTATION"], 0.0)
    e["xbox"] = np.where(e.onXbox, c.xboxRatings.fillna(0) * xbox_ratio, 0.0)
    e["pc"] = np.where(e.onPc & (e.steamReviews >= consoles.MIN_REVIEWS), e.modelPc, 0.0)
    return e[e.estimate > 0]


def split_rules(e: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Two ways to cut the total. A: shares of the parts. B: model PC kept, the consoles
    take the rest, divided by their ratings."""
    parts = e.pc + e.ps + e.xbox
    a = pd.DataFrame({"PC": e.pc, "PLAYSTATION": e.ps, "XBOX": e.xbox}).div(parts, axis=0)
    pc = np.minimum(e.pc, e.estimate) / e.estimate
    console = e.ps + e.xbox
    n_ps, n_xbox = e.onPlaystation.astype(float), e.onXbox.astype(float)
    w_ps = np.where(console > 0, e.ps / console.replace(0, np.nan), n_ps / (n_ps + n_xbox).replace(0, np.nan))
    on_console = (n_ps + n_xbox) > 0
    b = pd.DataFrame({"PC": np.where(on_console, pc, 1.0),
                      "PLAYSTATION": (1 - pc) * np.nan_to_num(w_ps),
                      "XBOX": (1 - pc) * (1 - np.nan_to_num(w_ps)) * on_console}, index=e.index)
    return {"A parts": a, "B PC fixe": b}


def published_shares(snapshot: Path, e: pd.DataFrame, rules: dict[str, pd.DataFrame]) -> None:
    figures = pd.read_parquet(snapshot / "figures.parquet")
    figures = figures[(figures.status == "gardé") & (figures.measure == "ventes")]
    totals = figures[figures.target == "TOTAL"][["gameId", "reportedAt", "units"]]
    print(f"\n2. Part d'une plateforme dans le total : publiée vs V2 (chiffres à ≤ {SAME_PERIOD_DAYS} j d'écart)")
    print("   ces jeux ont servi à entraîner le modèle du catalogue : résultat flatteur")
    for platform in ("PC", "PLAYSTATION", "XBOX"):
        q = figures[figures.target == platform][["gameId", "reportedAt", "units"]].merge(totals, on="gameId", suffixes=("", "Total"))
        q = q[(q.reportedAt - q.reportedAtTotal).abs().dt.days <= SAME_PERIOD_DAYS]
        share = (q.units / q.unitsTotal).groupby(q.gameId).median()
        share = share[share.index.isin(e.index) & (share > 0)]
        line = f"  {platform:<12} {len(share):>3} jeux, part publiée médiane {share.median():.2f}"
        for name, rule in rules.items():
            line += f" | {name} {factor(np.log(rule.loc[share.index, platform].clip(lower=1e-3) / share))}"
        print(line)


def coherence(e: pd.DataFrame, rules: dict[str, pd.DataFrame]) -> None:
    multi = e.onPc & (e.onPlaystation | e.onXbox)
    print("\n3. Catalogue : les parties (PC modèle + notes console) couvrent-elles le total affiché ?")
    covered = (e.pc + e.ps + e.xbox) / e.estimate
    for basis in (MODEL, ANCHORED):
        for label, rows in (("PC seul", ~(e.onPlaystation | e.onXbox)), ("PC + consoles", multi)):
            part = covered[(e.basis == basis) & rows]
            print(f"  {basis:<28} {label:<14} {len(part):>5} jeux  couvert : médiane {part.median():.2f} "
                  f"(10 % {part.quantile(.1):.2f}, 90 % {part.quantile(.9):.2f})")
    m = e[(e.basis == MODEL) & multi & (e.steamReviews > 0)]
    m = m.assign(size=pd.cut(m.steamReviews, [0, 1_000, 10_000, 100_000, 1e9]))
    per = pd.DataFrame({"total": m.estimate, "PC": m.pc, "consoles": m.ps + m.xbox}).div(m.steamReviews, axis=0)
    print("\n  Ventes par review Steam, jeux multi estimés par le modèle (médianes)")
    print(per.groupby(m["size"], observed=True).median().round(0).assign(jeux=m.groupby("size", observed=True).size()).to_string())
    print("\n  Répartition médiane selon la règle, ces mêmes jeux")
    for name, rule in rules.items():
        print(f"  {name:<10} " + ", ".join(f"{k} {v:.2f}" for k, v in rule.loc[m.index].median().items()))


def published_level(snapshot: Path) -> None:
    """Published totals per Steam review at their date: games also on consoles vs PC only."""
    figures = pd.read_parquet(snapshot / "figures.parquet")
    catalog = pd.read_parquet(snapshot / "catalog.parquet").set_index("gameId")
    f = figures[(figures.status == "gardé") & (figures.measure == "ventes") & (figures.target == "TOTAL")
                & figures.gameId.isin(catalog.index) & (figures.steamReviewsAtDate > 0)]
    c = catalog.loc[f.gameId]
    f = f.assign(kind=np.where(c[["onPlaystation", "onXbox"]].any(axis=1).to_numpy(), "PC + consoles", "PC seul"),
                 per=f.units / f.steamReviewsAtDate, size=pd.cut(f.steamReviewsAtDate, [0, 1_000, 10_000, 100_000, 1e9]))
    last = f.sort_values("reportedAt").groupby("gameId").tail(1)
    print(f"\n4. Totaux publiés par review Steam à leur date, dernier chiffre de chaque jeu ({snapshot.name})")
    print(last.groupby(["size", "kind"], observed=True).per.agg(jeux="count", médiane="median").round(0).to_string())


def main() -> None:
    latest = sorted(Path("data").glob("2026-*"))[-1]
    model_by_platform(latest)
    ratings_leave_one_out(latest)
    e = catalog_parts(CATALOG)
    rules = split_rules(e)
    published_shares(CATALOG, e, rules)
    coherence(e, rules)
    published_level(latest)


if __name__ == "__main__":
    main()

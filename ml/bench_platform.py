"""Banc PC / PlayStation : peut-on mieux estimer les ventes par plateforme ?

Le banc principal ne juge que les chiffres monde. Ici on juge les chiffres PC et
PlayStation publiés, à leur date, sur des jeux jamais vus :

  - Site : l'estimation de la plateforme par la formule du site ;
  - Site recalibré : la même, multipliée par un seul nombre appris ;
  - En prod : la v1.2 monde × la part de la plateforme selon la formule (J+3,
    300 k et 1 000 reviews, sinon le site), comme la ligne affichée sur le site ;
  - Direct : forêt + linéaire appris sur les seuls chiffres de la plateforme ;
  - Correction : forêt + linéaire qui apprennent l'erreur de la formule ;
  - Commun : forêt + linéaire appris sur les chiffres monde, PC et PlayStation,
    avec la plateforme en information.

Les chiffres de la fuite Steam (joueurs, juillet 2018) ne sont jamais jugés. Une
variante les ajoute à l'entraînement PC. Même chose sur PlayStation avec les joueurs
de l'archive Gamstat (novembre 2020), si le fichier est donné. Les chiffres d'Alinea restent à
l'entraînement et sont jugés à part : on ne dispose d'aucun chiffre officiel
récent par plateforme.

    .venv/bin/python bench_platform.py [gamstat.csv]
"""

from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import bench
import exclusions
from backtest import compute_backtest, to_us
from baseline import Estimator
from baseline.matcher import _time_us
from features import INTERACTION_FEATURES, TRACK_RECORD_FEATURES, FeatureBuilder, build_feature_table
from checks import ML_MIN_SITE_UNITS, ML_MIN_STEAM_REVIEWS
from frozen import ML_MIN_DAYS
from labels import flag_suspects
from snapshot import load_snapshot

PLATFORMS = ("PC", "PLAYSTATION")
SITE, RECAL, PROD = "Site", "Site recalibré", "En prod (monde × part du site)"
DIRECT, CORRECTION, POOLED = "Direct", "Correction du site", "Commun"
DIRECT_LEAK, POOLED_LEAK = "Direct + joueurs de la fuite", "Commun + joueurs de la fuite"
GAMSTAT_DATE = pd.Timestamp("2020-11-19", tz="UTC")
BOOTSTRAP = 300
PLATFORM_FEATURES = ["log_platform_baseline", "log_platform_age_days", "log_platform_share"]
POOL_FEATURES = ["is_pc", "is_ps"]


def platform_rows(snap, est: Estimator, builder: FeatureBuilder) -> pd.DataFrame:
    """Une ligne par chiffre PC ou PlayStation réel, estimable à sa date."""
    res = compute_backtest(snap, est, platforms=set(PLATFORMS))
    rows = res.rows[res.rows.hasEstimate & ~res.rows.isEstimate]
    milestones = snap.milestones.set_index("id")
    release = {(r.gameId, r.platform): _time_us(r.releaseDate) for r in snap.platform_release_dates.itertuples(index=False)}
    out = []
    for r in rows.itertuples(index=False):
        t = to_us(r.reportedAt)
        feats = builder.row(r.gameId, t)
        if feats is None:
            continue
        mid = (r.estLow + r.estHigh) / 2
        m = milestones.loc[r.milestoneId]
        out.append({
            "milestoneId": r.milestoneId, "gameId": r.gameId, "gameName": r.gameName, "source": r.source,
            "platform": r.platform, "reportedAt": r.reportedAt, "units": r.units, "y": math.log(r.units),
            "text": f"{m.sourceUrl or ''} {m.note or ''}".lower(), "platformMid": mid,
            "platformRelease": release.get((r.gameId, r.platform)), "t_us": t, **feats,
        })
    return pd.DataFrame(out)


def gamstat_rows(path: str, est: Estimator, builder: FeatureBuilder) -> pd.DataFrame:
    """Joueurs PlayStation de l'archive Gamstat : des joueurs, pas des ventes, comme la fuite Steam."""
    t = to_us(GAMSTAT_DATE)
    out = []
    for r in pd.read_csv(path).dropna(subset=["players"]).itertuples(index=False):
        e = est.estimate(r.gameId, t, holdout_game_id=r.gameId)
        rng = e.for_platform("PLAYSTATION") if e else None
        feats = builder.row(r.gameId, t)
        if not rng or rng[1] <= 0 or feats is None:
            continue
        out.append({"milestoneId": f"gamstat-{r.gameId}", "gameId": r.gameId, "gameName": r.url, "source": "GAMSTAT",
                    "platform": "PLAYSTATION", "reportedAt": GAMSTAT_DATE, "units": r.players, "y": math.log(r.players),
                    "text": "", "platformMid": (rng[0] + rng[1]) / 2, "platformRelease": None, "t_us": t, **feats})
    return pd.DataFrame(out)


def add_platform_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    us_per_day = 86_400 * 1_000_000
    release = df.platformRelease.astype("float64")
    age = ((df.t_us - release) / us_per_day).clip(lower=0).fillna(np.expm1(df.log_age_days))
    df["log_platform_baseline"] = np.log(df.platformMid.clip(lower=1))
    df["log_platform_age_days"] = np.log1p(age)
    df["log_platform_share"] = np.log((df.platformMid / df.baselineMid).clip(1e-3, 1))
    df["is_pc"] = (df.platform == "PC").astype(float)
    df["is_ps"] = (df.platform == "PLAYSTATION").astype(float)
    return df


def global_as_pool(table: pd.DataFrame) -> pd.DataFrame:
    """Les chiffres monde au format de la table commune : la « plateforme » y est le total."""
    return table.assign(platform="GLOBAL", platformMid=table.baselineMid, platformRelease=np.nan,
                        is_pc=0.0, is_ps=0.0, log_platform_baseline=table.log_baseline,
                        log_platform_age_days=table.log_age_days, log_platform_share=0.0)


def _specs(tag_cols: list[str]) -> dict[str, bench.ModelSpec]:
    trees = bench.TREE_FEATURES + TRACK_RECORD_FEATURES + PLATFORM_FEATURES
    linear = bench.all_features(tag_cols) + TRACK_RECORD_FEATURES + INTERACTION_FEATURES + PLATFORM_FEATURES

    def ensemble(name: str, extra: list[str]) -> bench.ModelSpec:
        return bench.ModelSpec(name, "", "ensemble", members=[
            bench.ModelSpec(f"{name} (forêt)", "", "forest", trees + extra),
            bench.ModelSpec(f"{name} (linéaire)", "", "ridge", linear + extra)])

    return {DIRECT: ensemble(DIRECT, []), CORRECTION: ensemble(CORRECTION, []), POOLED: ensemble(POOLED, POOL_FEATURES)}


def predict_fold(train_platform: pd.DataFrame, train_global: pd.DataFrame, test: pd.DataFrame,
                 ml_spec: bench.ModelSpec, specs: dict[str, bench.ModelSpec], leak: pd.DataFrame | None) -> dict[str, np.ndarray]:
    """log(ventes) prédit par chaque méthode pour `test`, entraîné sans ses jeux."""
    site = test.log_platform_baseline.to_numpy()
    offset = np.median((train_platform.y - train_platform.log_platform_baseline).to_numpy())

    ml, _ = bench._fit_core(ml_spec, train_global, None)
    applies = ((test.baselineMid >= ML_MIN_SITE_UNITS) & (np.expm1(test.log_reviews) >= ML_MIN_STEAM_REVIEWS)
               & (np.expm1(test.log_age_days) >= ML_MIN_DAYS)).to_numpy()
    prod = np.where(applies, ml(test) + test.log_platform_share.to_numpy(), site)

    direct, _ = bench._fit_core(specs[DIRECT], train_platform, None)
    residual = train_platform.assign(y=train_platform.y - train_platform.log_platform_baseline)
    correction, _ = bench._fit_core(specs[CORRECTION], residual, None)
    pooled, _ = bench._fit_core(specs[POOLED], pd.concat([train_global, train_platform], ignore_index=True), None)
    preds = {SITE: site, RECAL: site + offset, PROD: prod, DIRECT: direct(test),
             CORRECTION: site + correction(test), POOLED: pooled(test)}
    if leak is not None:
        with_leak, _ = bench._fit_core(specs[DIRECT], pd.concat([train_platform, leak], ignore_index=True), None)
        preds[DIRECT_LEAK] = with_leak(test)
        pooled_leak, _ = bench._fit_core(specs[POOLED], pd.concat([train_global, train_platform, leak], ignore_index=True), None)
        preds[POOLED_LEAK] = pooled_leak(test)
    return preds


def to_long(test: pd.DataFrame, preds: dict[str, np.ndarray]) -> pd.DataFrame:
    keep = test[["milestoneId", "gameId", "gameName", "source", "platform", "reportedAt", "units", "origin", "log_platform_age_days"]]
    return pd.concat([keep.assign(model=name, logErr=p - test.y.to_numpy()) for name, p in preds.items()], ignore_index=True)


def score(long: pd.DataFrame) -> pd.DataFrame:
    """Erreur par méthode + probabilité de battre le site et la prod (tirages par jeu)."""
    rng = np.random.default_rng(bench.SEED)
    wide = long.pivot_table(index=["milestoneId", "gameId"], columns="model", values="logErr").reset_index()
    groups = [g.index.to_numpy() for _, g in wide.groupby("gameId")]
    draws = [np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))]) for _ in range(BOOTSTRAP)]
    rows = []
    for model, d in long.groupby("model", sort=False):
        err = d.logErr.abs().to_numpy()
        values = wide[model].abs().to_numpy()
        vs = {ref: float(np.mean([np.median(values[i]) < np.median(wide[ref].abs().to_numpy()[i]) for i in draws]))
              for ref in (SITE, PROD) if ref != model}
        rows.append({
            "méthode": model, "chiffres": len(d), "jeux": d.gameId.nunique(),
            "facteur": f"×{math.exp(np.median(err)):.2f}", "±20 %": f"{(err <= math.log(1.2)).mean():.0%}",
            "×1,5": f"{(err <= math.log(1.5)).mean():.0%}", "×2": f"{(err <= math.log(2)).mean():.0%}",
            "biais": f"×{math.exp(d.logErr.median()):.2f}",
            "bat le site": f"{vs[SITE]:.0%}" if SITE in vs else "",
            "bat la prod": f"{vs[PROD]:.0%}" if PROD in vs else "",
        })
    return pd.DataFrame(rows)


def section(long: pd.DataFrame, title: str) -> list[str]:
    if long.empty:
        return [f"### {title}\n", "Aucun chiffre.\n"]
    return [f"### {title}\n", score(long).to_markdown(index=False), ""]


def main() -> None:
    t0 = time.time()
    snap = load_snapshot()
    est = Estimator(snap)
    table, tag_cols = build_feature_table(snap, est, compute_backtest(snap, est))
    by = {s.name: s for s in bench.model_specs(tag_cols)}
    table = table.join(flag_suspects(table, [by["Forêt aléatoire"], by["Linéaire + interactions"]], bench.SEED))
    builder = FeatureBuilder(snap, est, tag_cols)
    rows = platform_rows(snap, est, builder)
    if len(sys.argv) > 1:
        rows = pd.concat([rows, gamstat_rows(sys.argv[1], est, builder)], ignore_index=True)
    rows = add_platform_columns(rows)
    rows = rows[~rows.gameId.isin(exclusions.excluded_ids())]
    rows["origin"] = np.select([rows.text.str.contains("alinea|rhys elliott"), rows.source.str.contains("LEAK"),
                                rows.source.isin(["OFFICIAL", "ANNOUNCEMENT"])], ["Alinea", "Fuite", "Officiel"], "Média")
    # La fuite PlayStation donne de vraies ventes ; Steam et Gamstat comptent des joueurs.
    steam_leak = rows.source.isin(["STEAM_LEAK", "GAMSTAT"])
    pool = global_as_pool(bench._clean(table))
    ml_spec = by[bench.ML_MODEL]
    specs = _specs(tag_cols)
    print(f"{len(rows)} chiffres par plateforme, {len(pool)} chiffres monde ({time.time() - t0:.0f}s)")

    lines = [f"# Banc PC / PlayStation — snapshot {snap.path.name}\n",
             "Chiffres publiés de chaque plateforme, à leur date, sur des jeux jamais vus. Fuite Steam jamais jugée. "
             "« bat le site » et « bat la prod » : part des tirages de jeux où la méthode fait mieux.\n"]
    for platform in PLATFORMS:
        judged = rows[(rows.platform == platform) & ~steam_leak].reset_index(drop=True)
        leak = rows[(rows.platform == platform) & steam_leak].reset_index(drop=True)
        leak = leak if len(leak) else None
        parts = []
        folds = GroupKFold(n_splits=bench.N_FOLDS, shuffle=True, random_state=bench.SEED).split(judged, groups=judged.gameId)
        for tr, te in folds:
            test, train = judged.iloc[te], judged.iloc[tr]
            seen = set(test.gameId)
            parts.append(to_long(test, predict_fold(train, pool[~pool.gameId.isin(seen)], test, ml_spec, specs,
                                                    None if leak is None else leak[~leak.gameId.isin(seen)])))
            print(f"{platform} : pli fait ({time.time() - t0:.0f}s)")
        long = pd.concat(parts, ignore_index=True)

        early = bench.TIME_CUTOFF
        old, new = judged[judged.reportedAt < early], judged[judged.reportedAt >= early]
        new = new[~new.gameId.isin(set(old.gameId))]
        temporal = to_long(new, predict_fold(old, pool[pool.reportedAt < early], new, ml_spec, specs,
                                             None if leak is None else leak[leak.reportedAt < early]))
        long.to_parquet(bench.REPORTS / f"bench_platform_{platform.lower()}_oof.parquet", index=False)

        lines += [f"## {platform}\n"]
        lines += section(long, "Validation croisée")
        lines += section(temporal, f"Test dans le temps (apprendre avant 2025, prédire 2025+ : {new.gameId.nunique()} jeux)")
        lines += section(long[long.origin != "Alinea"], "Sans les chiffres d'Alinea au jugement")
        lines += section(long[long.origin == "Alinea"], "Chiffres d'Alinea seulement")
        lines += section(long[long.units >= 1e6], "Gros jeux (1 M et plus)")
        lines += section(long[long.units < 1e6], "Plus petits (moins de 1 M)")
        lines += section(long[np.expm1(long.log_platform_age_days) <= 30], "30 jours ou moins après la sortie sur la plateforme")

    text = "\n".join(lines)
    print(text)
    path = Path(bench.REPORTS) / "bench_platform.md"
    path.write_text(text)
    print(f"\n→ {path} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()

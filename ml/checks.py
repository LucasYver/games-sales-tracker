"""Contrôles du banc d'essai au-delà de l'erreur moyenne.

Utilisés par bench.py (résultats affichés dans l'UI) et bench_v2.py :
  - l'erreur typique selon l'âge du jeu au chiffre publié ;
  - la courbe d'un jeu baisse-t-elle dans le temps ? (impossible pour des
    ventes cumulées) ;
  - tout le catalogue : le modèle comparé au site par taille de jeu, pas
    seulement sur les jeux qui publient leurs ventes ;
  - les chiffres « de lancement » suspects, à vérifier dans la base.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import bench
from baseline import Estimator
from baseline.matcher import _time_us
from bench import N_FOLDS, SEED, ModelSpec, _clean
from features import US_PER_DAY, FeatureBuilder
from frozen import ML_MIN_REVIEWS
from metrics import add_error_columns
from snapshot import released_in_scope

SITE = "Modèle actuel"
# Règle d'affichage du backend (`mlEstimateApplies`).
ML_MIN_SITE_UNITS, ML_MIN_STEAM_REVIEWS = 300_000, ML_MIN_REVIEWS
AGE_BUCKETS = ([-1, 3, 30, 365, 1e9], ["0-3 jours", "4-30 jours", "1-12 mois", "1 an et +"])
REVIEW_BUCKETS = ([-1, 100, 1_000, 10_000, 100_000, 1e12], ["< 100", "100-1k", "1k-10k", "10k-100k", "100k+"])


def _predictor(spec: ModelSpec, train: pd.DataFrame):
    """Prédiction en log ; une régression choisit sa régularisation comme au banc."""
    return bench.fit(spec, train).predict if spec.kind == "ridge" else bench._fit_core(spec, train, None)[0]


def release_of(est: Estimator, games: pd.DataFrame, game_id: str) -> int | None:
    return est.pc_release.get(game_id) or _time_us(games.loc[game_id, "releaseDate"])


def build_timeline(builder: FeatureBuilder, est: Estimator, games: pd.DataFrame, game_ids, until_us: int) -> pd.DataFrame:
    """Features de chaque jeu à J+1, J+3, … J+365 puis tous les 180 jours, jusqu'à `until_us`."""
    rows = []
    for gid in game_ids:
        rel = release_of(est, games, gid)
        if rel is None:
            continue
        span = (until_us - rel) / US_PER_DAY
        for day in bench.TIMELINE_DAYS + list(range(540, int(span) + 1, 180)):
            t = rel + day * US_PER_DAY
            if t > until_us:
                break
            f = builder.row(gid, t)
            if f:
                rows.append({"gameId": gid, "t_us": t, "day": day, **f})
    return pd.DataFrame(rows)


def drop_stats(timeline: pd.DataFrame, predicted: np.ndarray) -> dict:
    """Part des pas de temps (et des jeux) où l'estimation baisse de plus de 5 %."""
    df = timeline[["gameId", "t_us"]].assign(p=predicted).sort_values(["gameId", "t_us"])
    ratio = np.exp(df.groupby("gameId").p.diff()).dropna()
    game_drop = (ratio < 0.95).groupby(df.loc[ratio.index, "gameId"]).any()
    return {"pas_en_baisse": float((ratio < 0.95).mean()), "jeux_avec_baisse": float(game_drop.mean()),
            "pire_baisse": float(ratio.min()) if len(ratio) else 1.0}


def timeline_check(specs: list[ModelSpec], dev: pd.DataFrame, timeline: pd.DataFrame) -> pd.DataFrame:
    """Frises prédites « hors pli » : chaque jeu par un modèle qui ne l'a pas vu."""
    preds = {s.name: np.full(len(timeline), np.nan) for s in specs}
    folds = GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED).split(dev, groups=dev.gameId)
    for tr, te in folds:
        train = _clean(dev.iloc[tr])
        mask = timeline.gameId.isin(set(dev.gameId.iloc[te])).to_numpy()
        for s in specs:
            predict = (lambda df: np.log(df.baselineMid.to_numpy())) if s.kind == "baseline" \
                else _predictor(s, train)
            preds[s.name][mask] = predict(timeline[mask])
    return pd.DataFrame([{"modèle": n, **drop_stats(timeline, p)} for n, p in preds.items()])


def catalog_check(specs: list[ModelSpec], dev: pd.DataFrame, catalog: pd.DataFrame) -> pd.DataFrame:
    """Modèle ÷ site sur tout le catalogue, par taille de jeu (reviews Steam)."""
    train = _clean(dev)
    reviews = np.expm1(catalog.log_reviews)
    bucket = pd.cut(reviews, bins=REVIEW_BUCKETS[0], labels=REVIEW_BUCKETS[1])
    rule = (catalog.baselineMid >= ML_MIN_SITE_UNITS) & (reviews >= ML_MIN_STEAM_REVIEWS)
    rows = []
    for s in specs:
        if s.kind == "baseline":
            continue
        ratio = pd.Series(np.exp(_predictor(s, train)(catalog)) / catalog.baselineMid.to_numpy(),
                          index=catalog.index)
        row = {"modèle": s.name}
        for b in REVIEW_BUCKETS[1]:
            row[b] = f"×{ratio[bucket == b].median():.2f}"
        row["zone affichée"] = f"×{ratio[rule].median():.2f} ({int(rule.sum())} jeux)"
        rows.append(row)
    return pd.DataFrame(rows)


def age_table(cv_preds: pd.DataFrame, dev: pd.DataFrame) -> pd.DataFrame:
    age = np.expm1(dev.set_index("milestoneId").log_age_days)
    scored = add_error_columns(_clean(cv_preds))
    scored["âge"] = pd.cut(scored.milestoneId.map(age), bins=AGE_BUCKETS[0], labels=AGE_BUCKETS[1])
    rows = []
    for name, df in scored.groupby("model", sort=False):
        row = {"modèle": name}
        for b, g in df.groupby("âge", observed=True):
            row[b] = f"×{g.factor.median():.2f} (biais ×{np.exp(g.logErr.median()):.2f})"
        rows.append(row)
    n = scored[scored.model == SITE].groupby("âge", observed=True).size()
    return pd.DataFrame(rows).rename(columns={b: f"{b} ({n.get(b, 0)})" for b in AGE_BUCKETS[1]})


def launch_suspects(cv_preds: pd.DataFrame, dev: pd.DataFrame, games: pd.DataFrame, est: Estimator) -> pd.DataFrame:
    """Chiffres à 3 jours ou moins de la sortie PC, plus de 3 fois au-dessus de TOUS les modèles.

    Souvent un total de plusieurs années rattaché à la date d'une réédition, d'un
    portage ou d'une version 1.0 : à vérifier dans la base.
    """
    d = dev.set_index("milestoneId")
    early = d[np.expm1(d.log_age_days) <= 3]
    best = cv_preds[cv_preds.model != SITE].groupby("milestoneId").estPoint.max()
    out = early.assign(estimation_max=best.reindex(early.index))
    out = out[out.units > 3 * out.estimation_max].copy()
    out["sortiePC"] = [pd.Timestamp(release_of(est, games, g), unit="us").date() for g in out.gameId]
    first = [games.loc[g, "releaseDate"] for g in out.gameId]
    out["premièreSortie"] = [pd.to_datetime(v).date() if pd.notna(v) else None for v in first]
    out["chiffre"] = out.units.map(lambda v: f"{v:,.0f}")
    out["modèles (max)"] = out.estimation_max.map(lambda v: f"{v:,.0f}")
    out["dateChiffre"] = out.reportedAt.dt.date
    return out.sort_values("units", ascending=False)[
        ["gameName", "dateChiffre", "chiffre", "modèles (max)", "sortiePC", "premièreSortie", "source"]]


def catalog_rows(builder: FeatureBuilder, games: pd.DataFrame, now_us: int) -> pd.DataFrame:
    """Features des jeux vivants, payants et sortis depuis 2017, à la date du snapshot."""
    alive = games[games.deletedAt.isna() & ~games.isFree.fillna(False).astype(bool)
                  & released_in_scope(games.releaseDate)].index
    return pd.DataFrame([{"gameId": g, "t_us": now_us, **f} for g in alive if (f := builder.row(g, now_us))])

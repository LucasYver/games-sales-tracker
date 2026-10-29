"""Banc d'essai : compare des modèles d'estimation du TOTAL, honnêtement.

Protocole (fixé AVANT d'entraîner quoi que ce soit) :

1. Test final sous clé. ~20 % des jeux (hachage de l'identifiant, voir
   `features.is_final_test`) sont mis de côté. On ne les regarde qu'une
   fois, à la toute fin, avec `--final`. Si on testait chaque idée dessus,
   on finirait par régler le modèle sur le test sans s'en rendre compte.

2. Validation croisée par jeu (sur les 80 % restants). Les jeux sont
   répartis en 5 groupes. Chaque groupe est prédit par un modèle entraîné
   sur les 4 autres : chaque chiffre est donc prédit par un modèle qui n'a
   jamais vu son jeu. Tous les réglages (régularisation, largeur de
   fourchette) sont choisis À L'INTÉRIEUR des 4 groupes d'entraînement
   (validation croisée imbriquée), jamais sur le groupe testé.

3. Test dans le temps. Apprendre sur les chiffres d'avant 2025, prédire
   ceux de 2025+ de jeux jamais vus avant : la situation réelle du site.

Chaque jeu pèse autant à l'entraînement (poids 1 / nb de chiffres du jeu),
pour ne pas apprendre surtout les quelques jeux très suivis.

Fourchettes : « prédiction conforme ». La demi-largeur (en ×) est le 80e
percentile des erreurs sur des jeux non vus de l'entraînement : la
fourchette doit contenir le vrai chiffre ~80 % du temps sur des jeux neufs.

Usage (depuis ml/) :
    .venv/bin/python bench.py           # validation croisée + test dans le temps
    .venv/bin/python bench.py --final   # À FAIRE UNE SEULE FOIS, à la fin
"""

from __future__ import annotations

import argparse
import math
import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from backtest import compute_backtest
from baseline import Estimator
import baseline.matcher as matcher_mod
from features import (BASELINE_FEATURE, FEATURE_LABELS, FOLLOWER_FEATURES, GAME_FEATURES, INTERACTION_FEATURES,
                      MATCHER_FEATURES, RELEASE_FEATURES, REVIEW_DYNAMICS_FEATURES, SIGNAL_FEATURES, TIME_FEATURES,
                      build_feature_table)
from labels import flag_suspects
from metrics import add_error_columns, format_table, game_weights, summarize, weighted_median
from snapshot import load_snapshot

REPORTS = Path(__file__).resolve().parent / "reports"
N_FOLDS = 5
SEED = 42
COVERAGE_TARGET = 0.80
ALPHAS = [0.3, 1, 3, 10, 30, 100]
TIME_CUTOFF = pd.Timestamp("2025-01-01", tz="UTC")
SAVED = REPORTS / "bench_result.pkl"

# Arbres : réglages prudents fixés à l'avance (pas choisis en regardant le
# test). « Plus de reviews / joueurs / notes ⇒ jamais moins de ventes » est
# imposé au gradient boosting (contrainte monotone), pour éviter des
# estimations absurdes qui baisseraient quand un signal monte.
MONOTONE = {"log_reviews": 1, "log_launch_ccu": 1, "log_peak_ccu": 1, "log_ps_ratings": 1, "log_xbox_ratings": 1}


GBM_DEFAULT = dict(learning_rate=0.04, max_iter=400, max_depth=3, min_samples_leaf=25, l2_regularization=1.0,
                   max_features=1.0)
FOREST_DEFAULT = dict(min_samples_leaf=5, max_features=0.5, max_depth=None)

# Réglage : valeurs essayées pour chaque paramètre. On tire 16 combinaisons au
# hasard (graine fixe, réglage par défaut toujours inclus) et on garde celle qui
# se trompe le moins sur des jeux non vus DE L'ENTRAÎNEMENT.
GBM_SPACE = dict(learning_rate=[0.02, 0.04, 0.08], max_iter=[200, 400, 800], max_depth=[2, 3, 4, 6],
                 min_samples_leaf=[10, 25, 50], l2_regularization=[0.0, 1.0, 5.0], max_features=[0.5, 1.0])
FOREST_SPACE = dict(min_samples_leaf=[1, 3, 5, 10, 20], max_features=[0.2, 0.33, 0.5, 0.7, 1.0],
                    max_depth=[None, 8, 16])
N_CANDIDATES = 16
FOREST_TREES, FOREST_SEARCH_TREES = 300, 150  # moins d'arbres pendant la recherche, pour aller plus vite


def make_gbm(features: list[str], hp: dict | None = None) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="absolute_error", monotonic_cst={k: v for k, v in MONOTONE.items() if k in features},
        random_state=SEED, **(hp or GBM_DEFAULT))


def make_forest(hp: dict | None = None) -> RandomForestRegressor:
    hp = {"n_estimators": FOREST_TREES, **(hp or FOREST_DEFAULT)}
    return RandomForestRegressor(n_jobs=-1, random_state=SEED, **hp)


def candidates(space: dict, default: dict) -> list[dict]:
    rng = np.random.default_rng(SEED)
    combos = [default]
    while len(combos) < N_CANDIDATES:
        c = {k: v[rng.integers(len(v))] for k, v in space.items()}
        if c not in combos:
            combos.append(c)
    return combos


def describe_hp(hp) -> str:
    """Réglage en clair, pour le rapport et l'UI."""
    if hp is None:
        return ""
    if not isinstance(hp, dict):
        return f"régularisation {hp:g}"
    parts = []
    if "learning_rate" in hp:
        parts += [f"{hp['max_iter']} arbres", f"pas {hp['learning_rate']:g}", f"profondeur {hp['max_depth']}",
                  f"≥ {hp['min_samples_leaf']} jeux par feuille", f"L2 {hp['l2_regularization']:g}",
                  f"{hp['max_features']:.0%} des infos par arbre"]
    else:
        depth = "illimitée" if hp.get("max_depth") is None else hp["max_depth"]
        parts += [f"{hp.get('n_estimators', FOREST_TREES)} arbres", f"profondeur {depth}",
                  f"≥ {hp['min_samples_leaf']} jeux par feuille", f"{hp['max_features']:.0%} des infos par question"]
    return " · ".join(parts)


def tree_nodes(model) -> int | None:
    """Taille d'un modèle à arbres (nombre total de nœuds) : ce qu'il faudrait exporter."""
    if isinstance(model, RandomForestRegressor):
        return int(sum(t.tree_.node_count for t in model.estimators_))
    if isinstance(model, HistGradientBoostingRegressor):
        return int(sum(len(p.nodes) for preds in model._predictors for p in preds))
    return None


# ─── Modèles ─────────────────────────────────────────────────────────────────

@dataclass
class ModelSpec:
    name: str
    description: str           # en clair, affiché dans le rapport et l'UI
    kind: str                  # "baseline" | "recalibrated" | "ridge" | "gbm" | "forest" | "forest_knn" | "ensemble"
    features: list[str] = field(default_factory=list)
    members: list["ModelSpec"] = field(default_factory=list)  # modèles moyennés (kind "ensemble")


NEW_FEATURES = REVIEW_DYNAMICS_FEATURES + FOLLOWER_FEATURES + RELEASE_FEATURES


def all_features(tag_cols: list[str]) -> list[str]:
    return SIGNAL_FEATURES + TIME_FEATURES + GAME_FEATURES + MATCHER_FEATURES + NEW_FEATURES + tag_cols


# Les arbres n'utilisent pas les tags : ils n'aidaient pas le modèle linéaire.
TREE_FEATURES = SIGNAL_FEATURES + TIME_FEATURES + GAME_FEATURES + MATCHER_FEATURES + NEW_FEATURES


# Familles d'informations retirées une à une dans l'ablation.
def feature_families() -> dict[str, list[str]]:
    return {
        "les signaux (reviews, joueurs, notes console)": SIGNAL_FEATURES,
        "le temps (âge, année de sortie, année du chiffre)": TIME_FEATURES,
        "les infos du jeu (plateformes, franchise, multijoueur, DLC…)": GAME_FEATURES,
        "les jeux voisins (matcher)": MATCHER_FEATURES,
        "la vitesse des reviews (30 j, 90 j, rythme récent)": REVIEW_DYNAMICS_FEATURES,
        "les followers Steam": FOLLOWER_FEATURES,
        "la sortie PC différée": RELEASE_FEATURES,
    }


def model_specs(tag_cols: list[str]) -> list[ModelSpec]:
    signals = all_features(tag_cols)
    no_neighbours = [f for f in signals if f not in MATCHER_FEATURES]
    return [
        ModelSpec("Modèle actuel", "La formule du site aujourd'hui (reviews × ratio des voisins, pic de joueurs, "
                                   "consoles). Rien n'est appris ici : c'est la référence à battre.", "baseline"),
        ModelSpec("Actuel recalibré", "La même estimation multipliée par un seul nombre appris (pour corriger sa "
                                      "tendance à viser trop bas), avec une fourchette recalculée.", "recalibrated",
                  [BASELINE_FEATURE]),
        ModelSpec("Linéaire (toutes les infos)", "Une régression linéaire qui apprend seule le poids de chaque "
                                                 f"information ({len(signals)} au total : reviews, joueurs, notes "
                                                 "console, âge, plateformes, genre, jeux voisins…).", "ridge", signals),
        ModelSpec("Linéaire (sans les voisins)", "La même régression sans les informations tirées des jeux voisins. "
                                                 "Ces informations viennent des ventes d'autres jeux : les retirer "
                                                 "écarte tout risque de fuite.", "ridge", no_neighbours),
        ModelSpec("Linéaire + interactions", "La régression linéaire, plus quelques produits d'informations (ex. "
                                             "reviews × année de sortie) : la règle peut changer selon le contexte, "
                                             "tout en restant une formule.", "ridge", signals + INTERACTION_FEATURES),
        ModelSpec("Gradient boosting", "Des centaines de petits arbres de décision construits l'un après l'autre. "
                                       "Chacun pose quelques questions oui/non (« plus de 50 000 reviews ? », « sorti "
                                       "il y a plus de 3 ans ? ») et corrige les erreurs des arbres précédents.",
                  "gbm", TREE_FEATURES),
        forest := ModelSpec("Forêt aléatoire", "300 arbres de décision indépendants. Chacun ne voit qu'une partie "
                                               "des jeux et des informations et pose sa propre série de questions ; la "
                                               "forêt fait la moyenne de leurs réponses, ce qui compense leurs erreurs "
                                               "individuelles.", "forest", TREE_FEATURES),
        ModelSpec("Forêt + voisins", "La forêt, puis une correction : on regarde de combien elle se trompe sur les "
                                     "15 jeux les plus similaires (similarité du site) dont on connaît les ventes, et "
                                     f"on corrige de {KNN_ALPHA:.0%} de cette erreur.", "forest_knn", TREE_FEATURES),
        ModelSpec("Moyenne forêt + linéaire", "La moyenne des estimations de la forêt et du linéaire + interactions. "
                                              "Deux façons de raisonner très différentes : leurs erreurs se compensent "
                                              "en partie.", "ensemble",
                  members=[forest, ModelSpec("Linéaire + interactions", "", "ridge", signals + INTERACTION_FEATURES)]),
    ]


class Fitted:
    """Un modèle entraîné : prédit log(ventes) et donne la demi-largeur de fourchette.

    `hp` = réglage retenu (régularisation pour une régression, dictionnaire
    pour des arbres) ; `model` = l'objet scikit-learn entraîné.
    """

    def __init__(self, spec: ModelSpec, predict, log_halfwidth: float | None, hp=None, model=None):
        self.spec, self.predict, self.log_halfwidth, self.hp, self.model = spec, predict, log_halfwidth, hp, model


def _weights(df: pd.DataFrame) -> np.ndarray:
    return game_weights(df)


def _fit_core(spec: ModelSpec, train: pd.DataFrame, hp):
    """Entraîne avec un réglage donné : renvoie (fonction de prédiction en log, modèle)."""
    if spec.kind == "recalibrated":
        c = weighted_median((train.y - train.log_baseline).to_numpy(), _weights(train))
        return (lambda df: df.log_baseline.to_numpy() + c), None
    if spec.kind == "ensemble":
        members = [fit(m, train).predict if m.kind == "ridge" else _fit_core(m, train, None)[0] for m in spec.members]
        return (lambda df: np.mean([p(df) for p in members], axis=0)), None
    if spec.kind == "forest_knn":
        return _fit_forest_knn(spec, train)
    if spec.kind.startswith(("gbm", "forest")):
        model = make_gbm(spec.features, hp) if spec.kind.startswith("gbm") else make_forest(hp)
        model.fit(train[spec.features], train.y, sample_weight=_weights(train))
        return (lambda df: model.predict(df[spec.features])), model
    pipe = make_pipeline(StandardScaler(), Ridge(alpha=hp))
    pipe.fit(train[spec.features], train.y, ridge__sample_weight=_weights(train))
    return (lambda df: pipe.predict(df[spec.features])), pipe


class GameSimilarity:
    """Similarité du site (13 critères, poids actuels) entre deux jeux, calculée à la demande."""

    def __init__(self, est: Estimator):
        self.matcher = est.matcher
        self.features: dict = {}
        self.cache: dict = {}

    def _f(self, game_id: str):
        if game_id not in self.features:
            self.features[game_id] = self.matcher.target_features(game_id)
        return self.features[game_id]

    def __call__(self, target: str, other: str) -> float:
        key = (target, other)
        if key not in self.cache:
            self.cache[key] = matcher_mod.similarity(self._f(other), self._f(target))
        return self.cache[key]


SIMILARITY: GameSimilarity | None = None
KNN_NEIGHBOURS = 15
KNN_ALPHA = 0.5  # force de la correction, fixée à l'avance (le milieu prudent de l'essai exploratoire)


def set_similarity(est: Estimator) -> None:
    global SIMILARITY
    SIMILARITY = GameSimilarity(est)


def _fit_forest_knn(spec: ModelSpec, train: pd.DataFrame):
    """Forêt + correction par les erreurs de la forêt sur les jeux similaires."""
    base = ModelSpec(spec.name, "", "forest", spec.features)
    predict, model = _fit_core(base, train, None)
    # Erreurs de la forêt sur des jeux qu'elle n'a pas vus (validation croisée interne).
    resid = np.empty(len(train))
    for tr, va in GroupKFold(n_splits=4, shuffle=True, random_state=SEED).split(train, groups=train.gameId):
        p, _ = _fit_core(base, train.iloc[tr], None)
        resid[va] = train.y.to_numpy()[va] - p(train.iloc[va])
    game_resid = pd.Series(resid, index=train.index).groupby(train.gameId).mean()
    known = list(game_resid.index)

    def correction(game_id: str) -> float:
        sims = sorted(((SIMILARITY(game_id, h), h) for h in known if h != game_id), reverse=True)[:KNN_NEIGHBOURS]
        w = np.array([s for s, _ in sims]) ** 2
        return float((w * game_resid[[h for _, h in sims]].to_numpy()).sum() / w.sum()) if w.sum() > 0 else 0.0

    def predict_knn(df: pd.DataFrame) -> np.ndarray:
        corr = {g: correction(g) for g in df.gameId.unique()}
        return predict(df) + KNN_ALPHA * df.gameId.map(corr).to_numpy()
    return predict_knn, model


def _inner_oof(spec: ModelSpec, train: pd.DataFrame, hp) -> np.ndarray:
    """Erreurs (en log) sur des jeux non vus, À L'INTÉRIEUR des données d'entraînement."""
    resid = np.empty(len(train))
    for tr, va in GroupKFold(n_splits=4, shuffle=True, random_state=SEED).split(train, groups=train.gameId):
        predict, _ = _fit_core(spec, train.iloc[tr], hp)
        resid[va] = train.y.to_numpy()[va] - predict(train.iloc[va])
    return resid


def fit(spec: ModelSpec, train: pd.DataFrame) -> Fitted:
    if spec.kind == "baseline":
        return Fitted(spec, lambda df: np.log(df.baselineMid.to_numpy()), None)
    hp, resid = None, None
    if spec.kind == "ridge":
        # Choix de la régularisation par validation croisée interne : on garde
        # celle qui se trompe le moins (erreur médiane) sur des jeux non vus.
        scores = {a: np.median(np.abs(_inner_oof(spec, train, a))) for a in ALPHAS}
        hp = min(scores, key=scores.get)
    elif spec.kind in ("gbm_tuned", "forest_tuned"):
        # Même principe pour les arbres, sur 16 combinaisons de réglages.
        gbm = spec.kind == "gbm_tuned"
        best = None
        for c in candidates(GBM_SPACE, GBM_DEFAULT) if gbm else candidates(FOREST_SPACE, FOREST_DEFAULT):
            trial = c if gbm else {**c, "n_estimators": FOREST_SEARCH_TREES}
            r = _inner_oof(spec, train, trial)
            score_ = np.median(np.abs(r))
            if best is None or score_ < best[0]:
                best = (score_, c, r)
        _, hp, resid = best
    if resid is None:
        resid = _inner_oof(spec, train, hp)
    predict, model = _fit_core(spec, train, hp)
    return Fitted(spec, predict, float(np.quantile(np.abs(resid), COVERAGE_TARGET)), hp, model)


def predict_frame(fitted: Fitted, df: pd.DataFrame) -> pd.DataFrame:
    keep = ["milestoneId", "gameId", "gameName", "source", "reportedAt", "units"] + (
        ["suspect"] if "suspect" in df.columns else [])
    out = df[keep].copy()
    out["model"] = fitted.spec.name
    if fitted.spec.kind == "baseline":
        out["estLow"], out["estHigh"] = df.estLow.to_numpy(), df.estHigh.to_numpy()
        out["estPoint"] = df.baselineMid.to_numpy()
    else:
        point = np.exp(fitted.predict(df))
        k = math.exp(fitted.log_halfwidth)
        out["estPoint"], out["estLow"], out["estHigh"] = point, point / k, point * k
    return out


# ─── Protocoles ──────────────────────────────────────────────────────────────

def cross_validate(specs: list[ModelSpec], dev: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Prédictions « hors pli » : chaque ligne prédite par un modèle qui n'a pas vu son jeu."""
    preds, choices = [], []
    folds = GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED).split(dev, groups=dev.gameId)
    for i, (tr, te) in enumerate(folds):
        train, test = _clean(dev.iloc[tr]), dev.iloc[te]
        for spec in specs:
            f = fit(spec, train)
            preds.append(predict_frame(f, test).assign(fold=i))
            choices.append({"pli": i + 1, "modèle": spec.name, "réglage": describe_hp(f.hp),
                            "demi-largeur": None if f.log_halfwidth is None else math.exp(f.log_halfwidth)})
    return pd.concat(preds, ignore_index=True), pd.DataFrame(choices)


def temporal_check(specs: list[ModelSpec], dev: pd.DataFrame) -> pd.DataFrame:
    """Apprendre avant 2025, prédire 2025+ sur des jeux jamais vus avant."""
    train = dev[dev.reportedAt < TIME_CUTOFF]
    test = dev[(dev.reportedAt >= TIME_CUTOFF) & ~dev.gameId.isin(set(train.gameId))]
    train = _clean(train)
    return pd.concat([predict_frame(fit(s, train), test) for s in specs], ignore_index=True)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Sans les chiffres publiés suspects (voir labels.py). La base n'est pas modifiée."""
    return df[~df.suspect] if "suspect" in df.columns else df


def score(preds: pd.DataFrame, bootstrap: int = 0, clean: bool = False) -> pd.DataFrame:
    """Métriques par modèle + écart avec le modèle actuel (bootstrap apparié par jeu).

    `clean=True` : jugé seulement sur les chiffres non suspects.
    """
    scored = add_error_columns(_clean(preds) if clean else preds)
    rows = []
    base = scored[scored.model == "Modèle actuel"].set_index("milestoneId")
    for name, df in scored.groupby("model", sort=False):
        s = summarize(df, bootstrap=bootstrap, seed=SEED)
        if bootstrap and name != "Modèle actuel":
            s.update(paired_gain(base, df.set_index("milestoneId"), bootstrap))
        rows.append({"modèle": name, **s})
    return pd.DataFrame(rows)


def paired_gain(base: pd.DataFrame, other: pd.DataFrame, n: int) -> dict:
    """Le gain sur l'erreur typique est-il réel ou dû au hasard ?

    On rejoue la comparaison sur des tirages de jeux (avec remise) ; si le
    modèle est meilleur dans plus de 95 % des tirages, le gain est solide.
    """
    ids = base.index.intersection(other.index)
    a, b = base.loc[ids], other.loc[ids]
    groups = list(pd.Series(np.arange(len(ids)), index=a.gameId.to_numpy()).groupby(level=0).apply(list))
    rng = np.random.default_rng(SEED)
    abs_a, abs_b = np.abs(a.logErr.to_numpy()), np.abs(b.logErr.to_numpy())
    wins = []
    for _ in range(n):
        idx = np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))])
        wins.append(np.median(abs_b[idx]) < np.median(abs_a[idx]))
    gain = 1 - math.exp(np.median(abs_b)) / math.exp(np.median(abs_a))
    return {"gain_erreur": gain, "proba_meilleur": float(np.mean(wins))}


def coefficients(fitted: Fitted) -> pd.DataFrame:
    """Ce que la régression a appris, traduit en effets lisibles."""
    scaler, ridge = fitted.model.named_steps["standardscaler"], fitted.model.named_steps["ridge"]
    coef = ridge.coef_ / scaler.scale_
    rows = []
    for feat, a, std in zip(fitted.spec.features, coef, scaler.scale_):
        if feat.startswith("log_"):
            effect, unit = 2 ** a, "si la valeur double"
        elif feat.endswith("_year"):
            effect, unit = math.exp(a), "par année en plus"
        elif feat == "matcher_pc_share":
            effect, unit = math.exp(0.1 * a), "pour +10 points de part PC"
        else:
            effect, unit = math.exp(a), "si oui"
        rows.append({"feature": feat, "description": FEATURE_LABELS.get(feat, feat), "effet": effect,
                     "quand": unit, "importance": abs(ridge.coef_[list(fitted.spec.features).index(feat)]),
                     # « a des X » sert juste à coder l'absence de X : ne se lit pas seul.
                     "technique": feat.startswith("has_") or feat in INTERACTION_FEATURES})
    return pd.DataFrame(rows).sort_values("importance", ascending=False)


ABLATION_MODEL = "Gradient boosting"


def ablation(dev: pd.DataFrame) -> pd.DataFrame:
    """Qu'apporte chaque famille d'informations ? On la retire, on réentraîne
    le gradient boosting sur les mêmes 5 groupes de jeux, et on remesure."""
    variants = {"toutes les infos": TREE_FEATURES} | {
        f"sans {name}": [f for f in TREE_FEATURES if f not in cols] for name, cols in feature_families().items()}
    preds = []
    folds = list(GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED).split(dev, groups=dev.gameId))
    for name, feats in variants.items():
        spec = ModelSpec(name, "", "gbm", feats)
        for tr, te in folds:
            predict, _ = _fit_core(spec, _clean(dev.iloc[tr]), None)
            out = dev.iloc[te][["milestoneId", "gameId", "units", "suspect"]].assign(model=name)
            out["estPoint"] = out["estLow"] = out["estHigh"] = np.exp(predict(dev.iloc[te]))
            preds.append(out)
    scored = score(pd.concat(preds, ignore_index=True), clean=True)
    ref = scored.loc[scored.modèle == "toutes les infos", "facteur_median"].iloc[0]
    scored["écart"] = scored.facteur_median - ref
    return scored


def error_by_age(b: "BenchResult") -> pd.DataFrame:
    """Erreur typique de chaque modèle selon l'âge du jeu au moment du chiffre."""
    scored = add_error_columns(b.cv_preds).merge(b.table[["milestoneId", "log_age_days"]], on="milestoneId")
    scored["âge du jeu"] = pd.cut(np.expm1(scored.log_age_days), [-1, 90, 365, 3 * 365, 1e9],
                                  labels=["moins de 3 mois", "3 à 12 mois", "1 à 3 ans", "plus de 3 ans"])
    med = scored.assign(a=scored.logErr.abs()).groupby(["âge du jeu", "model"], observed=True).a.median()
    return np.exp(med).unstack()[[s.name for s in b.specs]]


@dataclass
class BenchResult:
    table: pd.DataFrame
    specs: list[ModelSpec]
    cv_preds: pd.DataFrame
    cv_scores: pd.DataFrame
    choices: pd.DataFrame
    temporal_scores: pd.DataFrame
    temporal_n: tuple[int, int]
    coefs: dict[str, pd.DataFrame]
    ablation: pd.DataFrame
    snapshot: str
    trees: pd.DataFrame        # réglage final (choisi sur tous les jeux de dev) et taille de chaque modèle à arbres
    duel: dict                 # boosting contre forêt, sur les mêmes chiffres
    cv_scores_clean: pd.DataFrame = None       # mêmes prédictions, jugées sans les chiffres suspects
    temporal_scores_clean: pd.DataFrame = None


# Le test final sous clé a été lancé une fois (28/10/2026) et a donc servi :
# ses jeux rejoignent le développement (25 % de données en plus). Le prochain
# test neutre sera fait des chiffres publiés APRÈS ce snapshot.
LOCKED_GAMES_SPENT = True


def run_bench(snap, est: Estimator, res, bootstrap: int = 300) -> BenchResult:
    table, tag_cols = build_feature_table(snap, est, res)
    set_similarity(est)
    specs = model_specs(tag_cols)
    by_name = {s.name: s for s in specs}
    table = table.join(flag_suspects(table, [by_name["Forêt aléatoire"], by_name["Linéaire + interactions"]], SEED))
    dev = (table if LOCKED_GAMES_SPENT else table[~table.finalTest]).reset_index(drop=True)
    cv_preds, choices = cross_validate(specs, dev)
    temporal = temporal_check(specs, dev)
    clean_dev = _clean(dev)
    # Coefficients lisibles seulement pour les régressions sans interactions
    # (avec interactions, un coefficient seul ne veut plus rien dire).
    coefs = {s.name: coefficients(fit(s, clean_dev)) for s in specs
             if s.kind == "ridge" and not set(s.features) & set(INTERACTION_FEATURES)}
    trees = []
    for s in specs:
        if s.kind in ("gbm", "forest", "forest_knn"):
            f = fit(s, clean_dev)
            trees.append({"modèle": s.name, "réglage": describe_hp(GBM_DEFAULT if s.kind == "gbm" else FOREST_DEFAULT),
                          "nœuds": tree_nodes(f.model), "demi-largeur": math.exp(f.log_halfwidth)})
    scored = add_error_columns(cv_preds)
    gbm = scored[scored.model == "Gradient boosting"].set_index("milestoneId")
    forest = scored[scored.model == "Forêt aléatoire"].set_index("milestoneId")
    duel = {"proba_boosting_meilleur": paired_gain(forest, gbm, bootstrap)["proba_meilleur"]}
    current = temporal[temporal.model == "Modèle actuel"]
    return BenchResult(table, specs, cv_preds, score(cv_preds, bootstrap), choices, score(temporal),
                       (len(current), current.gameId.nunique()), coefs, ablation(dev), snap.path.name,
                       pd.DataFrame(trees), duel, score(cv_preds, bootstrap, clean=True),
                       score(temporal, clean=True))


def save_bench(b: BenchResult) -> None:
    REPORTS.mkdir(exist_ok=True)
    SAVED.write_bytes(pickle.dumps(b))


def load_saved_bench(snapshot_name: str) -> BenchResult | None:
    """Résultats enregistrés par `bench.py` pour ce snapshot, sinon None."""
    if not SAVED.exists():
        return None
    b = pickle.loads(SAVED.read_bytes())
    return b if getattr(b, "snapshot", None) == snapshot_name else None


# Choisi AVANT de regarder le test final (verdict du banc d'essai). Le test
# final confirme ou infirme sa performance ; il ne sert pas à re-choisir.
CHOSEN_MODEL = "Gradient boosting"
FINAL_SAVED = REPORTS / "bench_final.pkl"


def final_test(snap, est: Estimator, res) -> dict:
    """Entraîne chaque modèle sur tous les jeux de développement, puis le note
    sur les jeux sous clé, jamais vus jusqu'ici."""
    table, tag_cols = build_feature_table(snap, est, res)
    dev, test = table[~table.finalTest], table[table.finalTest]
    preds = pd.concat([predict_frame(fit(s, dev), test) for s in model_specs(tag_cols)], ignore_index=True)
    return {"snapshot": snap.path.name, "chosen": CHOSEN_MODEL, "scores": score(preds, bootstrap=1000),
            "preds": preds, "n": len(test), "games": test.gameId.nunique()}


def load_final(snapshot_name: str) -> dict | None:
    if not FINAL_SAVED.exists():
        return None
    final = pickle.loads(FINAL_SAVED.read_bytes())
    return final if final.get("snapshot") == snapshot_name else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true", help="évaluer sur le test final sous clé (une seule fois !)")
    args = parser.parse_args()

    snap = load_snapshot()
    est = Estimator(snap)
    res = compute_backtest(snap, est)
    REPORTS.mkdir(exist_ok=True)

    if args.final:
        print("⚠️  Test final : à ne regarder qu'une fois, quand les choix sont faits.")
        final = final_test(snap, est, res)
        shown = final["scores"].drop(columns=["gain_erreur"])
        shown["proba_meilleur"] = shown.proba_meilleur.map(lambda v: "" if pd.isna(v) else f"{v:.0%}")
        text = (f"# Test final (jeux sous clé) — snapshot {snap.path.name}\n\n"
                f"{final['n']} chiffres de {final['games']} jeux jamais vus. Modèle choisi avant le test : "
                f"**{final['chosen']}**.\n\n"
                + format_table(shown.drop(columns=[c for c in shown.columns
                                                   if c.endswith("_ic90") and c != "facteur_median_ic90"])))
        print(text)
        (REPORTS / "bench_final.md").write_text(text)
        FINAL_SAVED.write_bytes(pickle.dumps(final))
        return

    t0 = time.time()
    b = run_bench(snap, est, res)
    print(f"Banc d'essai en {time.time() - t0:.1f}s")

    cv = b.cv_scores.drop(columns=["gain_erreur"])
    cv["proba_meilleur"] = cv.proba_meilleur.map(lambda v: "" if pd.isna(v) else f"{v:.0%}")
    lines = [
        f"# Banc d'essai — snapshot {snap.path.name}\n",
        f"Lignes : {len(b.table)} chiffres monde réels ({b.table.gameId.nunique()} jeux), tous en développement "
        "(le test final sous clé a servi le 28/10/2026). "
        f"Chiffres suspects écartés de l'entraînement : {int(b.table.suspect.sum())} "
        f"({b.table.suspect.mean():.1%}), la base n'est pas modifiée.\n",
        "## Validation croisée par jeu (5 groupes, réglages imbriqués) — jugée sur TOUS les chiffres\n",
        format_table(cv.drop(columns=[c for c in cv.columns if c.endswith("_ic90") and c != "facteur_median_ic90"])),
        "",
        "## La même, jugée sur les chiffres nettoyés\n",
        format_table(b.cv_scores_clean[["modèle", "n", "facteur_median", "part_x1_5", "part_x2", "couverture",
                                        "biais"]]), "",
        "`proba_meilleur` : part des tirages (bootstrap par jeu) où le modèle a une erreur typique plus basse "
        "que l'actuel. Au-dessus de 95 %, le gain est solide ; autour de 50 %, c'est du hasard.\n",
        f"## Test dans le temps (appris avant 2025, testé sur 2025+ : {b.temporal_n[0]} chiffres, "
        f"{b.temporal_n[1]} jeux jamais vus)\n",
        format_table(b.temporal_scores), "",
        "Jugé sur les chiffres nettoyés :\n",
        format_table(b.temporal_scores_clean[["modèle", "n", "facteur_median", "part_x2", "couverture", "biais"]]), "",
        "## Réglages choisis à l'intérieur de chaque pli\n", b.choices.to_markdown(index=False), "",
    ]
    lines += ["## Modèles à arbres : réglages et taille\n",
              b.trees.to_markdown(index=False), "",
              f"Duel sur les mêmes chiffres : le boosting bat la forêt dans "
              f"{b.duel['proba_boosting_meilleur']:.0%} des tirages.\n"]
    suspects = b.table[b.table.suspect].sort_values(["suspectReason", "gameName"])
    lines += ["## Chiffres suspects écartés de l'entraînement (base non modifiée)\n",
              suspects[["gameName", "reportedAt", "units", "suspectReason"]]
              .assign(reportedAt=lambda d: d.reportedAt.dt.date).to_markdown(index=False), ""]
    ages = error_by_age(b).map(lambda v: f"×{v:.2f}")
    lines += ["## Erreur typique selon l'âge du jeu (validation croisée)\n", ages.to_markdown(), ""]
    abl = b.ablation[["modèle", "facteur_median", "part_x2", "écart"]].copy()
    abl["écart"] = abl["écart"].map(lambda v: f"{v:+.2f}")
    lines += [f"## Ablation ({ABLATION_MODEL}) : qu'apporte chaque famille d'informations ?\n",
              "On retire une famille et on remesure. Si l'erreur monte (écart positif), la famille était utile.\n",
              format_table(abl), ""]
    for name, c in b.coefs.items():
        top = c[~c.technique].head(12).assign(effet=lambda d: d.effet.map(lambda v: f"×{v:.2f}"))
        lines += [f"## Ce que « {name} » a appris (12 effets les plus forts)\n",
                  top[["description", "effet", "quand"]].to_markdown(index=False), ""]
    text = "\n".join(lines)
    print(text)
    (REPORTS / "bench.md").write_text(text)
    b.cv_preds.to_parquet(REPORTS / "bench_oof.parquet", index=False)
    save_bench(b)
    print(f"\n→ {REPORTS / 'bench.md'}\n→ {REPORTS / 'bench_oof.parquet'}\n→ {SAVED} (lu par l'UI)")


if __name__ == "__main__":
    # Exécuter depuis le module « bench » (et non « __main__ ») : sinon les
    # résultats enregistrés avec pickle ne sont pas relisibles par l'UI.
    import bench
    bench.main()

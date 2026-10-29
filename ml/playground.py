"""Modèles appris prêts à jouer dans l'UI : prédire un jeu à n'importe quelle date.

Deux façons de prédire un jeu :
  - honnête : avec un modèle entraîné SANS ce jeu (5 modèles, chacun privé
    d'un groupe de jeux ; on prend celui qui n'a jamais vu le jeu demandé) ;
  - « avec fuite » : avec le modèle entraîné sur tous les jeux, celui-ci
    compris. C'est le modèle qu'on mettrait en prod, mais il a déjà vu les
    chiffres publiés de ce jeu : il paraît forcément meilleur sur lui.

Les modèles apprennent sur tous les chiffres monde réels (le test final a
déjà servi), sans les chiffres suspects (voir labels.py). « Forêt + voisins »
a besoin de la similarité du site : appeler `bench.set_similarity(est)` avant.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from bench import N_FOLDS, SEED, BenchResult, _fit_core, fit

# Les deux premiers sont affichés par défaut dans l'UI (les meilleurs du banc).
LEARNED_MODELS = ["v1.1 : voisins + série + studio", "Moyenne forêt + linéaire", "Forêt + voisins", "Forêt aléatoire", "Linéaire + interactions",
                  "Gradient boosting"]


class Playable:
    def __init__(self, name: str, full, by_fold: list, fold_of_game: dict[str, int], log_halfwidth: float):
        self.name, self.full, self.by_fold = name, full, by_fold
        self.fold_of_game, self.log_halfwidth = fold_of_game, log_halfwidth

    def predict(self, game_id: str, X: pd.DataFrame, honest: bool) -> pd.DataFrame:
        """Estimation (milieu, bas, haut) pour chaque ligne de `X` (un même jeu, plusieurs dates)."""
        fold = self.fold_of_game.get(game_id)
        predict = self.by_fold[fold] if honest and fold is not None else self.full
        if "gameId" not in X.columns:  # « Forêt + voisins » cherche les voisins du jeu
            X = X.assign(gameId=game_id)
        point = np.exp(predict(X))
        k = math.exp(self.log_halfwidth)
        return pd.DataFrame({"point": point, "low": point / k, "high": point * k}, index=X.index)


def train(b: BenchResult, name: str) -> Playable:
    spec = next(s for s in b.specs if s.name == name)
    table = b.table[~b.table.suspect] if "suspect" in b.table.columns else b.table
    table = table.reset_index(drop=True)

    def train_one(df: pd.DataFrame):
        # Régressions : réglage choisi par validation croisée interne (comme au
        # banc). Arbres : réglages par défaut (le réglage n'apportait rien).
        return fit(spec, df).predict if spec.kind == "ridge" else _fit_core(spec, df, None)[0]

    by_fold, fold_of_game = [], {}
    folds = GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED).split(table, groups=table.gameId)
    for i, (tr, te) in enumerate(folds):
        by_fold.append(train_one(table.iloc[tr]))
        fold_of_game.update({g: i for g in table.gameId.iloc[te].unique()})
    # Largeur de fourchette : celle mesurée au banc d'essai sur des jeux non vus.
    widths = b.choices.loc[b.choices.modèle == name, "demi-largeur"]
    return Playable(name, train_one(table), by_fold, fold_of_game, math.log(float(widths.median())))

"""Modèles figés : relus depuis leurs fichiers JSON, sans scikit-learn.

Un modèle figé ne change plus jamais. C'est ce qui rend le test neutre
honnête : les modèles sont fixés AVANT que les nouveaux chiffres publiés
n'existent, on ne peut donc pas les avoir ajustés pour eux, même sans le
vouloir.

Le même fichier `ensemble.json` est lu par le backend (TypeScript) : ce module
en est la lecture de référence, et `freeze.py` vérifie qu'elle redonne
exactement les prédictions de scikit-learn.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

MODELS = Path(__file__).resolve().parent / "models"


def _tree_predict(tree: dict, X32: np.ndarray) -> np.ndarray:
    """Descend l'arbre pour toutes les lignes à la fois. Nœud i : enfant gauche = i + 1."""
    feature, right = np.asarray(tree["f"]), np.asarray(tree["r"])
    x = np.asarray(tree["x"], dtype=np.float32)  # seuils float32 exacts
    rows = np.arange(len(X32))
    node = np.zeros(len(X32), dtype=int)
    while True:
        f = feature[node]
        inner = f >= 0
        if not inner.any():
            return x[node].astype(float)
        # scikit-learn compare les features en float32 au seuil.
        go_left = X32[rows, np.where(inner, f, 0)] <= x[node]
        node = np.where(inner, np.where(go_left, node + 1, right[node]), node)


class FrozenEnsemble:
    """« Moyenne forêt + linéaire » : moyenne, en log, de la forêt et de la régression."""

    def __init__(self, spec: dict):
        self.spec, self.name = spec, spec["name"]
        self.halfwidth = float(spec["halfWidthFactor"])
        self.tags: list[str] = spec["tags"]

    @classmethod
    def load(cls, path: Path) -> "FrozenEnsemble":
        return cls(json.loads(path.read_text()))

    def predict_forest(self, df: pd.DataFrame) -> np.ndarray:
        forest = self.spec["forest"]
        X32 = df[forest["features"]].to_numpy(dtype=np.float32)
        return np.mean([_tree_predict(t, X32) for t in forest["trees"]], axis=0)

    def predict_ridge(self, df: pd.DataFrame) -> np.ndarray:
        r = self.spec["ridge"]
        X = df[r["features"]].to_numpy(dtype=float)
        z = (X - np.array(r["mean"])) / np.array(r["scale"])
        return z @ np.array(r["coef"]) + r["intercept"]

    def predict_log(self, df: pd.DataFrame) -> np.ndarray:
        return (self.predict_forest(df) + self.predict_ridge(df)) / 2

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        point = np.exp(self.predict_log(df))
        return pd.DataFrame({"point": point, "low": point / self.halfwidth, "high": point * self.halfwidth},
                            index=df.index)


class FrozenForestKnn:
    """« Forêt + voisins » : la même forêt, corrigée par ses erreurs sur les jeux similaires.

    `similarity(cible, autre)` est la similarité du site, calculée sur le
    snapshot courant (voir `bench.GameSimilarity`).
    """

    def __init__(self, ensemble: FrozenEnsemble, spec: dict):
        self.ensemble, self.name = ensemble, spec["name"]
        self.halfwidth = float(spec["halfWidthFactor"])
        self.alpha, self.k = float(spec["alpha"]), int(spec["neighbours"])
        self.residuals = pd.Series(spec["residuals"], dtype=float)

    @classmethod
    def load(cls, ensemble: FrozenEnsemble, path: Path) -> "FrozenForestKnn":
        return cls(ensemble, json.loads(path.read_text()))

    def correction(self, game_id: str, similarity) -> float:
        sims = sorted(((similarity(game_id, h), h) for h in self.residuals.index if h != game_id),
                      reverse=True)[:self.k]
        w = np.array([s for s, _ in sims]) ** 2
        return float((w * self.residuals[[h for _, h in sims]].to_numpy()).sum() / w.sum()) if w.sum() > 0 else 0.0

    def predict(self, df: pd.DataFrame, similarity) -> pd.DataFrame:
        corr = {g: self.correction(g, similarity) for g in df.gameId.unique()}
        log = self.ensemble.predict_forest(df) + self.alpha * df.gameId.map(corr).to_numpy()
        point = np.exp(log)
        return pd.DataFrame({"point": point, "low": point / self.halfwidth, "high": point * self.halfwidth},
                            index=df.index)


def latest_dir() -> Path:
    return sorted(p for p in MODELS.iterdir() if p.is_dir())[-1]


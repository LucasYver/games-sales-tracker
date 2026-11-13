"""Read a frozen V2 model (`models/<snapshot>/v2.json`) without scikit-learn.

This is the reference the backend port must reproduce: the same trees, walked the same
way, give the same number to the last bit. `freeze.py` writes the file and checks that
this reader returns what scikit-learn returned.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

MODELS = Path(__file__).resolve().parent / "models"
FILE = "v2.json"


def latest_frozen() -> Path:
    files = sorted(MODELS.glob(f"*/{FILE}"))
    if not files:
        raise FileNotFoundError("No frozen model: run `python freeze.py` first.")
    return files[-1]


def walk(tree: dict, x: np.ndarray) -> np.ndarray:
    """Value of the leaf each row of `x` falls in. A node asks `x[f] <= t`; a missing
    value goes left when `m` is 1. `f` is -1 on a leaf, whose value is in `t`."""
    f, t, left, right, m = (np.asarray(tree[k]) for k in ("f", "t", "l", "r", "m"))
    node = np.zeros(len(x), dtype=int)
    while True:
        inner = f[node] >= 0
        if not inner.any():
            return t[node]
        rows = np.flatnonzero(inner)
        at = node[rows]
        value = x[rows, f[at]]
        go_left = np.where(np.isnan(value), m[at] == 1, value <= t[at])
        node[rows] = np.where(go_left, left[at], right[at])


def boosted(part: dict, x: pd.DataFrame) -> np.ndarray:
    """Baseline plus the leaf of every tree, on the columns the part was trained on."""
    values = x[part["columns"]].to_numpy(float)
    out = np.full(len(values), part["baseline"])
    for tree in part["trees"]:
        out = out + walk(tree, values)
    return out


class Frozen:
    def __init__(self, path: Path | None = None):
        self.path = path or latest_frozen()
        self.doc = json.loads(self.path.read_text())

    def predict_matrix(self, x: pd.DataFrame, reviews: np.ndarray, target: np.ndarray, groups: list[np.ndarray]) -> pd.DataFrame:
        """`x`: the feature columns; `reviews`: Steam reviews at the date (as the model reads
        them); `target`: type of figure asked; `groups`: the game's signal groups, finest first."""
        d = self.doc
        mid = boosted(d["direct"], x)
        has = np.nan_to_num(np.asarray(reviews, float)) > 0
        if d["perReview"] is not None and has.any():
            mid[has] = boosted(d["perReview"], x[has]) + np.log(np.asarray(reviews, float)[has])
        width = np.array([d["widths"].get(t, d["widths"]["*"]) for t in target])
        scale = np.full(len(x), np.nan)
        for level in groups:
            found = np.array([d["widthScales"].get(str(name), np.nan) for name in level], dtype=float)
            scale = np.where(np.isnan(scale), found, scale)
        width = width * np.nan_to_num(scale, nan=1.0)
        return pd.DataFrame({"estimate": np.exp(mid), "low": np.exp(mid - width), "high": np.exp(mid + width)}, index=x.index)


class FrozenBest:
    """The frozen model behind the interface of a lab model: `fit` does nothing."""

    def __init__(self, path: Path | None = None):
        self.frozen = Frozen(path)
        self.label = f"{self.frozen.doc['version']} figé ({self.frozen.doc['snapshot']})"

    def fit(self, train: pd.DataFrame) -> None:
        pass

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        import features
        import learned
        lab = learned.VARIANTS[self.frozen.doc["model"]]()
        rows = lab._prep(rows)
        x = features.matrix(rows, tuple(self.frozen.doc["inputs"]["families"]))
        return self.frozen.predict_matrix(x, rows.steamReviews.to_numpy(float), rows.target.to_numpy(), learned.signal_groups(rows))

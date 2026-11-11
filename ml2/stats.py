"""Small statistics helpers shared by the bench and the models."""

from __future__ import annotations

import numpy as np


def weighted_quantile(values, weights, q: float) -> float:
    """Quantile `q` of `values` where each value counts for its weight."""
    values, weights = np.asarray(values, float), np.asarray(weights, float)
    if len(values) == 0:
        return float("nan")
    order = np.argsort(values)
    cum = np.cumsum(weights[order])
    return float(values[order][min(int(np.searchsorted(cum, q * cum[-1])), len(values) - 1)])


def game_weights(game_ids) -> np.ndarray:
    """Each game counts once: a figure weighs 1 / (figures of its game in the set)."""
    ids = np.asarray(game_ids)
    _, inverse, counts = np.unique(ids, return_inverse=True, return_counts=True)
    return 1.0 / counts[inverse]

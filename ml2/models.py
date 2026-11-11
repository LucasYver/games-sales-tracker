"""Models the bench can judge.

A model is a class with a `label`, `fit(train)` and `predict(rows)`:
  - `train`: kept figures of the training games, every type (totals, platforms, leaks);
  - `rows`: figures to estimate, with the signals known at their date and `target`;
  - `predict` returns `estimate`, `low`, `high` for every row, never NaN.

Step 2 only holds two naive references, there to run the bench in and to give a scale.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from stats import game_weights, weighted_quantile

# The signal each type of figure follows most directly.
DRIVER = {"TOTAL": "steamReviews", "PC": "steamReviews", "PLAYSTATION": "psRatings", "XBOX": "xboxRatings"}
LOW, HIGH = 0.10, 0.90  # 80 % interval


def _sales(train: pd.DataFrame, target: str) -> pd.DataFrame:
    return train[(train.target == target) & (train.measure == "ventes")]


class Constant:
    """Knows nothing about the game: the typical figure of its type. The floor."""

    label = "Sans information"

    def fit(self, train: pd.DataFrame) -> None:
        self.levels = {}
        everything = np.log(train[train.measure == "ventes"].units)
        for target in DRIVER:
            logs = np.log(_sales(train, target).units)
            logs, ids = (logs, _sales(train, target).gameId) if len(logs) >= 5 else (everything, train[train.measure == "ventes"].gameId)
            w = game_weights(ids)
            self.levels[target] = tuple(weighted_quantile(logs, w, q) for q in (0.5, LOW, HIGH))

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        levels = np.array([self.levels[t] for t in rows.target])
        return pd.DataFrame(np.exp(levels), index=rows.index, columns=["estimate", "low", "high"])


class ReviewsRatio:
    """Sales = signal × one coefficient per type of figure (the usual rule of thumb)."""

    label = "Reviews × coefficient"

    def fit(self, train: pd.DataFrame) -> None:
        self.fallback = Constant()
        self.fallback.fit(train)
        self.ratios = {}
        for target, driver in DRIVER.items():
            rows = _sales(train, target)
            rows = rows[rows[driver] > 0]
            if len(rows) < 5:
                continue
            logs = np.log(rows.units / rows[driver])
            w = game_weights(rows.gameId)
            self.ratios[target] = tuple(weighted_quantile(logs, w, q) for q in (0.5, LOW, HIGH))

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        out = self.fallback.predict(rows)
        for target, (mid, low, high) in self.ratios.items():
            signal = rows[DRIVER[target]]
            use = (rows.target == target) & (signal > 0)
            for col, level in (("estimate", mid), ("low", low), ("high", high)):
                out.loc[use, col] = signal[use] * np.exp(level)
        return out


class ReviewsRatioStamped(ReviewsRatio):
    """Same rule, but reading monthly history by its stamp: it sees up to a month of
    future. Never a candidate. It shows how much that leak flatters a score."""

    label = "Reviews × coefficient, avec la fuite mensuelle"

    @staticmethod
    def _leaky(rows: pd.DataFrame) -> pd.DataFrame:
        return rows.assign(steamReviews=rows.steamReviewsStamped)

    def fit(self, train: pd.DataFrame) -> None:
        super().fit(self._leaky(train))

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        return super().predict(self._leaky(rows))


from learned import VARIANTS  # noqa: E402  (learned models, step 4)

REGISTRY = {"constant": Constant, "reviews_ratio": ReviewsRatio, "reviews_ratio_stamped": ReviewsRatioStamped, **VARIANTS}

# Estimates made outside this bench (see `import_v1.py`), scored on the figures they cover.
EXTERNAL = {"v1_site": "Formule du site", "v1_5": "v1.5 (en prod)"}
LABELS = {**{key: model.label for key, model in REGISTRY.items()}, **EXTERNAL}

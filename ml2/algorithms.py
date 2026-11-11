"""Step 4: the learning algorithms a hypothesis can use.

Each one has `fit(x, y, sample_weight)` and `predict(x)`, takes missing values as they
are, and has settings fixed in advance: nothing is tuned on the bench.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

BOOSTING = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=15, l2_regularization=1.0,
                random_state=0)
FOREST = dict(n_estimators=300, min_samples_leaf=5, max_features=0.33, random_state=0, n_jobs=1)
RIDGE_STRENGTHS = (0.3, 1, 3, 10, 30, 100, 300)


class Linear:
    """Ridge regression. A missing value becomes the median plus a "was missing" column;
    the strength is picked inside the training rows."""

    def fit(self, x, y, sample_weight=None):
        self.model = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                                   RidgeCV(alphas=RIDGE_STRENGTHS))
        self.model.fit(x, y, ridgecv__sample_weight=sample_weight)
        return self

    def predict(self, x):
        return self.model.predict(x)


class Blend:
    """Plain average of several algorithms (in log, so a geometric mean of the estimates)."""

    def __init__(self, *parts):
        self.parts = parts

    def fit(self, x, y, sample_weight=None):
        self.models = [make(part).fit(x, y, sample_weight=sample_weight) for part in self.parts]
        return self

    def predict(self, x):
        return np.mean([m.predict(x) for m in self.models], axis=0)


ALGORITHMS = {
    "boosting": lambda: HistGradientBoostingRegressor(**BOOSTING),
    "forest": lambda: RandomForestRegressor(**FOREST),
    "linear": Linear,
    "boosting+linear": lambda: Blend("boosting", "linear"),
    "forest+linear": lambda: Blend("forest", "linear"),
    "boosting+forest+linear": lambda: Blend("boosting", "forest", "linear"),
}


def make(name: str):
    return ALGORITHMS[name]()

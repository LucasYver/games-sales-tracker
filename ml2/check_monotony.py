"""Does a model answer less when a game has more of a signal?

For every released game of the catalog, each signal is raised by 20 % on its own and
the model's total is recomputed. More peak players, more store ratings or more
followers can only mean more sales: an estimate that drops is an illogical answer.
Steam reviews are shown too, although the per-review model is free to lower its
sales per review as they rise.

    ../ml/.venv/bin/python check_monotony.py h8_pc_only h24_monotone
"""

from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

import bench
from dataset import latest_snapshot
from estimate_catalog import rows_today
from learned import BEST_KEY
from models import LABELS, REGISTRY

RAISE = 1.20
SIGNALS = {"steamPeakPlayers": "pic de joueurs", "psRatings": "notes PlayStation", "xboxRatings": "notes Xbox",
           "steamFollowers": "followers Steam", "steamReviews": "reviews Steam"}
CONSTRAINED = ("steamPeakPlayers", "psRatings", "xboxRatings", "steamFollowers")
TOLERANCE = 1e-9


def main() -> None:
    keys = sys.argv[1:] or [BEST_KEY]
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot, train_only=True)
    catalog = pd.read_parquet(snapshot / "catalog.parquet")
    now = pd.Timestamp(json.loads((snapshot / "manifest.json").read_text())["exportedAt"])
    first = pd.to_datetime(catalog.firstRelease, utc=True)
    c = catalog[(catalog.excluded == "") & first.notna() & (first <= now)].reset_index(drop=True)
    for key in keys:
        model = REGISTRY[key]()
        model.fit(bench.training_rows(REGISTRY[key], figures))
        base = model.predict(rows_today(c, now, "TOTAL")).estimate.to_numpy()
        print(f"\n{LABELS[key]} — {len(c)} games")
        any_drop = np.zeros(len(c), bool)
        for col, name in SIGNALS.items():
            has = (c[col] > 0).to_numpy()
            raised = model.predict(rows_today(c[has].assign(**{col: c[col][has] * RAISE}), now, "TOTAL")).estimate.to_numpy()
            change = raised / base[has]
            drop = change < 1 - TOLERANCE
            if col in CONSTRAINED:
                any_drop[has] |= drop
            print(f"  {name:<18} +20 %: estimate drops for {drop.mean():6.1%} of {has.sum():>5} games"
                  + (f"  (median drop {1 - np.median(change[drop]):.1%}, largest {1 - change.min():.1%})" if drop.any() else ""))
        print(f"  at least one of the four constrained signals: {any_drop.mean():.1%} of all games")


if __name__ == "__main__":
    main()

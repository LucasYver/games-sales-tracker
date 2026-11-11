"""Compare models on the figures they all cover.

    ../ml/.venv/bin/python compare.py h7_reviews_at_date h8_pc_only        # first one is the reference
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

import bench
from dataset import latest_snapshot
from models import LABELS


def main() -> None:
    keys = sys.argv[1:]
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    scored = {k: bench.with_errors(pd.read_parquet(bench.predictions_dir(snapshot) / f"{k}.parquet"), figures) for k in keys}
    for test in ("cv", "time"):
        for target in ("TOTAL", "PC", bench.PLAYERS):
            parts = {k: p[(p.test == test) & (p.target == target)] for k, p in scored.items()}
            if any(len(p) == 0 for p in parts.values()):
                continue
            common = set.intersection(*[set(p.figureId) for p in parts.values()])
            parts = {k: p[p.figureId.isin(common)] for k, p in parts.items()}
            draws = {k: bench.bootstrap_factor(p) for k, p in parts.items()}
            first = bench.score_repeats(parts[keys[0]])
            print(f"\n{test} {target}: {first['figures']} figures, {first['games']} games")
            for k, p in parts.items():
                s = bench.score_repeats(p)
                beats = "" if k == keys[0] else f"  beats the first in {(draws[k] < draws[keys[0]]).mean():.0%} of resamples"
                print(f"  {LABELS[k][:58]:<58} ×{s['factor']:.2f} [{np.quantile(draws[k], .05):.2f}–{np.quantile(draws[k], .95):.2f}]"
                      f"  ±20 %: {s['within20']:.0%}  ×2: {s['within2']:.0%}  bias ×{s['bias']:.2f}  range: {s['coverage']:.0%}{beats}")


if __name__ == "__main__":
    main()

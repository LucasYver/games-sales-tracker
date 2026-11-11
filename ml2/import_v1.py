"""Step 3: bring the v1 lab's estimates onto the V2 bench, as references to beat.

Reads `ml/reports/bench_oof.parquet`: for each worldwide figure v1 judged, the estimate
made by a model that never saw that game (v1's own cross-validation). Nothing is
retrained here. Two caveats, both in v1's favour:
  - v1 read monthly Steam history by its stamp, so it saw up to a month of future;
  - v1 only kept figures the site formula could estimate at their date.

    ../ml/.venv/bin/python import_v1.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

import bench
from dataset import latest_snapshot
from models import EXTERNAL

V1_OOF = Path(__file__).resolve().parent.parent / "ml" / "reports" / "bench_oof.parquet"
V1_MODELS = {"v1_site": "Modèle actuel", "v1_5": "v1.5 : voisins + série + studio"}


def main() -> None:
    snapshot = latest_snapshot()
    figures = bench.load_figures(snapshot)
    dev = bench.judged(figures[~figures.locked])
    oof = pd.read_parquet(V1_OOF)
    out = bench.predictions_dir(snapshot)
    out.mkdir(exist_ok=True)
    for key, v1_name in V1_MODELS.items():
        rows = oof[(oof.model == v1_name) & oof.milestoneId.isin(dev.figureId)]
        preds = pd.DataFrame({"estimate": rows.estPoint, "low": rows.estLow, "high": rows.estHigh,
                              "figureId": rows.milestoneId, "test": "cv", "repeat": 0})
        preds.to_parquet(out / f"{key}.parquet", index=False)
        print(f"{EXTERNAL[key]}: {len(preds)} figures of {dev[dev.figureId.isin(preds.figureId)].gameId.nunique()} games")


if __name__ == "__main__":
    main()

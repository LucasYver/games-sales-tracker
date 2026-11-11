"""Step 1a: frozen copy of the production tables the lab needs.

Writes `data/<stamp>/raw/*.parquet` and a manifest. Read-only (see `db.py`).
Every later step works on this copy, so a result can be reproduced and
production is queried once per snapshot.

    ../ml/.venv/bin/python export.py
"""

from __future__ import annotations

import io
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from db import connect_read_only

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

QUERIES: dict[str, str] = {
    "games": """
        SELECT id::text AS id, name, slug, "releaseDate", "isFree",
               platforms::text[] AS platforms, "catalogTier"::text AS "catalogTier",
               "developerId"::text AS "developerId", "publisherId"::text AS "publisherId",
               developer, publisher, "seriesSlug", "franchiseSlug",
               "isAnnualIteration", "iterationNumber", "liveService",
               "gameType", "gameModes"::text[] AS "gameModes",
               ("timeToBeat"->>'normally')::float AS "timeToBeatSeconds",
               "igdbParentGameId", genres, categories, "steamTags",
               COALESCE(array_length(dlc, 1), 0) AS "dlcCount",
               ("igdbEpicUrl" IS NOT NULL) AS "onEpic", ("igdbGogUrl" IS NOT NULL) AS "onGog",
               COALESCE("igdbGamePassCloud", false) AS "gamePass", "estimateHidden",
               ("deletedAt" IS NOT NULL) AS deleted
          FROM game
    """,
    "release_dates": """
        SELECT "gameId"::text AS "gameId", platform::text AS platform, "releaseDate"
          FROM game_platform_release_date
    """,
    # Every figure, rejected ones included: the data page shows what is dropped and why.
    "figures": """
        SELECT id::text AS id, "gameId"::text AS "gameId", platform::text AS platform,
               source::text AS source, units, "isEstimate", "isEngagement", "confidenceScore",
               "reportedAt", "capturedAt", publisher, "sourceUrl", note,
               ("rejectedAt" IS NOT NULL) AS rejected
          FROM milestone
    """,
    # Current full Steam price (US, cents). Collected since 2026 only: a trait of the
    # game, not a value known at each past date.
    "prices": """
        SELECT DISTINCT ON ("gameId") "gameId"::text AS "gameId", initial AS "priceCents"
          FROM price_snapshot
         WHERE country = 'us' AND source = 'STEAM' AND initial > 0
         ORDER BY "gameId", "capturedAt" DESC
    """,
}

# Synthetic rows are PlayStation ratings rebuilt by the site's own model: never a signal.
SIGNALS_COPY = """
    COPY (
        SELECT "gameId"::text AS "gameId", metric::text AS metric, value,
               "averageRating" AS rating, "capturedAt"
          FROM signal_snapshot
         WHERE NOT synthetic
    ) TO STDOUT WITH (FORMAT csv, HEADER true)
"""


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return None


def main() -> None:
    now = datetime.now(timezone.utc)
    out = DATA_DIR / now.strftime("%Y-%m-%dT%H%M") / "raw"
    out.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    with connect_read_only() as conn:
        for name, sql in QUERIES.items():
            t0 = time.time()
            with conn.cursor() as cur:
                cur.execute(sql)
                df = pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])
            df.to_parquet(out / f"{name}.parquet", index=False)
            counts[name] = len(df)
            print(f"  {name:<14} {len(df):>10,} rows  ({time.time() - t0:.1f}s)")

        t0 = time.time()
        buf = io.BytesIO()
        with conn.cursor() as cur, cur.copy(SIGNALS_COPY) as copy:
            for chunk in copy:
                buf.write(chunk)
        buf.seek(0)
        signals = pd.read_csv(buf, dtype={"gameId": "string", "metric": "category"})
        signals["capturedAt"] = pd.to_datetime(signals["capturedAt"], utc=True, format="ISO8601")
        signals.to_parquet(out / "signals.parquet", index=False)
        counts["signals"] = len(signals)
        print(f"  {'signals':<14} {len(signals):>10,} rows  ({time.time() - t0:.1f}s)")
        conn.rollback()

    manifest = {"exportedAt": now.isoformat(), "gitCommit": _git_commit(), "rowCounts": counts}
    (out.parent / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Snapshot written to {out.parent}")


if __name__ == "__main__":
    main()

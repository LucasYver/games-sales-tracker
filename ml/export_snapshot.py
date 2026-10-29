"""Copie figée (snapshot) de la base de prod vers `data/<date>/*.parquet`.

Principe ML : on travaille toujours sur une version figée et datée des
données. Les expériences deviennent reproductibles (relancer donne le même
chiffre) et on ne sollicite plus la prod pendant qu'on itère.

Lecture seule : voir `db.py`. Aucune écriture côté base.

Usage (depuis ml/) :
    .venv/bin/python export_snapshot.py            # → data/<AAAA-MM-JJ>/
    .venv/bin/python export_snapshot.py --out data/mon-snapshot
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from db import connect_read_only

ML_DIR = Path(__file__).resolve().parent

# Métriques nécessaires au modèle actuel (+ quelques-unes utiles pour
# explorer / préparer des features ML). Les followers et Twitch ne commencent
# qu'en 2024/2026 : trop récents pour un backtest historique.
SIGNAL_METRICS = (
    "STEAM_REVIEWS",
    "STEAM_CONCURRENT",
    "STEAM_PEAK_CCU",
    "PS_RATINGS",
    "XBOX_RATINGS",
    "STEAM_PLAYERS_LEAK",
    "STEAM_REVIEWER_MEDIAN_PLAYTIME",
)

QUERIES: dict[str, str] = {
    "games": """
        SELECT id::text AS id, name, slug, "releaseDate", "isFree",
               platforms::text[] AS platforms,
               developer, publisher, "publisherId"::text AS "publisherId",
               genres, categories, "steamTags",
               CASE WHEN dlc IS NULL THEN NULL
                    ELSE COALESCE(array_length(dlc, 1), 0) END AS "dlcCount",
               "franchiseSlug", "isAnnualIteration", "liveService",
               "excludedFromReference", "catalogTier"::text AS "catalogTier",
               "deletedAt"
          FROM game
    """,
    "platform_release_dates": """
        SELECT "gameId"::text AS "gameId", platform::text AS platform, "releaseDate"
          FROM game_platform_release_date
    """,
    "milestones": """
        SELECT id::text AS id, "gameId"::text AS "gameId", platform::text AS platform,
               source::text AS source,
               units, "isEstimate", "isEngagement", "confidenceScore",
               "reportedAt", "capturedAt", publisher, "sourceUrl", note,
               ("rejectedAt" IS NOT NULL) AS rejected
          FROM milestone
    """,
    "reference_profiles": """
        SELECT "gameId"::text AS "gameId", "qualityScore", "scaleUnits",
               "curveS1", "curveM1", "curveM3", "curveM6", "curveA1", "curveA2",
               "reviewsToUnits", "globalReviewsToUnits", "peakCcuRatio",
               "platformSharePc", "platformSharePs", "platformShareXbox",
               "platformShareSwitch", "observedAt"
          FROM reference_profile
    """,
    "game_rank": """
        SELECT "gameId"::text AS "gameId", "peakPercentile", "weeksTopDecile", "weeksCharted",
               "peakRank", "avgRank", "avgPercentile", "computedAt"
          FROM game_rank
    """,
    "estimation_methods": """
        SELECT code, family::text AS family, "defaultWeight"::float AS "defaultWeight",
               "isEnabled", "isAggregate"
          FROM estimation_method
    """,
    # Copie exacte de MatcherService.buildTrackRecordIndex.
    "track_record": """
        SELECT g.developer AS developer, g.id::text AS "gameId",
               g."releaseDate" AS "releaseDate", MAX(m.units) AS "maxUnits"
          FROM game g
          JOIN milestone m
            ON m."gameId" = g.id
           AND m."rejectedAt" IS NULL
           AND m."isEngagement" = false
         WHERE g.developer IS NOT NULL
           AND g."deletedAt" IS NULL
         GROUP BY g.developer, g.id, g."releaseDate"
    """,
    # Dernier lot complet d'estimations (toutes méthodes + `aggregated`)
    # calculé par la prod pour chaque jeu : sert à vérifier que le portage
    # Python reproduit bien le TypeScript (test de parité).
    "prod_latest_estimates": """
        WITH last AS (
            SELECT "gameId", MAX("computedAt") AS t FROM sales_estimate GROUP BY "gameId"
        )
        SELECT se."gameId"::text AS "gameId", se.platform::text AS platform, se.method,
               se."estimatedLow", se."estimatedHigh", se."computedAt"
          FROM sales_estimate se
          JOIN last ON last."gameId" = se."gameId" AND last.t = se."computedAt"
    """,
}

SIGNALS_COPY = f"""
    COPY (
        SELECT "gameId"::text AS "gameId", metric::text AS metric, value, "capturedAt", synthetic
          FROM signal_snapshot
         WHERE metric IN ({", ".join(f"'{m}'" for m in SIGNAL_METRICS)})
    ) TO STDOUT WITH (FORMAT csv, HEADER true)
"""


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ML_DIR, text=True
        ).strip()
    except Exception:
        return None


def export_followers(conn, out_dir: Path) -> int:
    """Followers Steam (games-popularity.com, depuis 2024) → followers.parquet.

    Seulement les relevés antérieurs à la fin du jour du snapshot, pour qu'un
    ajout à un snapshot existant reste comparable avec le reste des tables.
    """
    end = (pd.Timestamp(out_dir.name) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    buf = io.BytesIO()
    with conn.cursor() as cur:
        with cur.copy(f"""
            COPY (
                SELECT "gameId"::text AS "gameId", value, "capturedAt"
                  FROM signal_snapshot
                 WHERE metric = 'STEAM_FOLLOWERS' AND NOT synthetic AND "capturedAt" < '{end}'
            ) TO STDOUT WITH (FORMAT csv, HEADER true)
        """) as copy:
            for chunk in copy:
                buf.write(chunk)
    buf.seek(0)
    df = pd.read_csv(buf, dtype={"gameId": "string"})
    df["capturedAt"] = pd.to_datetime(df["capturedAt"], utc=True, format="ISO8601")
    df.to_parquet(out_dir / "followers.parquet", index=False)
    return len(df)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--followers-into", type=Path, default=None,
                        help="ajouter seulement les followers Steam à un snapshot existant")
    args = parser.parse_args()

    if args.followers_into:
        with connect_read_only() as conn:
            n = export_followers(conn, args.followers_into)
            conn.rollback()
        print(f"  followers                {n:>9,} lignes → {args.followers_into / 'followers.parquet'}")
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = args.out or (ML_DIR / "data" / today)
    out_dir.mkdir(parents=True, exist_ok=True)

    counts: dict[str, int] = {}
    with connect_read_only() as conn:
        for name, sql in QUERIES.items():
            t0 = time.time()
            with conn.cursor() as cur:
                cur.execute(sql)
                cols = [d.name for d in cur.description]
                df = pd.DataFrame(cur.fetchall(), columns=cols)
            df.to_parquet(out_dir / f"{name}.parquet", index=False)
            counts[name] = len(df)
            print(f"  {name:<24} {len(df):>9,} lignes  ({time.time() - t0:.1f}s)")

        t0 = time.time()
        buf = io.BytesIO()
        with conn.cursor() as cur:
            with cur.copy(SIGNALS_COPY) as copy:
                for chunk in copy:
                    buf.write(chunk)
        buf.seek(0)
        signals = pd.read_csv(buf, dtype={"gameId": "string", "metric": "category"})
        signals["capturedAt"] = pd.to_datetime(signals["capturedAt"], utc=True, format="ISO8601")
        signals["synthetic"] = signals["synthetic"].map({"t": True, "f": False}).astype(bool)
        signals.to_parquet(out_dir / "signals.parquet", index=False)
        counts["signals"] = len(signals)
        print(f"  {'signals':<24} {len(signals):>9,} lignes  ({time.time() - t0:.1f}s)")

        counts["followers"] = export_followers(conn, out_dir)

        # Rien n'a été écrit, mais on termine explicitement la transaction.
        conn.rollback()

    manifest = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "gitCommit": _git_commit(),
        "signalMetrics": list(SIGNAL_METRICS),
        "rowCounts": counts,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Snapshot écrit dans {out_dir}")


if __name__ == "__main__":
    main()

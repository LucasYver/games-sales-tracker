#!/usr/bin/env bash
# Reset the discovery catalog so you can start fresh.
# Preserves: trusted_source (media registry).
# Removes:   game, game_source, signal_snapshot, sales_estimate,
#             sales_record, processed_article.
#
# Usage:
#   ./scripts/reset-discovery.sh
#
# Optional — override connection with env:
#   PGHOST=localhost PGPORT=5433 PGUSER=gamesales PGPASSWORD=gamesales PGDB=gamesales \
#     ./scripts/reset-discovery.sh

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-gamesales}"
PGPASSWORD="${PGPASSWORD:-gamesales}"
PGDB="${PGDB:-gamesales}"

echo "Connecting to postgres://$PGUSER@$PGHOST:$PGPORT/$PGDB ..."

COUNTS=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -t -c "
  SELECT
    (SELECT count(*) FROM game)              AS games,
    (SELECT count(*) FROM game_source)       AS sources,
    (SELECT count(*) FROM signal_snapshot)   AS signals,
    (SELECT count(*) FROM sales_estimate)    AS estimates,
    (SELECT count(*) FROM sales_record)      AS records,
    (SELECT count(*) FROM processed_article) AS articles,
    (SELECT count(*) FROM trusted_source)    AS trusted;
")
echo "Before: $COUNTS"

read -p "Delete all discovery data? (games/signals/estimates/records/articles) [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "
  TRUNCATE TABLE
    game,
    game_source,
    signal_snapshot,
    sales_estimate,
    sales_record,
    processed_article
  RESTART IDENTITY CASCADE;
"

COUNTS_AFTER=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -t -c "
  SELECT
    (SELECT count(*) FROM game)           AS games,
    (SELECT count(*) FROM trusted_source) AS trusted;
")
echo "After:  $COUNTS_AFTER"
echo "Done. trusted_source untouched."

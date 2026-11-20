/**
 * Records one Steam concurrent-player reading in a single statement (one
 * round trip instead of up to nine through TypeORM `findOne` + `save`).
 *
 *  - `STEAM_CONCURRENT`: one row per UTC day holding that day's highest
 *    reading. With no row in [$3, $4] a row is inserted at $3 (the UTC day
 *    start); a higher reading raises the day's highest row and resets its
 *    `capturedAt` to $3; a lower or equal one changes nothing.
 *  - `STEAM_PEAK_CCU`: a new row (dated by the column default, `now()`) only
 *    when the reading is strictly above the highest existing peak, or when
 *    the game has none.
 *
 * Parameters: $1 gameId, $2 reading, $3 UTC day start, $4 UTC day end
 * (inclusive, last millisecond). The parameters take their types from the
 * columns they are compared with, exactly as the TypeORM version did.
 *
 * All parts see the same snapshot, so the peak check never sees the daily
 * row written by the same statement (it did not in the TypeORM version
 * either: it only reads `STEAM_PEAK_CCU` rows).
 */
export const RECORD_STEAM_CCU_SQL = `
WITH today AS (
  SELECT id, value
    FROM signal_snapshot
   WHERE "gameId" = $1
     AND metric = 'STEAM_CONCURRENT'
     AND "capturedAt" BETWEEN $3 AND $4
   ORDER BY value DESC
   LIMIT 1
),
raised AS (
  UPDATE signal_snapshot s
     SET value = $2, "capturedAt" = $3
    FROM today
   WHERE s.id = today.id
     AND $2 > today.value
  RETURNING s.id
),
opened AS (
  INSERT INTO signal_snapshot ("gameId", source, metric, value, "capturedAt")
  SELECT $1, 'STEAM'::signal_snapshot_source_enum,
         'STEAM_CONCURRENT'::signal_snapshot_metric_enum, $2, $3
   WHERE NOT EXISTS (SELECT 1 FROM today)
  RETURNING id
),
prior AS (
  SELECT MAX(value) AS value
    FROM signal_snapshot
   WHERE "gameId" = $1
     AND metric = 'STEAM_PEAK_CCU'
),
peak AS (
  INSERT INTO signal_snapshot ("gameId", source, metric, value)
  SELECT $1, 'STEAM'::signal_snapshot_source_enum,
         'STEAM_PEAK_CCU'::signal_snapshot_metric_enum, $2
    FROM prior
   WHERE prior.value IS NULL OR $2 > prior.value
  RETURNING id
)
SELECT (SELECT value FROM prior) AS "priorPeak",
       EXISTS (SELECT 1 FROM peak) AS "newPeak",
       (SELECT COUNT(*) FROM raised) + (SELECT COUNT(*) FROM opened)
         AS "dailyWrites"
`;

export interface RecordSteamCcuRow {
  priorPeak: number | null;
  newPeak: boolean;
  dailyWrites: string;
}

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * Backfill historical reviews + CCU for Steam-linked games.
 *
 * Per game it calls:
 *   - `backfillReviewsFromHistogram` (Steam `appreviewhistogram`, monthly,
 *     falls back to per-review enumeration for low-volume games);
 *   - `backfillCcuFromSteamCharts` (steamcharts.com monthly peak CCU).
 *
 * Three scopes:
 *   - `leak`     (default): games with a `STEAM_PLAYERS_LEAK` snapshot (2018 leak).
 *   - `non-leak`: every game with a `STEAM` GameSource that does NOT have a leak row
 *                 (i.e. tracked via the regular Steam refresh).
 *   - `all`     : every game with a `STEAM` GameSource.
 *
 * Optional `--tier CORE|EXTENDED|all` (default all). Paid + released-before-2026
 * only when a tier filter is set (the catalog backfill target).
 *
 * Resumable via a scope(+tier)-suffixed JSON checkpoint, throttled between
 * games (both endpoints are rate-limited / scraped). Neither source is SteamDB
 * (Cloudflare/ToS).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-leak-history.ts \
 *     [--scope leak|non-leak|all] [--tier CORE|EXTENDED|all] \
 *     [--limit <n>] [--delay <ms>] [--reviews-only] [--ccu-only] [--no-resume] \
 *     [--max-points <n>]
 *
 * `--max-points <n>` (default 5): per metric, skip when the game already has
 * more than n *pre-2026* points. Cron points from 2026 alone must not count —
 * otherwise nearly every tracked title is skipped. Games are processed
 * fewest-pre-2026-points-first so an interrupted run covers the neediest first.
 */

type Scope = 'leak' | 'non-leak' | 'all';
type Tier = 'CORE' | 'EXTENDED' | 'all';

interface CliOptions {
  scope: Scope;
  tier: Tier;
  limit: number | null;
  delayMs: number;
  doReviews: boolean;
  doCcu: boolean;
  resume: boolean;
  maxPoints: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reviewsOnly = args.includes('--reviews-only');
  const ccuOnly = args.includes('--ccu-only');

  const rawScope = (get('--scope') ?? 'leak') as Scope;
  if (!['leak', 'non-leak', 'all'].includes(rawScope)) {
    throw new Error(
      `Invalid --scope "${rawScope}". Expected one of: leak, non-leak, all.`,
    );
  }

  const rawTier = (get('--tier') ?? 'all').toUpperCase();
  if (!['CORE', 'EXTENDED', 'ALL'].includes(rawTier)) {
    throw new Error(
      `Invalid --tier "${get('--tier')}". Expected one of: CORE, EXTENDED, all.`,
    );
  }
  const tier: Tier = rawTier === 'ALL' ? 'all' : (rawTier as Tier);

  return {
    scope: rawScope,
    tier,
    limit: get('--limit') ? Number(get('--limit')) : null,
    delayMs: get('--delay') ? Number(get('--delay')) : 1500,
    doReviews: !ccuOnly,
    doCcu: !reviewsOnly,
    resume: !args.includes('--no-resume'),
    maxPoints: get('--max-points')
      ? Number(get('--max-points'))
      : DEFAULT_MAX_POINTS,
  };
}

// Histogram + SteamCharts DELETE existing rows in the covered window before
// reinserting one point per month. Skip a metric once its *pre-2026* row
// count exceeds `--max-points` (default below): that means a prior launch
// backfill already landed. Daily/hourly cron points from 2026 are ignored
// for this gate — they are not launch history.
const DEFAULT_MAX_POINTS = 5;

const SCOPE_FILTERS: Record<Scope, string> = {
  leak: `EXISTS (
           SELECT 1 FROM signal_snapshot s
           WHERE s."gameId" = gs."gameId" AND s.metric = 'STEAM_PLAYERS_LEAK'
         )`,
  'non-leak': `NOT EXISTS (
                 SELECT 1 FROM signal_snapshot s
                 WHERE s."gameId" = gs."gameId" AND s.metric = 'STEAM_PLAYERS_LEAK'
               )`,
  all: 'TRUE',
};

function buildScopeQuery(scope: Scope, tier: Tier): string {
  const tierFilter =
    tier === 'all'
      ? ''
      : `AND g."catalogTier" = '${tier}'
            AND g."isFree" = false
            AND g."releaseDate" IS NOT NULL
            AND g."releaseDate" < DATE '2026-01-01'`;

  // Only count pre-2026 snapshots for the skip gate / ordering. Cron-era
  // points must not make a title look "already backfilled".
  return `SELECT
            gs."gameId" AS "gameId",
            g.name AS name,
            COALESCE(SUM(CASE
              WHEN s.metric = 'STEAM_REVIEWS'
               AND s."capturedAt" < DATE '2026-01-01' THEN 1
              ELSE 0 END), 0)::int AS "reviewsCount",
            COALESCE(SUM(CASE
              WHEN s.metric = 'STEAM_CONCURRENT'
               AND s."capturedAt" < DATE '2026-01-01' THEN 1
              ELSE 0 END), 0)::int AS "ccuCount"
          FROM game_source gs
          JOIN game g ON g.id = gs."gameId"
          LEFT JOIN signal_snapshot s ON s."gameId" = gs."gameId"
            AND s.metric IN ('STEAM_REVIEWS', 'STEAM_CONCURRENT')
          WHERE gs.source = 'STEAM'
            AND g."deletedAt" IS NULL
            AND ${SCOPE_FILTERS[scope]}
            ${tierFilter}
          GROUP BY gs."gameId", g.name
          ORDER BY
            (COALESCE(SUM(CASE
              WHEN s.metric = 'STEAM_REVIEWS'
               AND s."capturedAt" < DATE '2026-01-01' THEN 1
              ELSE 0 END), 0)
             + COALESCE(SUM(CASE
              WHEN s.metric = 'STEAM_CONCURRENT'
               AND s."capturedAt" < DATE '2026-01-01' THEN 1
              ELSE 0 END), 0)) ASC,
            g.name ASC`;
}

function loadCheckpoint(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(path, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveCheckpoint(path: string, done: Set<string>): void {
  writeFileSync(path, JSON.stringify([...done]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('BackfillLeakHistory');

  const checkpointSuffix =
    opts.tier === 'all' ? opts.scope : `${opts.scope}.${opts.tier}`;
  const checkpointPath = resolve(
    __dirname,
    `../../../scripts/.backfill-leak-history-progress.${checkpointSuffix}.json`,
  );
  const done = opts.resume ? loadCheckpoint(checkpointPath) : new Set<string>();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);
  const dataSource = app.get(DataSource);

  const games = await dataSource.query<
    Array<{
      gameId: string;
      name: string;
      reviewsCount: number;
      ccuCount: number;
    }>
  >(buildScopeQuery(opts.scope, opts.tier));

  const pending = games.filter((g) => !done.has(g.gameId)).length;
  const etaMin = Math.ceil(
    (Math.min(pending, opts.limit ?? pending) * (opts.delayMs + 2500)) / 60000,
  );

  logger.log(
    `Scope=${opts.scope} tier=${opts.tier}: found ${games.length} game(s) ` +
      `(${pending} pending, ~${etaMin} min ETA @ delay=${opts.delayMs}ms+~2.5s work) ` +
      `(reviews=${opts.doReviews}, ccu=${opts.doCcu}` +
      `${opts.limit ? `, limit=${opts.limit}` : ''}, ` +
      `skip metric when pre-2026 points > ${opts.maxPoints}). ` +
      `${done.size} already done.`,
  );

  const counts = {
    reviewsOk: 0,
    reviewsErr: 0,
    reviewsSkipped: 0,
    ccuOk: 0,
    ccuErr: 0,
    ccuSkipped: 0,
  };
  let processed = 0;

  try {
    for (const { gameId, name, reviewsCount, ccuCount } of games) {
      if (opts.limit !== null && processed >= opts.limit) break;
      if (done.has(gameId)) continue;

      const reviewsNeeded =
        opts.doReviews && reviewsCount <= opts.maxPoints;
      const ccuNeeded = opts.doCcu && ccuCount <= opts.maxPoints;
      if (!reviewsNeeded && !ccuNeeded) {
        // Already has enough pre-2026 history on every requested metric.
        if (opts.doReviews) counts.reviewsSkipped++;
        if (opts.doCcu) counts.ccuSkipped++;
        done.add(gameId);
        continue;
      }

      let reviewsLabel = 'skip';
      let ccuLabel = 'skip';

      if (opts.doReviews) {
        if (!reviewsNeeded) {
          reviewsLabel = `skip(${reviewsCount})`;
          counts.reviewsSkipped++;
        } else {
          try {
            const r = await ingestion.backfillReviewsFromHistogram(gameId);
            reviewsLabel = `${r.method}:${r.pointsImported}`;
            counts.reviewsOk++;
          } catch (error) {
            reviewsLabel = 'ERR';
            counts.reviewsErr++;
            logger.warn(`reviews "${name}" (${gameId}): ${String(error)}`);
          }
        }
      }

      if (opts.doCcu) {
        if (!ccuNeeded) {
          ccuLabel = `skip(${ccuCount})`;
          counts.ccuSkipped++;
        } else {
          try {
            const c = await ingestion.backfillCcuFromSteamCharts(gameId);
            ccuLabel = `${c.monthsImported}m`;
            counts.ccuOk++;
          } catch (error) {
            ccuLabel = 'ERR';
            counts.ccuErr++;
            logger.warn(`ccu "${name}" (${gameId}): ${String(error)}`);
          }
        }
      }

      done.add(gameId);
      processed++;
      logger.log(
        `[${processed}] "${name}" — reviews=${reviewsLabel} ccu=${ccuLabel}`,
      );

      if (processed % 25 === 0) saveCheckpoint(checkpointPath, done);
      await sleep(opts.delayMs);
    }
  } finally {
    saveCheckpoint(checkpointPath, done);
    await app.close();
  }

  logger.log(
    `Done. processed=${processed} | ` +
      `reviews ok=${counts.reviewsOk} err=${counts.reviewsErr} ` +
      `skipped=${counts.reviewsSkipped} | ` +
      `ccu ok=${counts.ccuOk} err=${counts.ccuErr} skipped=${counts.ccuSkipped}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

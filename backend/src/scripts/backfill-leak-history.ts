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
 * Resumable via a scope-suffixed JSON checkpoint, throttled between games (both
 * endpoints are rate-limited / scraped). Neither source is SteamDB (Cloudflare/ToS).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-leak-history.ts \
 *     [--scope leak|non-leak|all] \
 *     [--limit <n>] [--delay <ms>] [--reviews-only] [--ccu-only] [--no-resume] \
 *     [--max-points <n>]
 *
 * `--max-points <n>` (default 20): per metric, skip games that already have
 * more than n points — i.e. only backfill titles still lacking launch history.
 * Games are processed fewest-points-first so an interrupted run covers the
 * neediest ones first.
 */

type Scope = 'leak' | 'non-leak' | 'all';

interface CliOptions {
  scope: Scope;
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

  return {
    scope: rawScope,
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

// The histogram + SteamCharts backfills DELETE existing rows in the covered
// window before reinserting one point per month. A metric is skipped once its
// existing row count exceeds `--max-points` (default below): games with real
// history — long-tracked daily-cron titles or an earlier backfill — are left
// untouched, so we only spend scrape budget on the ones that still lack it.
// Two weeks of cron already yields a handful of points, so the default is set
// well above that (a game with ≤20 points has essentially no launch history).
const DEFAULT_MAX_POINTS = 20;

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

function buildScopeQuery(scope: Scope): string {
  return `SELECT
            gs."gameId" AS "gameId",
            g.name AS name,
            COALESCE(SUM(CASE WHEN s.metric = 'STEAM_REVIEWS' THEN 1 ELSE 0 END), 0)::int AS "reviewsCount",
            COALESCE(SUM(CASE WHEN s.metric = 'STEAM_CONCURRENT' THEN 1 ELSE 0 END), 0)::int AS "ccuCount"
          FROM game_source gs
          JOIN game g ON g.id = gs."gameId"
          LEFT JOIN signal_snapshot s ON s."gameId" = gs."gameId"
          WHERE gs.source = 'STEAM'
            AND g."deletedAt" IS NULL
            AND ${SCOPE_FILTERS[scope]}
          GROUP BY gs."gameId", g.name
          ORDER BY
            (COALESCE(SUM(CASE WHEN s.metric = 'STEAM_REVIEWS' THEN 1 ELSE 0 END), 0)
             + COALESCE(SUM(CASE WHEN s.metric = 'STEAM_CONCURRENT' THEN 1 ELSE 0 END), 0)) ASC,
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

  const checkpointPath = resolve(
    __dirname,
    `../../../scripts/.backfill-leak-history-progress.${opts.scope}.json`,
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
  >(buildScopeQuery(opts.scope));

  logger.log(
    `Scope=${opts.scope}: found ${games.length} game(s) ` +
      `(reviews=${opts.doReviews}, ccu=${opts.doCcu}, delay=${opts.delayMs}ms` +
      `${opts.limit ? `, limit=${opts.limit}` : ''}, ` +
      `skip metric when existing points > ${opts.maxPoints}). ` +
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

      let reviewsLabel = 'skip';
      let ccuLabel = 'skip';

      if (opts.doReviews) {
        if (reviewsCount > opts.maxPoints) {
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
        if (ccuCount > opts.maxPoints) {
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

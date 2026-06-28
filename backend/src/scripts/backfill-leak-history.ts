import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * Backfill historical reviews + CCU for every game that carries a
 * `STEAM_PLAYERS_LEAK` snapshot (i.e. the games imported from the 2018 leak).
 *
 * Per game it calls:
 *   - `backfillReviewsFromHistogram` (Steam `appreviewhistogram`, monthly,
 *     falls back to per-review enumeration for low-volume games);
 *   - `backfillCcuFromSteamCharts` (steamcharts.com monthly peak CCU).
 *
 * Resumable via a JSON checkpoint, throttled between games (both endpoints
 * are rate-limited / scraped). Neither source is SteamDB (Cloudflare/ToS).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-leak-history.ts \
 *     [--limit <n>] [--delay <ms>] [--reviews-only] [--ccu-only] [--no-resume]
 */

interface CliOptions {
  limit: number | null;
  delayMs: number;
  doReviews: boolean;
  doCcu: boolean;
  resume: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reviewsOnly = args.includes('--reviews-only');
  const ccuOnly = args.includes('--ccu-only');

  return {
    limit: get('--limit') ? Number(get('--limit')) : null,
    delayMs: get('--delay') ? Number(get('--delay')) : 1500,
    doReviews: !ccuOnly,
    doCcu: !reviewsOnly,
    resume: !args.includes('--no-resume'),
  };
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
    '../../../scripts/.backfill-leak-history-progress.json',
  );
  const done = opts.resume ? loadCheckpoint(checkpointPath) : new Set<string>();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);
  const dataSource = app.get(DataSource);

  const leakGames = await dataSource.query<
    Array<{ gameId: string; name: string }>
  >(
    `SELECT DISTINCT s."gameId" AS "gameId", g.name AS name
     FROM signal_snapshot s
     JOIN game g ON g.id = s."gameId"
     WHERE s.metric = 'STEAM_PLAYERS_LEAK' AND g."deletedAt" IS NULL
     ORDER BY g.name ASC`,
  );

  logger.log(
    `Found ${leakGames.length} leak game(s) ` +
      `(reviews=${opts.doReviews}, ccu=${opts.doCcu}, delay=${opts.delayMs}ms` +
      `${opts.limit ? `, limit=${opts.limit}` : ''}). ` +
      `${done.size} already done.`,
  );

  const counts = { reviewsOk: 0, reviewsErr: 0, ccuOk: 0, ccuErr: 0 };
  let processed = 0;

  try {
    for (const { gameId, name } of leakGames) {
      if (opts.limit !== null && processed >= opts.limit) break;
      if (done.has(gameId)) continue;

      let reviewsLabel = 'skip';
      let ccuLabel = 'skip';

      if (opts.doReviews) {
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

      if (opts.doCcu) {
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
    `Done. processed=${processed} | reviews ok=${counts.reviewsOk} ` +
      `err=${counts.reviewsErr} | ccu ok=${counts.ccuOk} err=${counts.ccuErr}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

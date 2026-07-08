import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * One-off catalog-wide backfill: for every non-deleted game with a known
 * `igdbId`, re-fetches its IGDB record and writes per-platform release
 * dates (see `IngestionService.refreshPlatformReleaseDates`). Only needed
 * for games ingested before this feature existed — new ingests already
 * write these dates as part of the normal upsert.
 *
 * Resumable via a JSON checkpoint, throttled between games (IGDB's rate
 * budget is roughly 4 req/s).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-platform-release-dates.ts \
 *     [--limit <n>] [--delay <ms>] [--no-resume]
 */

interface CliOptions {
  limit: number | null;
  delayMs: number;
  resume: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limitRaw = get('--limit');
  const delayRaw = get('--delay');
  const limit = limitRaw != null ? Number(limitRaw) : null;
  const delayMs = delayRaw != null ? Number(delayRaw) : 300;
  return {
    limit: limit != null && Number.isFinite(limit) ? limit : null,
    delayMs: Number.isFinite(delayMs) ? delayMs : 300,
    resume: !args.includes('--no-resume'),
  };
}

const CHECKPOINT_PATH = resolve(
  __dirname,
  '../../../scripts/.backfill-platform-release-dates-progress.json',
);

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
  const logger = new Logger('BackfillPlatformReleaseDates');
  const done = opts.resume
    ? loadCheckpoint(CHECKPOINT_PATH)
    : new Set<string>();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const ingestion = app.get(IngestionService);

  const rows = await dataSource.query<Array<{ gameId: string; name: string }>>(
    `SELECT id AS "gameId", name
       FROM game
      WHERE "deletedAt" IS NULL AND "igdbId" IS NOT NULL
      ORDER BY name ASC`,
  );

  logger.log(
    `Found ${rows.length} IGDB-linked game(s) ` +
      `(delay=${opts.delayMs}ms${opts.limit ? `, limit=${opts.limit}` : ''}). ` +
      `${done.size} already done.`,
  );

  const counts = { ok: 0, skipped: 0, err: 0 };
  let processed = 0;

  try {
    for (const { gameId, name } of rows) {
      if (opts.limit !== null && processed >= opts.limit) break;
      if (done.has(gameId)) continue;

      let label: string;
      try {
        const result = await ingestion.refreshPlatformReleaseDates(gameId);
        if (result === 'ok') {
          counts.ok++;
          label = 'ok';
        } else {
          counts.skipped++;
          label = `skipped (${result})`;
        }
      } catch (error) {
        counts.err++;
        label = `ERR ${error}`;
      }

      processed++;
      done.add(gameId);
      saveCheckpoint(CHECKPOINT_PATH, done);
      logger.log(`[${processed}] ${name}: ${label}`);

      if (opts.delayMs > 0) await sleep(opts.delayMs);
    }

    logger.log(
      `Done. processed=${processed} ok=${counts.ok} ` +
        `skipped=${counts.skipped} err=${counts.err}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

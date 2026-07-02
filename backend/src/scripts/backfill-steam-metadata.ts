import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * Single catalog-wide Steam backfill: for every Steam-linked game it
 * re-fetches the store `appdetails` + community tags and upserts every
 * Steam-derived column on the `Game` row (name, genres, categories,
 * steamTags, dlc, developer, publisher, release date, cover, summary,
 * isFree) and the re-derived franchise / live-service features.
 *
 * This replaces the per-field backfills (tags, franchise/live-service):
 * they all read from the same Steam upsert, so one pass keeps them in sync.
 * Metadata only — reviews/CCU time series have their own flow
 * (`backfill:leak-history`).
 *
 * Resumable via a JSON checkpoint, throttled between games (the store
 * shares a ~200 req/5 min IP budget).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-steam-metadata.ts \
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
  const delayMs = delayRaw != null ? Number(delayRaw) : 500;
  return {
    limit: limit != null && Number.isFinite(limit) ? limit : null,
    delayMs: Number.isFinite(delayMs) ? delayMs : 500,
    resume: !args.includes('--no-resume'),
  };
}

const CHECKPOINT_PATH = resolve(
  __dirname,
  '../../../scripts/.backfill-steam-metadata-progress.json',
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
  const logger = new Logger('BackfillSteamMetadata');
  const done = opts.resume
    ? loadCheckpoint(CHECKPOINT_PATH)
    : new Set<string>();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const ingestion = app.get(IngestionService);

  const rows = await dataSource.query<
    Array<{ gameId: string; name: string; appId: string }>
  >(
    `SELECT g.id AS "gameId", g.name AS name, gs."externalId" AS "appId"
       FROM game g
       JOIN game_source gs
         ON gs."gameId" = g.id AND gs.source = 'STEAM'
      WHERE g."deletedAt" IS NULL
      ORDER BY g.name ASC`,
  );

  logger.log(
    `Found ${rows.length} Steam-linked game(s) ` +
      `(delay=${opts.delayMs}ms${opts.limit ? `, limit=${opts.limit}` : ''}). ` +
      `${done.size} already done.`,
  );

  const counts = { ok: 0, skipped: 0, err: 0 };
  let processed = 0;

  try {
    for (const { gameId, name, appId } of rows) {
      if (opts.limit !== null && processed >= opts.limit) break;
      if (done.has(gameId)) continue;

      const numericAppId = Number(appId);
      if (!Number.isFinite(numericAppId)) {
        counts.err++;
        done.add(gameId);
        continue;
      }

      let label: string;
      try {
        const updatedId = await ingestion.refreshSteamMetadata(numericAppId);
        if (updatedId) {
          counts.ok++;
          label = 'ok';
        } else {
          counts.skipped++;
          label = 'skipped (no details / deleted)';
        }
      } catch (error) {
        counts.err++;
        label = `ERR ${error}`;
      }

      processed++;
      done.add(gameId);
      saveCheckpoint(CHECKPOINT_PATH, done);
      logger.log(`[${processed}] ${name} (app=${numericAppId}): ${label}`);

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

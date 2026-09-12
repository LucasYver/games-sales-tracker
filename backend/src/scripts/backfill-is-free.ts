import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { SteamClient } from '../ingestion/steam.client';

/**
 * Catalog-wide Steam `is_free` backfill. Games entered via IGDB never got
 * `isFree` set, so this re-fetches store appdetails and updates only that
 * flag. Metadata (tags, cover, …) is left to `backfill-steam-metadata`.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-is-free.ts \
 *     [--dry-run] [--limit <n>] [--delay <ms>] [--no-resume]
 */

interface CliOptions {
  dryRun: boolean;
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
  const delayMs = delayRaw != null ? Number(delayRaw) : 1500;
  return {
    dryRun: args.includes('--dry-run'),
    limit: limit != null && Number.isFinite(limit) ? limit : null,
    delayMs: Number.isFinite(delayMs) ? delayMs : 1500,
    resume: !args.includes('--no-resume'),
  };
}

const CHECKPOINT_PATH = resolve(
  __dirname,
  '../../../scripts/.backfill-is-free-progress.json',
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
  const logger = new Logger('BackfillIsFree');
  const done = opts.resume
    ? loadCheckpoint(CHECKPOINT_PATH)
    : new Set<string>();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const steam = app.get(SteamClient);

  const rows = await dataSource.query<
    Array<{
      gameId: string;
      name: string;
      slug: string;
      isFree: boolean;
      appId: string;
    }>
  >(
    `SELECT g.id AS "gameId", g.name AS name, g.slug AS slug,
            g."isFree" AS "isFree", gs."externalId" AS "appId"
       FROM game g
       JOIN game_source gs
         ON gs."gameId" = g.id AND gs.source = 'STEAM'
      WHERE g."deletedAt" IS NULL
      ORDER BY g.name ASC`,
  );

  logger.log(
    `Found ${rows.length} Steam-linked game(s) ` +
      `(delay=${opts.delayMs}ms${opts.limit ? `, limit=${opts.limit}` : ''}` +
      `${opts.dryRun ? ', dry-run' : ''}). ${done.size} already done.`,
  );

  const counts = {
    flippedToFree: 0,
    flippedToPaid: 0,
    unchanged: 0,
    noDetails: 0,
    err: 0,
  };
  const flippedSlugs: string[] = [];
  let processed = 0;
  let first = true;

  try {
    for (const { gameId, name, slug, isFree, appId } of rows) {
      if (opts.limit !== null && processed >= opts.limit) break;
      if (done.has(gameId)) continue;

      const numericAppId = Number(appId);
      if (!Number.isFinite(numericAppId)) {
        counts.err++;
        done.add(gameId);
        if (!opts.dryRun) saveCheckpoint(CHECKPOINT_PATH, done);
        processed++;
        continue;
      }

      if (!first && opts.delayMs > 0) await sleep(opts.delayMs);
      first = false;

      let label: string;
      try {
        const details = await steam.getAppDetails(numericAppId);
        if (!details) {
          counts.noDetails++;
          label = 'no details';
        } else if (details.isFree === Boolean(isFree)) {
          counts.unchanged++;
          label = 'unchanged';
        } else {
          if (!opts.dryRun) {
            await dataSource.query(
              `UPDATE game SET "isFree" = $1 WHERE id = $2`,
              [details.isFree, gameId],
            );
          }
          if (details.isFree) {
            counts.flippedToFree++;
            flippedSlugs.push(slug);
            label = 'flipped to free';
          } else {
            counts.flippedToPaid++;
            flippedSlugs.push(slug);
            label = 'flipped to paid';
          }
        }
      } catch (error) {
        counts.err++;
        label = `ERR ${error}`;
      }

      processed++;
      done.add(gameId);
      if (!opts.dryRun) saveCheckpoint(CHECKPOINT_PATH, done);
      logger.log(`[${processed}] ${name} (app=${numericAppId}): ${label}`);
    }

    logger.log(
      `Done. processed=${processed} flipped-to-free=${counts.flippedToFree} ` +
        `flipped-to-paid=${counts.flippedToPaid} unchanged=${counts.unchanged} ` +
        `no-details=${counts.noDetails} err=${counts.err}`,
    );
    if (flippedSlugs.length > 0) {
      logger.log(`Flipped slugs: ${flippedSlugs.join(', ')}`);
    }
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

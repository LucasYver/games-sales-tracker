import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * One-off importer for the July 2018 Steam achievement-data leak
 * (`scripts/steam_players_2018_500k.csv` by default: the ~585 titles with
 * >= 500k players; columns: title, players_estimate, steam_app_id).
 *
 * For every row it calls `IngestionService.importLeakPlayerCount`, which:
 *   - skips free-to-play apps and apps that no longer have a Steam store page;
 *   - skips titles released before `--min-year` (default 2013, i.e. "after
 *     2012");
 *   - upserts the game with Steam + IGDB enrichment (genre profile);
 *   - stores the leak player count as a `STEAM_PLAYERS_LEAK` snapshot dated
 *     `--leak-date` (default 2018-07-01).
 *
 * The run is resumable: every processed Steam app id is recorded in a JSON
 * checkpoint next to the CSV, so re-running skips work already done. Steam's
 * store API is rate-limited, so a delay is inserted between rows.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/import-leak-2018.ts \
 *     [--file <csv>] [--min-year 2013] [--leak-date 2018-07-01] \
 *     [--limit <n>] [--delay <ms>] [--no-resume]
 */

interface CliOptions {
  file: string;
  minYear: number;
  leakDate: Date;
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

  return {
    file: get('--file')
      ? resolve(process.cwd(), get('--file')!)
      : resolve(__dirname, '../../../scripts/steam_players_2018_500k.csv'),
    minYear: get('--min-year') ? Number(get('--min-year')) : 2013,
    leakDate: new Date(`${get('--leak-date') ?? '2018-07-01'}T00:00:00.000Z`),
    limit: get('--limit') ? Number(get('--limit')) : null,
    delayMs: get('--delay') ? Number(get('--delay')) : 1500,
    resume: !args.includes('--no-resume'),
  };
}

interface LeakRow {
  appId: number;
  players: number;
}

/**
 * Parse the leak CSV. Titles may contain commas and are quoted, so we read
 * the two numeric columns from the right (players_estimate, steam_app_id)
 * rather than relying on a fixed column split.
 */
function parseCsv(path: string): LeakRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows: LeakRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const appId = Number(parts[parts.length - 1]);
    const players = Number(parts[parts.length - 2]);
    if (!Number.isFinite(appId) || !Number.isFinite(players)) continue;
    rows.push({ appId, players });
  }

  return rows;
}

function loadCheckpoint(path: string): Set<number> {
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as number[];
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveCheckpoint(path: string, done: Set<number>): void {
  writeFileSync(path, JSON.stringify([...done]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('ImportLeak2018');

  const rows = parseCsv(opts.file);
  logger.log(
    `Parsed ${rows.length} leak rows from ${opts.file} ` +
      `(min-year=${opts.minYear}, leak-date=${opts.leakDate
        .toISOString()
        .slice(0, 10)}, delay=${opts.delayMs}ms` +
      `${opts.limit ? `, limit=${opts.limit}` : ''}).`,
  );

  const checkpointPath = resolve(opts.file, '../.import-leak-progress.json');
  const done = opts.resume ? loadCheckpoint(checkpointPath) : new Set<number>();
  if (done.size > 0) {
    logger.log(`Resuming: ${done.size} app id(s) already processed; skipping.`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);

  const counts: Record<string, number> = {
    imported: 0,
    'skipped-free': 0,
    'skipped-old': 0,
    'skipped-no-details': 0,
    failed: 0,
    'already-done': 0,
  };

  let processed = 0;
  try {
    for (const row of rows) {
      if (opts.limit !== null && processed >= opts.limit) break;

      if (done.has(row.appId)) {
        counts['already-done']++;
        continue;
      }

      let outcome: string;
      try {
        outcome = await ingestion.importLeakPlayerCount(
          row.appId,
          row.players,
          { leakDate: opts.leakDate, minReleaseYear: opts.minYear },
        );
      } catch (error) {
        outcome = 'failed';
        logger.warn(`app=${row.appId} threw: ${String(error)}`);
      }

      counts[outcome] = (counts[outcome] ?? 0) + 1;
      done.add(row.appId);
      processed++;

      const total =
        opts.limit !== null ? Math.min(opts.limit, rows.length) : rows.length;
      logger.log(
        `[${processed}/${total}] app=${row.appId} players=${row.players} → ${outcome}`,
      );

      if (processed % 25 === 0) {
        saveCheckpoint(checkpointPath, done);
        logger.log(
          `Progress: ${processed} processed | imported=${counts.imported} ` +
            `free=${counts['skipped-free']} old=${counts['skipped-old']} ` +
            `no-details=${counts['skipped-no-details']} failed=${counts.failed}`,
        );
      }

      await sleep(opts.delayMs);
    }
  } finally {
    saveCheckpoint(checkpointPath, done);
    await app.close();
  }

  logger.log(
    `Done. processed=${processed} | imported=${counts.imported} ` +
      `free=${counts['skipped-free']} old=${counts['skipped-old']} ` +
      `no-details=${counts['skipped-no-details']} failed=${counts.failed} ` +
      `already-done=${counts['already-done']}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

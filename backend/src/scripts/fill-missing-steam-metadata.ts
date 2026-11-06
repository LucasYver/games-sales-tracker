import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { Game } from '../entities/game.entity';

/**
 * Fill empty `categories`, `steamTags` and `dlc` on Steam-linked games, and
 * nothing else. Never overwrites a non-empty value and never touches another
 * column, `updatedAt` included (`games.service` reads it as a date fallback).
 *
 * Why it does not boot `AppModule`: that context runs pending migrations,
 * creates the trigram index and bootstraps the admin user, which are writes.
 * The small module below only opens a connection.
 *
 * Why it does not use `SteamClient`: `getAppDetails` and `getStoreTags` return
 * null both for a network failure and for an app without data, and this script
 * must keep failed games retryable. The URLs and the parsing mirror the client.
 *
 * Every applied change is appended to the JSONL log, which is the undo record.
 * Games are marked done in the checkpoint only when Steam gave a definite answer.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/fill-missing-steam-metadata.ts \
 *     [--limit <n>] [--delay <ms>] [--dry-run] \
 *     [--checkpoint <path>] [--log <path>]
 *
 * Exits with code 2 when it aborts after repeated Steam failures.
 */

const MAX_TAGS = 20;
const NOTHING_STREAK_BEFORE_PAUSE = 20;
const PAUSE_MS = 5 * 60_000;
const MAX_PAUSES = 3;
const MAX_REDIRECTS = 5;
const PROGRESS_EVERY = 25;
const REQUEST_TIMEOUT_MS = 20_000;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [join(__dirname, '..', 'entities', '*.entity.{ts,js}')],
        synchronize: false,
        migrationsRun: false,
        ssl:
          process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
  ],
})
class FillMetadataModule {}

interface CliOptions {
  limit: number | null;
  delayMs: number;
  dryRun: boolean;
  checkpointPath: string;
  logPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limit = Number(get('--limit'));
  const delayMs = Number(get('--delay') ?? 2000);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : null,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 2000,
    dryRun: args.includes('--dry-run'),
    checkpointPath: resolve(
      get('--checkpoint') ??
        join(tmpdir(), 'fill-missing-steam-metadata-progress.json'),
    ),
    logPath: resolve(
      get('--log') ?? join(tmpdir(), 'fill-missing-steam-metadata-log.jsonl'),
    ),
  };
}

type Checkpoint = Record<string, string>;

function loadCheckpoint(path: string): Checkpoint {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Checkpoint;
}

function saveCheckpoint(path: string, done: Checkpoint): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(done));
  renameSync(tmp, path);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spaces every Steam request, redirect hops included. */
class SteamThrottle {
  requests = 0;
  private nextSlotAt = 0;

  constructor(private readonly delayMs: number) {}

  async acquire(): Promise<void> {
    const wait = this.nextSlotAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextSlotAt = Date.now() + this.delayMs;
    this.requests++;
  }
}

/** `none` is a definite answer from Steam, `failed` stays retryable. */
type Fetched<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'none'; reason: string }
  | { kind: 'failed'; reason: string; rateLimited: boolean };

const failed = (reason: string, rateLimited = false): Fetched<never> => ({
  kind: 'failed',
  reason,
  rateLimited,
});

const isRateLimit = (status: number) => status === 429 || status === 403;

interface DetailsValue {
  categories: string[];
  dlc: number[];
}

async function fetchDetails(
  appId: number,
  throttle: SteamThrottle,
): Promise<Fetched<DetailsValue>> {
  await throttle.acquire();
  try {
    const { data, status } = await axios.get(
      'https://store.steampowered.com/api/appdetails',
      {
        params: { appids: appId, l: 'english', cc: 'us' },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      },
    );
    if (status !== 200) {
      return failed(`appdetails HTTP ${status}`, isRateLimit(status));
    }
    const entry = data?.[String(appId)];
    if (!entry || typeof entry !== 'object') {
      return failed('appdetails sent no entry');
    }
    if (entry.success === false) {
      return { kind: 'none', reason: 'no-store-page' };
    }
    const d = entry.data;
    if (entry.success !== true || !d || Array.isArray(d)) {
      return failed('appdetails sent no data');
    }
    return {
      kind: 'ok',
      value: {
        categories: Array.isArray(d.categories)
          ? (d.categories as { description?: unknown }[])
              .map((c) => c.description)
              .filter((c): c is string => typeof c === 'string' && c.length > 0)
          : [],
        dlc: Array.isArray(d.dlc)
          ? (d.dlc as unknown[]).map(Number).filter(Number.isFinite)
          : [],
      },
    };
  } catch (error) {
    return failed(`appdetails ${String(error)}`);
  }
}

async function fetchTags(
  appId: number,
  throttle: SteamThrottle,
): Promise<Fetched<string[]>> {
  // The explicit language matters: on a local IP the store may localize tags.
  let url = `https://store.steampowered.com/app/${appId}/?l=english`;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await throttle.acquire();
      const res = await axios.get<string>(url, {
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
          Cookie:
            'birthtime=0; mature_content=1; wants_mature_content=1; Steam_Language=english',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location as string | undefined;
        if (!location) return failed(`redirect without location`);
        const target = new URL(location, url);
        const path = target.pathname;
        if (path === '/' || path === '') {
          return { kind: 'none', reason: 'no-store-page' };
        }
        if (path.startsWith('/agecheck')) return failed('age gate');
        const redirectedTo = path.match(/^\/app\/(\d+)/)?.[1];
        if (!redirectedTo) return failed(`redirect to ${path}`);
        if (Number(redirectedTo) !== appId) {
          // Same rule as `SteamClient.getStoreTags`: the tags must be this app's.
          return { kind: 'none', reason: `redirected-to-${redirectedTo}` };
        }
        url = target.toString();
        continue;
      }

      if (res.status !== 200) {
        return failed(`store page HTTP ${res.status}`, isRateLimit(res.status));
      }
      return parseTagsPage(appId, String(res.data));
    }
    return failed('too many redirects');
  } catch (error) {
    return failed(`store page ${String(error)}`);
  }
}

function parseTagsPage(appId: number, html: string): Fetched<string[]> {
  const match = html.match(
    new RegExp(`InitAppTagModal\\(\\s*${appId}\\s*,\\s*(\\[.*?\\])`, 's'),
  );
  if (match) {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return failed('tag modal is not an array');
    const tags = parsed
      .map((entry) =>
        entry && typeof (entry as { name?: unknown }).name === 'string'
          ? (entry as { name: string }).name.trim()
          : '',
      )
      .filter((name) => name.length > 0)
      .slice(0, MAX_TAGS);
    return tags.length > 0
      ? { kind: 'ok', value: tags }
      : { kind: 'none', reason: 'page-without-tags' };
  }
  // No tag modal: only a page we recognize counts as a definite answer.
  if (html.includes('apphub_AppName')) {
    return { kind: 'none', reason: 'page-without-tags' };
  }
  if (
    html.includes('error_box') ||
    html.includes('unavailable in your region')
  ) {
    return { kind: 'none', reason: 'no-store-page' };
  }
  return failed('unrecognized store page');
}

/** Tries each Steam app of the game until one has data. */
async function firstWithData<T>(
  appIds: number[],
  fetch: (appId: number) => Promise<Fetched<T>>,
): Promise<{ result: Fetched<T>; appId: number }> {
  let last: { result: Fetched<T>; appId: number } | null = null;
  let firstFailure: { result: Fetched<T>; appId: number } | null = null;
  for (const appId of appIds) {
    const result = await fetch(appId);
    if (result.kind === 'ok') return { result, appId };
    last = { result, appId };
    if (result.kind === 'failed') {
      firstFailure ??= last;
      if (result.rateLimited) break;
    }
  }
  return firstFailure ?? (last as { result: Fetched<T>; appId: number });
}

interface CandidateRow {
  gameId: string;
  name: string;
  appIds: string[];
}

interface CurrentFields {
  categories: string | null;
  steamTags: string | null;
  dlc: number[] | null;
}

const isEmptyText = (value: string | null) => !value || value.trim() === '';
const isEmptyList = (value: number[] | null) => !value || value.length === 0;

async function readFields(
  dataSource: DataSource,
  gameId: string,
): Promise<CurrentFields | null> {
  const rows = await dataSource.query<CurrentFields[]>(
    `SELECT categories, "steamTags", dlc
       FROM game
      WHERE id = $1 AND "deletedAt" IS NULL`,
    [gameId],
  );
  return rows[0] ?? null;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('FillMissingSteamMetadata');
  const done = loadCheckpoint(opts.checkpointPath);
  const throttle = new SteamThrottle(opts.delayMs);

  const app = await NestFactory.createApplicationContext(FillMetadataModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const games = dataSource.getRepository(Game);

  const stats = {
    done: 0,
    tagsFilled: 0,
    categoriesFilled: 0,
    dlcFilled: 0,
    noData: 0,
    failed: 0,
    alreadyFilled: 0,
  };
  const startedAt = Date.now();
  const progress = () =>
    `done=${stats.done} tags=${stats.tagsFilled} categories=${stats.categoriesFilled} ` +
    `dlc=${stats.dlcFilled} noData=${stats.noData} failed=${stats.failed} ` +
    `alreadyFilled=${stats.alreadyFilled} requests=${throttle.requests} ` +
    `elapsed=${Math.round((Date.now() - startedAt) / 60_000)}min`;

  let aborted = false;

  try {
    const rows = await dataSource.query<CandidateRow[]>(
      `SELECT g.id AS "gameId", g.name AS name,
              array_agg(gs."externalId" ORDER BY gs."externalId"::numeric) AS "appIds"
         FROM game g
         JOIN game_source gs ON gs."gameId" = g.id AND gs.source = 'STEAM'
        WHERE g."deletedAt" IS NULL
          AND gs."externalId" ~ '^[0-9]+$'
          AND (COALESCE(g.categories, '') = '' OR COALESCE(g."steamTags", '') = '')
        GROUP BY g.id, g.name
        ORDER BY g.name ASC`,
    );
    const pending = rows.filter((row) => !(row.gameId in done));
    logger.log(
      `Found ${rows.length} game(s) with missing metadata, ${pending.length} to process ` +
        `(delay=${opts.delayMs}ms${opts.limit ? `, limit=${opts.limit}` : ''}` +
        `${opts.dryRun ? ', DRY RUN' : ''}).`,
    );

    let processed = 0;
    let nothingStreak = 0;
    let pauses = 0;

    for (const { gameId, name, appIds: rawAppIds } of pending) {
      if (opts.limit !== null && processed >= opts.limit) break;
      processed++;

      const before = await readFields(dataSource, gameId);
      if (
        !before ||
        (!isEmptyText(before.categories) && !isEmptyText(before.steamTags))
      ) {
        stats.alreadyFilled++;
        stats.done++;
        done[gameId] = 'already-filled';
        if (!opts.dryRun) saveCheckpoint(opts.checkpointPath, done);
        continue;
      }

      const appIds = rawAppIds.map(Number);
      const needTags = isEmptyText(before.steamTags);
      const needDetails = isEmptyText(before.categories);

      const tags = needTags
        ? await firstWithData(appIds, (id) => fetchTags(id, throttle))
        : null;
      const tagsRateLimited =
        tags?.result.kind === 'failed' && tags.result.rateLimited;
      const details =
        needDetails && !tagsRateLimited
          ? await firstWithData(appIds, (id) => fetchDetails(id, throttle))
          : null;

      // Read again right before writing: the crons run during these hours.
      const current = await readFields(dataSource, gameId);
      const patch: Partial<Record<'categories' | 'steamTags' | 'dlc', unknown>> = {};
      if (current) {
        if (tags?.result.kind === 'ok' && isEmptyText(current.steamTags)) {
          patch.steamTags = tags.result.value;
        }
        if (details?.result.kind === 'ok') {
          const { categories, dlc } = details.result.value;
          if (categories.length > 0 && isEmptyText(current.categories)) {
            patch.categories = categories;
          }
          if (dlc.length > 0 && isEmptyList(current.dlc)) patch.dlc = dlc;
        }
      }

      const fields = Object.keys(patch) as (keyof typeof patch)[];
      if (fields.length > 0 && !opts.dryRun && current) {
        await games.update(gameId, {
          ...patch,
          // Keeps the automatic @UpdateDateColumn bump out of this write.
          updatedAt: () => '"updatedAt"',
        } as never);
        appendFileSync(
          opts.logPath,
          JSON.stringify({
            gameId,
            appId: (tags?.result.kind === 'ok' ? tags : details)?.appId,
            name,
            fields,
            previous: Object.fromEntries(fields.map((f) => [f, current[f]])),
            new: patch,
            timestamp: new Date().toISOString(),
          }) + '\n',
        );
      }
      if (patch.steamTags) stats.tagsFilled++;
      if (patch.categories) stats.categoriesFilled++;
      if (patch.dlc) stats.dlcFilled++;

      const results = [tags?.result, details?.result].filter(
        (r): r is NonNullable<typeof r> => r != null,
      );
      const failure = results.find((r) => r.kind === 'failed');
      // A game skipped because the first fetch hit a rate limit is not definite.
      const definite = !failure;

      if (definite) {
        const reasons = results.map((r) =>
          r.kind === 'none' ? r.reason : 'ok',
        );
        if (fields.length === 0) stats.noData++;
        stats.done++;
        done[gameId] = fields.length > 0 ? 'filled' : reasons.join('+');
        if (!opts.dryRun) saveCheckpoint(opts.checkpointPath, done);
      } else {
        stats.failed++;
      }

      const reason =
        failure?.kind === 'failed' ? ` FAILED(${failure.reason})` : '';
      logger.log(
        `[${processed}] ${name} (app=${appIds.join('/')}): ` +
          `${fields.length > 0 ? `wrote ${fields.join(',')}` : 'nothing written'}${reason}` +
          (opts.dryRun && fields.length > 0 ? ` ${JSON.stringify(patch)}` : ''),
      );
      if (processed % PROGRESS_EVERY === 0) logger.log(`Progress: ${progress()}`);

      nothingStreak = fields.length > 0 ? 0 : nothingStreak + 1;
      const rateLimited = failure?.kind === 'failed' && failure.rateLimited;
      if (nothingStreak >= NOTHING_STREAK_BEFORE_PAUSE || rateLimited) {
        if (pauses >= MAX_PAUSES) {
          logger.error(
            `Aborting after ${pauses} pauses: Steam still returns nothing. Checkpoint kept.`,
          );
          aborted = true;
          break;
        }
        pauses++;
        logger.warn(
          `${rateLimited ? 'Steam rate limit' : `${nothingStreak} games in a row without data`}: ` +
            `pause ${pauses}/${MAX_PAUSES} for ${PAUSE_MS / 60_000} minutes.`,
        );
        await sleep(PAUSE_MS);
        nothingStreak = 0;
      }
    }

    logger.log(`${aborted ? 'Aborted' : 'Finished'}. ${progress()}`);
  } finally {
    await app.close();
  }

  if (aborted) process.exitCode = 2;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { MatcherService } from '../reference-profiles/matcher.service';
import { Platform } from '../entities';

/**
 * Leave-one-out validation of the data-driven matcher (Forme C) using
 * the July 2018 Steam leak (~585 games with known player counts) as
 * ground truth.
 *
 * For each leak game we:
 *   1. reconstruct the observed targets (reviews→units at leak date,
 *      m1 = reviewsCum(A1)/reviewsCum(S1), y2 = reviewsCum(A2)/reviewsCum(A1));
 *   2. ask the matcher for a prediction, EXCLUDING the game's own anchor
 *      from the corpus (`holdoutGameId`), so it never becomes its own
 *      neighbour.
 *
 * The prediction is compared to the observed value; per-target metrics
 * are logged (median absolute log-error, coverage) and a JSON dump is
 * written to `--out`.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/validate-matcher-holdout.ts \
 *     [--leak-date 2018-07-01] [--k 15] [--out <path>]
 */

interface CliOptions {
  leakDate: Date;
  k: number;
  outPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    leakDate: new Date(`${get('--leak-date') ?? '2018-07-01'}T00:00:00.000Z`),
    k: get('--k') ? Number(get('--k')) : 15,
    outPath: get('--out')
      ? resolve(process.cwd(), get('--out')!)
      : resolve(__dirname, '../../../scripts/.validate-matcher-holdout.json'),
  };
}

interface LeakGameRow {
  gameId: string;
  name: string;
  releaseDate: Date | null;
  categories: string[] | null;
  genres: string[] | null;
  steamTags: string[] | null;
  platforms: string[] | null;
  publisherId: string | null;
  dlc: number[] | null;
  developer: string | null;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  leakPlayers: number;
}

interface Observed {
  reviewsToUnits: number | null;
  m1: number | null;
  y2: number | null;
}

interface Prediction {
  reviewsToUnits: number | null;
  m1: number | null;
  y2: number | null;
}

type Method = 'matcher';

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('ValidateMatcherHoldout');
  logger.log(
    `leak-date=${opts.leakDate.toISOString().slice(0, 10)} k=${opts.k} out=${opts.outPath}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const matcher = app.get(MatcherService);

  try {
    const rows = await loadLeakGames(dataSource, opts.leakDate);
    logger.log(`Loaded ${rows.length} leak game(s).`);

    const results: Array<{
      gameId: string;
      name: string;
      observed: Observed;
      matcher: Prediction & { coldStart: boolean; neighbours: number };
    }> = [];

    for (const row of rows) {
      const observed = await computeObserved(dataSource, row, opts.leakDate);
      const matcherPred = await predictWithMatcher(matcher, row, opts.k);

      results.push({
        gameId: row.gameId,
        name: row.name,
        observed,
        matcher: matcherPred,
      });
    }

    const report = summarise(results);
    printReport(report);
    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          opts: {
            leakDate: opts.leakDate.toISOString().slice(0, 10),
            k: opts.k,
          },
          summary: report,
          perGame: results,
        },
        null,
        2,
      ),
    );
    logger.log(`Wrote JSON report to ${opts.outPath}`);
  } finally {
    await app.close();
  }
}

async function loadLeakGames(
  dataSource: DataSource,
  leakDate: Date,
): Promise<LeakGameRow[]> {
  const raw = await dataSource.query<
    Array<{
      gameId: string;
      name: string;
      releaseDate: Date | null;
      categories: string[] | string | null;
      genres: string[] | string | null;
      steamTags: string[] | string | null;
      platforms: string[] | string | null;
      publisherId: string | null;
      dlc: number[] | null;
      developer: string | null;
      franchiseSlug: string | null;
      isAnnualIteration: boolean;
      liveService: boolean;
      leakPlayers: string;
    }>
  >(
    `SELECT g.id AS "gameId",
            g.name AS name,
            g."releaseDate" AS "releaseDate",
            g.categories AS categories,
            g.genres AS genres,
            g."steamTags" AS "steamTags",
            g.platforms::text[] AS platforms,
            g."publisherId" AS "publisherId",
            g.dlc AS dlc,
            g.developer AS developer,
            g."franchiseSlug" AS "franchiseSlug",
            g."isAnnualIteration" AS "isAnnualIteration",
            g."liveService" AS "liveService",
            s.value AS "leakPlayers"
       FROM signal_snapshot s
       JOIN game g ON g.id = s."gameId"
      WHERE s.metric = 'STEAM_PLAYERS_LEAK'
        AND g."deletedAt" IS NULL
        AND (s."capturedAt" <= $1 OR s."capturedAt" IS NULL)
      ORDER BY g.name ASC`,
    [leakDate],
  );
  return raw.map((r) => ({
    gameId: r.gameId,
    name: r.name,
    releaseDate: r.releaseDate,
    categories: parseArray(r.categories),
    genres: parseArray(r.genres),
    steamTags: parseArray(r.steamTags),
    platforms: parseArray(r.platforms),
    publisherId: r.publisherId,
    dlc: r.dlc ?? null,
    developer: r.developer,
    franchiseSlug: r.franchiseSlug,
    isAnnualIteration: Boolean(r.isAnnualIteration),
    liveService: Boolean(r.liveService),
    leakPlayers: Number(r.leakPlayers),
  }));
}

function parseArray(raw: string[] | string | null): string[] {
  if (raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

async function computeObserved(
  dataSource: DataSource,
  row: LeakGameRow,
  leakDate: Date,
): Promise<Observed> {
  const cumReviewsAtLeak = await latestCumulativeReview(
    dataSource,
    row.gameId,
    leakDate,
  );
  const reviewsToUnits =
    cumReviewsAtLeak !== null && cumReviewsAtLeak > 0
      ? row.leakPlayers / cumReviewsAtLeak
      : null;

  let m1: number | null = null;
  let y2: number | null = null;
  if (row.releaseDate) {
    const s1 = await latestCumulativeReview(
      dataSource,
      row.gameId,
      addDays(row.releaseDate, 7),
    );
    const a1 = await latestCumulativeReview(
      dataSource,
      row.gameId,
      addDays(row.releaseDate, 365),
    );
    const a2 = await latestCumulativeReview(
      dataSource,
      row.gameId,
      addDays(row.releaseDate, 730),
    );
    if (s1 !== null && s1 > 0 && a1 !== null && a1 > 0) m1 = a1 / s1;
    if (a1 !== null && a1 > 0 && a2 !== null && a2 > 0) y2 = a2 / a1;
  }
  return { reviewsToUnits, m1, y2 };
}

async function latestCumulativeReview(
  dataSource: DataSource,
  gameId: string,
  cutoff: Date,
): Promise<number | null> {
  const rows = await dataSource.query<Array<{ value: number }>>(
    `SELECT s.value
       FROM signal_snapshot s
      WHERE s."gameId" = $1
        AND s.metric = 'STEAM_REVIEWS'
        AND s."capturedAt" <= $2
      ORDER BY s."capturedAt" DESC
      LIMIT 1`,
    [gameId, cutoff],
  );
  return rows.length > 0 ? Number(rows[0].value) : null;
}

async function predictWithMatcher(
  matcher: MatcherService,
  row: LeakGameRow,
  k: number,
): Promise<Prediction & { coldStart: boolean; neighbours: number }> {
  const match = await matcher.findNeighbours(
    {
      platforms: (row.platforms ?? []).filter((p): p is Platform =>
        (Object.values(Platform) as string[]).includes(p),
      ),
      categories: row.categories,
      genres: row.genres,
      steamTags: row.steamTags,
      publisherId: row.publisherId,
      dlc: row.dlc,
      releaseDate: row.releaseDate,
      developer: row.developer,
      franchiseSlug: row.franchiseSlug,
      isAnnualIteration: row.isAnnualIteration,
      liveService: row.liveService,
    },
    { holdoutGameId: row.gameId, k },
  );
  const s1 = match.curve.s1;
  const a2 = match.curve.a2;
  return {
    reviewsToUnits: match.reviewsToUnits,
    m1: s1 !== null && s1 > 0 ? 1 / s1 : null,
    y2: a2,
    coldStart: match.coldStart,
    neighbours: match.neighboursUsed,
  };
}

interface MethodSummary {
  method: Method;
  target: 'reviewsToUnits' | 'm1' | 'y2';
  n: number;
  medianAbsLogError: number;
  meanAbsLogError: number;
  mape: number;
}

function summarise(
  results: Array<{
    observed: Observed;
    matcher: Prediction;
  }>,
): MethodSummary[] {
  const summaries: MethodSummary[] = [];
  for (const method of ['matcher'] as const) {
    for (const target of ['reviewsToUnits', 'm1', 'y2'] as const) {
      const pairs = results
        .map((r) => ({
          observed: r.observed[target],
          predicted: r[method][target],
        }))
        .filter(
          (p): p is { observed: number; predicted: number } =>
            p.observed !== null &&
            p.predicted !== null &&
            p.observed > 0 &&
            p.predicted > 0,
        );
      if (pairs.length === 0) {
        summaries.push({
          method,
          target,
          n: 0,
          medianAbsLogError: NaN,
          meanAbsLogError: NaN,
          mape: NaN,
        });
        continue;
      }
      const logErrors = pairs.map((p) =>
        Math.abs(Math.log10(p.predicted / p.observed)),
      );
      const mapeVals = pairs.map(
        (p) => Math.abs(p.predicted - p.observed) / p.observed,
      );
      logErrors.sort((a, b) => a - b);
      summaries.push({
        method,
        target,
        n: pairs.length,
        medianAbsLogError: logErrors[Math.floor(logErrors.length / 2)],
        meanAbsLogError:
          logErrors.reduce((a, b) => a + b, 0) / logErrors.length,
        mape: mapeVals.reduce((a, b) => a + b, 0) / mapeVals.length,
      });
    }
  }
  return summaries;
}

function printReport(summaries: MethodSummary[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number, w = 8) =>
    Number.isFinite(v) ? v.toFixed(3).padStart(w) : 'n/a'.padStart(w);

  console.log('');
  console.log(
    `${pad('method', 15)} ${pad('target', 18)} ${pad('N', 6)} ${pad('median|logErr|', 14)} ${pad('mean|logErr|', 14)} ${pad('MAPE', 8)}`,
  );
  console.log('-'.repeat(15 + 1 + 18 + 1 + 6 + 1 + 14 + 1 + 14 + 1 + 8));
  for (const s of summaries) {
    console.log(
      `${pad(s.method, 15)} ${pad(s.target, 18)} ${pad(String(s.n), 6)} ${num(s.medianAbsLogError, 14)} ${num(s.meanAbsLogError, 14)} ${num(s.mape, 8)}`,
    );
  }
  console.log('');
  console.log(
    'Interpretation: lower |logErr| is better; log10 space so 0.30 ≈ 2× off, 0.10 ≈ 1.26× off. MAPE stays in linear space for intuition.',
  );
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

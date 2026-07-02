import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

/**
 * Read-only diagnostic that measures, on the games covered by the July
 * 2018 Steam leak (~585 titles with a known player count), which
 * feature-based partition minimises the intra-group variance of the
 * behavioural targets consumed by the estimation model:
 *
 *   1. reviews→units ratio (Boxleiter, PC)   — leakPlayers / cumReviewsAtLeak
 *   2. week-1 → year-1 multiplier (m1)       — reviewsCum(A1) / reviewsCum(S1)
 *   3. year-2 retention factor               — reviewsCum(A2) / reviewsCum(A1)
 *
 * For every candidate partition (`GenreProfile` baseline, platforms,
 * play-mode, price tier, publisher tier, and combinations) we compute
 * the fraction of each target's log-variance the partition explains
 * (an R² in [0, 1]) and rank partitions by their combined score. Higher
 * is better — a partition with R² close to 1 groups games with tightly
 * similar observed behaviour.
 *
 * All computation is done on the same eligible-game set per target so
 * partitions are compared fairly. Buckets with fewer than
 * `--min-group-size` games are folded into a shared "SMALL" bucket
 * rather than dropped, which keeps N constant across partitions.
 *
 * Nothing is written to the database. The script produces:
 *   - a human-readable table on stdout, ranked by combined R²;
 *   - a JSON dump at `--out` (default `scripts/.diagnose-grouping.json`).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/diagnose-grouping.ts \
 *     [--leak-date 2018-07-01] [--min-group-size 3] [--out <path>]
 */

interface CliOptions {
  leakDate: Date;
  minGroupSize: number;
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
    minGroupSize: get('--min-group-size') ? Number(get('--min-group-size')) : 3,
    outPath: get('--out')
      ? resolve(process.cwd(), get('--out')!)
      : resolve(__dirname, '../../../scripts/.diagnose-grouping.json'),
  };
}

interface LeakGameRow {
  gameId: string;
  name: string;
  releaseDate: Date | null;
  genres: string[] | null;
  categories: string[] | null;
  platforms: string[] | null;
  publisherName: string | null;
  publisherIsCurated: boolean;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  leakPlayers: number;
  latestPriceCents: number | null;
}

interface CurveCumulative {
  s1: number | null;
  a1: number | null;
  a2: number | null;
  atLeak: number | null;
}

interface GamePoint {
  row: LeakGameRow;
  targets: {
    reviewsToUnits: number | null;
    m1: number | null;
    y2: number | null;
  };
  logTargets: {
    reviewsToUnits: number | null;
    m1: number | null;
    y2: number | null;
  };
  features: Record<string, string>;
}

const TARGETS = ['reviewsToUnits', 'm1', 'y2'] as const;
type TargetKey = (typeof TARGETS)[number];

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('DiagnoseGrouping');
  const leakIso = opts.leakDate.toISOString().slice(0, 10);
  logger.log(
    `leak-date=${leakIso} min-group-size=${opts.minGroupSize} out=${opts.outPath}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);

  try {
    const rows = await loadLeakGames(dataSource, opts.leakDate);
    logger.log(`Loaded ${rows.length} leak game(s).`);

    const points = await Promise.all(
      rows.map(async (row) => buildGamePoint(dataSource, row, opts.leakDate)),
    );

    const coverage = summariseCoverage(points);
    logger.log(
      `Target coverage — reviewsToUnits=${coverage.reviewsToUnits} m1=${coverage.m1} y2=${coverage.y2}`,
    );

    const partitions = buildPartitionCatalog();

    const report = computeReport(points, partitions, opts.minGroupSize);

    printReport(report, coverage);
    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          opts: { leakDate: leakIso, minGroupSize: opts.minGroupSize },
          coverage,
          report,
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
  // The leak metric is stored on `signal_snapshot`. We join through to the
  // game and its (optional) curated publisher / genre-profile records so the
  // baseline partition (current genre-profile assignment) is available for
  // comparison without an extra query per game.
  const raw = await dataSource.query<
    Array<{
      gameId: string;
      name: string;
      releaseDate: Date | null;
      genres: string[] | null;
      categories: string[] | null;
      platforms: string[] | null;
      publisherName: string | null;
      publisherIsCurated: boolean;
      franchiseSlug: string | null;
      isAnnualIteration: boolean;
      liveService: boolean;
      leakPlayers: string;
      latestPriceCents: string | null;
    }>
  >(
    `SELECT g.id AS "gameId",
            g.name AS name,
            g."releaseDate" AS "releaseDate",
            g.genres AS genres,
            g.categories AS categories,
            g.platforms::text[] AS platforms,
            COALESCE(p.name, g.publisher) AS "publisherName",
            (p.id IS NOT NULL) AS "publisherIsCurated",
            g."franchiseSlug" AS "franchiseSlug",
            g."isAnnualIteration" AS "isAnnualIteration",
            g."liveService" AS "liveService",
            s.value AS "leakPlayers",
            (
              SELECT ps.final
              FROM price_snapshot ps
              WHERE ps."gameId" = g.id
              ORDER BY ps."capturedAt" DESC
              LIMIT 1
            ) AS "latestPriceCents"
       FROM signal_snapshot s
       JOIN game g ON g.id = s."gameId"
       LEFT JOIN publisher p ON p.id = g."publisherId"
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
    genres: parseArray(r.genres),
    categories: parseArray(r.categories),
    platforms: parseArray(r.platforms),
    publisherName: r.publisherName,
    publisherIsCurated: r.publisherIsCurated,
    franchiseSlug: r.franchiseSlug,
    isAnnualIteration: Boolean(r.isAnnualIteration),
    liveService: Boolean(r.liveService),
    leakPlayers: Number(r.leakPlayers),
    latestPriceCents:
      r.latestPriceCents !== null ? Number(r.latestPriceCents) : null,
  }));
}

// TypeORM returns `simple-array` columns as CSV strings and `text[]` as
// native JS arrays depending on driver quirks. Normalise both shapes.
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

/**
 * Query the cumulative Steam-review count for a game at four cutoffs:
 *   - `atLeak`: the leak date (used with `leakPlayers` for reviews→units)
 *   - `s1`, `a1`, `a2`: release-relative day 7 / 365 / 730 (curve shape)
 *
 * `STEAM_REVIEWS` snapshots are cumulative totals (see
 * `IngestionService.backfillReviewsFromHistogram`), so we take the most
 * recent snapshot with `capturedAt <= cutoff` at each point.
 */
async function fetchCurveCumulative(
  dataSource: DataSource,
  gameId: string,
  releaseDate: Date | null,
  leakDate: Date,
): Promise<CurveCumulative> {
  const cutoffs: Array<{ key: keyof CurveCumulative; date: Date | null }> = [
    { key: 'atLeak', date: leakDate },
    {
      key: 's1',
      date: releaseDate ? addDays(releaseDate, 7) : null,
    },
    {
      key: 'a1',
      date: releaseDate ? addDays(releaseDate, 365) : null,
    },
    {
      key: 'a2',
      date: releaseDate ? addDays(releaseDate, 730) : null,
    },
  ];

  const result: CurveCumulative = {
    s1: null,
    a1: null,
    a2: null,
    atLeak: null,
  };

  for (const { key, date } of cutoffs) {
    if (!date) continue;
    const rows = await dataSource.query<Array<{ value: number }>>(
      `SELECT s.value
         FROM signal_snapshot s
        WHERE s."gameId" = $1
          AND s.metric = 'STEAM_REVIEWS'
          AND s."capturedAt" <= $2
        ORDER BY s."capturedAt" DESC
        LIMIT 1`,
      [gameId, date],
    );
    if (rows.length > 0) {
      result[key] = Number(rows[0].value);
    }
  }

  return result;
}

async function buildGamePoint(
  dataSource: DataSource,
  row: LeakGameRow,
  leakDate: Date,
): Promise<GamePoint> {
  const curve = await fetchCurveCumulative(
    dataSource,
    row.gameId,
    row.releaseDate,
    leakDate,
  );

  const reviewsToUnits =
    curve.atLeak !== null && curve.atLeak > 0
      ? row.leakPlayers / curve.atLeak
      : null;

  const m1 =
    curve.s1 !== null && curve.s1 > 0 && curve.a1 !== null && curve.a1 > 0
      ? curve.a1 / curve.s1
      : null;

  const y2 =
    curve.a1 !== null && curve.a1 > 0 && curve.a2 !== null && curve.a2 > 0
      ? curve.a2 / curve.a1
      : null;

  const features = extractFeatures(row);

  return {
    row,
    targets: { reviewsToUnits, m1, y2 },
    logTargets: {
      reviewsToUnits:
        reviewsToUnits !== null && reviewsToUnits > 0
          ? Math.log10(reviewsToUnits)
          : null,
      m1: m1 !== null && m1 > 0 ? Math.log10(m1) : null,
      y2: y2 !== null && y2 > 0 ? Math.log10(y2) : null,
    },
    features,
  };
}

// --- Feature extraction ---------------------------------------------------

function extractFeatures(row: LeakGameRow): Record<string, string> {
  return {
    firstGenre: firstGenreFeature(row.genres),
    genresSet: genresSetFeature(row.genres),
    platforms: platformsFeature(row.platforms),
    playMode: playModeFeature(row.categories),
    priceTier: priceTierFeature(row.latestPriceCents),
    publisherTier: publisherTierFeature(row),
    scaleBucket: scaleBucketFeature(row.leakPlayers),
    releaseEra: releaseEraFeature(row.releaseDate),
    franchise: row.franchiseSlug ?? 'NONE',
    annual: row.isAnnualIteration ? 'ANNUAL' : 'ONE_SHOT',
    liveService: row.liveService ? 'LIVE' : 'PACKAGED',
  };
}

function firstGenreFeature(genres: string[] | null): string {
  if (!genres || genres.length === 0) return 'NONE';
  return genres[0].toLowerCase();
}

function genresSetFeature(genres: string[] | null): string {
  if (!genres || genres.length === 0) return 'NONE';
  return [...new Set(genres.map((g) => g.toLowerCase()))].sort().join('+');
}

const CONSOLE_PLATFORMS = new Set(['PLAYSTATION', 'XBOX', 'SWITCH']);

function platformsFeature(platforms: string[] | null): string {
  if (!platforms || platforms.length === 0) return 'NONE';
  const set = new Set(platforms);
  const hasPc = set.has('PC');
  const consoles = [...set].filter((p) => CONSOLE_PLATFORMS.has(p));
  if (hasPc && consoles.length === 0) return 'PC_ONLY';
  if (!hasPc && consoles.length > 0) return 'CONSOLE_ONLY';
  const consoleCount = consoles.length;
  if (hasPc && consoleCount === 1) return `PC+${consoles[0]}`;
  if (hasPc && consoleCount >= 2) return 'PC+MULTI_CONSOLE';
  return 'OTHER';
}

/**
 * Coarse play-mode bucket derived from Steam store `categories`. MMO is
 * treated as its own bucket because its lifecycle differs sharply from
 * regular multiplayer.
 */
function playModeFeature(categories: string[] | null): string {
  if (!categories || categories.length === 0) return 'UNKNOWN';
  const set = new Set(categories.map((c) => c.toLowerCase()));
  const hasSolo = set.has('single-player');
  const hasCoop =
    set.has('co-op') ||
    set.has('online co-op') ||
    set.has('shared/split screen co-op');
  const hasMulti =
    set.has('multi-player') ||
    set.has('online pvp') ||
    set.has('pvp') ||
    set.has('cross-platform multiplayer');
  const hasMmo = set.has('mmo') || set.has('massively multiplayer');

  if (hasMmo) return 'MMO';
  if (hasSolo && (hasCoop || hasMulti)) return 'MIXED';
  if (hasCoop && !hasMulti) return 'COOP';
  if (hasMulti) return 'MULTI';
  if (hasSolo) return 'SOLO';
  return 'UNKNOWN';
}

// Cents thresholds are USD-anchored: budget = < $15, mid = $15–30,
// premium = $30–60, ultra ≥ $60 (standard AAA MSRP). "Unknown" folds
// null / free titles together so it does not distort premium buckets.
function priceTierFeature(cents: number | null): string {
  if (cents === null) return 'UNKNOWN';
  if (cents < 1500) return 'BUDGET';
  if (cents < 3000) return 'MID';
  if (cents < 6000) return 'PREMIUM';
  return 'ULTRA';
}

function publisherTierFeature(row: LeakGameRow): string {
  if (row.publisherIsCurated) return 'CURATED_AAA';
  if (row.publisherName && row.publisherName.length > 0) return 'OTHER_LABEL';
  return 'UNKNOWN';
}

function scaleBucketFeature(players: number): string {
  if (players >= 10_000_000) return 'HUGE';
  if (players >= 3_000_000) return 'LARGE';
  if (players >= 1_000_000) return 'MEDIUM';
  return 'SMALL';
}

function releaseEraFeature(date: Date | null): string {
  if (!date) return 'UNKNOWN';
  const year = date.getUTCFullYear();
  if (year < 2013) return 'PRE_2013';
  if (year < 2015) return '2013_2014';
  if (year < 2017) return '2015_2016';
  return '2017_PLUS';
}

// --- Partitions -----------------------------------------------------------

interface Partition {
  name: string;
  bucket: (features: Record<string, string>) => string;
}

function buildPartitionCatalog(): Partition[] {
  const single = (feature: string): Partition => ({
    name: feature,
    bucket: (f) => f[feature],
  });
  const combo = (...features: string[]): Partition => ({
    name: features.join(' × '),
    bucket: (f) => features.map((k) => f[k]).join(' | '),
  });
  return [
    single('firstGenre'),
    single('genresSet'),
    single('platforms'),
    single('playMode'),
    single('priceTier'),
    single('publisherTier'),
    single('scaleBucket'),
    single('releaseEra'),
    combo('platforms', 'playMode'),
    combo('playMode', 'scaleBucket'),
    combo('playMode', 'priceTier'),
    combo('platforms', 'priceTier'),
    combo('platforms', 'playMode', 'scaleBucket'),
    combo('firstGenre', 'playMode'),
    combo('firstGenre', 'platforms'),
    single('annual'),
    single('liveService'),
    single('franchise'),
    combo('annual', 'platforms'),
    combo('liveService', 'playMode'),
    combo('annual', 'scaleBucket'),
    combo('platforms', 'playMode', 'liveService'),
  ];
}

// --- Statistics -----------------------------------------------------------

interface PartitionScore {
  partition: string;
  target: TargetKey;
  n: number;
  totalBuckets: number;
  bucketsOverThreshold: number;
  r2: number;
}

interface PartitionSummary {
  partition: string;
  combined: number;
  perTarget: Record<TargetKey, PartitionScore>;
}

function computeReport(
  points: GamePoint[],
  partitions: Partition[],
  minGroupSize: number,
): PartitionSummary[] {
  const scoresByPartition = new Map<
    string,
    Record<TargetKey, PartitionScore>
  >();

  for (const partition of partitions) {
    const record: Partial<Record<TargetKey, PartitionScore>> = {};
    for (const target of TARGETS) {
      record[target] = scorePartition(points, partition, target, minGroupSize);
    }
    scoresByPartition.set(
      partition.name,
      record as Record<TargetKey, PartitionScore>,
    );
  }

  const summaries: PartitionSummary[] = [];
  for (const [name, perTarget] of scoresByPartition) {
    // Combined score = mean of per-target R². Equal weighting keeps the
    // ranking easy to reason about; individual columns stay available in
    // the JSON dump if we want to re-weight later.
    const combined =
      (perTarget.reviewsToUnits.r2 + perTarget.m1.r2 + perTarget.y2.r2) / 3;
    summaries.push({ partition: name, combined, perTarget });
  }
  summaries.sort((a, b) => b.combined - a.combined);
  return summaries;
}

function scorePartition(
  points: GamePoint[],
  partition: Partition,
  target: TargetKey,
  minGroupSize: number,
): PartitionScore {
  // Eligible = games with a defined log-target value. R² is computed on
  // this fixed set so partitions are compared over identical N.
  const eligible = points.filter((p) => p.logTargets[target] !== null);
  const values = eligible.map((p) => p.logTargets[target] as number);
  const buckets = eligible.map((p) => partition.bucket(p.features));

  // Fold small buckets (< minGroupSize) into a shared SMALL bin so we
  // don't drop games and preserve N across partitions.
  const bucketCounts = new Map<string, number>();
  for (const b of buckets) bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
  const foldedBuckets = buckets.map((b) =>
    (bucketCounts.get(b) ?? 0) < minGroupSize ? '__SMALL__' : b,
  );

  const totalBuckets = bucketCounts.size;
  const bucketsOverThreshold = [...bucketCounts.values()].filter(
    (n) => n >= minGroupSize,
  ).length;

  const totalVar = variance(values);
  const withinVar = withinGroupVariance(values, foldedBuckets);
  const r2 = totalVar > 0 ? Math.max(0, 1 - withinVar / totalVar) : 0;

  return {
    partition: partition.name,
    target,
    n: eligible.length,
    totalBuckets,
    bucketsOverThreshold,
    r2,
  };
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return sq / values.length;
}

function withinGroupVariance(values: number[], buckets: string[]): number {
  const grouped = new Map<string, number[]>();
  for (let i = 0; i < values.length; i++) {
    const b = buckets[i];
    const arr = grouped.get(b) ?? [];
    arr.push(values[i]);
    grouped.set(b, arr);
  }
  let sumSq = 0;
  let n = 0;
  for (const arr of grouped.values()) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    for (const v of arr) sumSq += (v - mean) ** 2;
    n += arr.length;
  }
  return n > 0 ? sumSq / n : 0;
}

// --- Reporting ------------------------------------------------------------

interface Coverage {
  reviewsToUnits: number;
  m1: number;
  y2: number;
}

function summariseCoverage(points: GamePoint[]): Coverage {
  return {
    reviewsToUnits: points.filter((p) => p.logTargets.reviewsToUnits !== null)
      .length,
    m1: points.filter((p) => p.logTargets.m1 !== null).length,
    y2: points.filter((p) => p.logTargets.y2 !== null).length,
  };
}

function printReport(summaries: PartitionSummary[], coverage: Coverage): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number, w = 6) => v.toFixed(3).padStart(w);

  console.log('');
  console.log(
    `Coverage (games with target defined): reviewsToUnits=${coverage.reviewsToUnits} m1=${coverage.m1} y2=${coverage.y2}`,
  );
  console.log('');
  console.log(
    `${pad('#', 3)} ${pad('partition', 44)} ${pad('combined R²', 12)} ${pad('r2u R²', 8)} ${pad('m1 R²', 8)} ${pad('y2 R²', 8)} ${pad('buckets≥K', 10)}`,
  );
  console.log('-'.repeat(3 + 1 + 44 + 1 + 12 + 1 + 8 + 1 + 8 + 1 + 8 + 1 + 10));
  summaries.forEach((s, i) => {
    const overThreshold = TARGETS.map(
      (t) => s.perTarget[t].bucketsOverThreshold,
    ).join('/');
    console.log(
      `${pad(String(i + 1), 3)} ${pad(s.partition, 44)} ${num(s.combined, 12)} ${num(s.perTarget.reviewsToUnits.r2, 8)} ${num(s.perTarget.m1.r2, 8)} ${num(s.perTarget.y2.r2, 8)} ${pad(overThreshold, 10)}`,
    );
  });
  console.log('');
  console.log(
    'Note: higher combined R² means the partition explains more variance in the observed targets — a stronger candidate grouping signal for the matcher.',
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

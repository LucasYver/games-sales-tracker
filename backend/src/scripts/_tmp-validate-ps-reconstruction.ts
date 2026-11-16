import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import {
  reconstructPsCurveMonthly,
  reconstructPsRatingAt,
  type DatedValue,
  type PsReconstructionInputs,
} from '../estimation/ps-curve-reconstruction';

/**
 * Read-only empirical validation of the PlayStation ratings-curve
 * reconstruction (`ps-curve-reconstruction.ts`). It calls the SHIPPED pure
 * function, guardrails included, so the numbers describe what production
 * writes. Nothing is written to the DB.
 *
 * Protocol (hide the early points):
 *   For every game with >= 2 real PS_RATINGS days, each real day T that has a
 *   real day at least --min-gap-days later is a test point. Its value is
 *   predicted from ONE real anchor and the game's Steam-review curve, with two
 *   anchor strategies:
 *     - latest  : the game's latest real PS day (what production used until now)
 *     - nearest : the first real PS day at least --min-gap-days after T
 *                 (what "anchor on the earliest real point" does in production:
 *                 the anchor nearest to the stretch being reconstructed)
 *   Baselines: flat (= latest anchor value) and linear-since-PS-release.
 *
 * Breakdowns: by anchor gap, by test age since PS release (the launch window
 * is the part the reconstruction fills), signed bias, worst errors.
 *
 * Coverage: which games have a stretch between PS release and their first real
 * PS point, whether they already hold synthetic rows, and what each strategy
 * would write for them today.
 *
 * Error metric = |log10(pred / actual)| (0.30 ≈ 2x off, 0.10 ≈ 1.26x off).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/_tmp-validate-ps-reconstruction.ts \
 *     [--min-gap-days 60] [--out <path>]
 */

const MS_PER_DAY = 24 * 3600 * 1000;
// A first real PS point within this many days of the PS release counts as
// "observed from launch": nothing worth reconstructing before it.
const LAUNCH_COVERED_DAYS = 31;

interface CliOptions {
  minGapDays: number;
  outPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = get('--out');
  return {
    minGapDays: get('--min-gap-days') ? Number(get('--min-gap-days')) : 60,
    outPath: out
      ? resolve(process.cwd(), out)
      : resolve(__dirname, '../../../scripts/.validate-ps-reconstruction.json'),
  };
}

interface GameRow {
  gameId: string;
  name: string;
  psReleaseDate: Date | null;
  syntheticRows: number;
}

type Strategy = 'latest' | 'nearest';
const STRATEGIES: Strategy[] = ['latest', 'nearest'];

interface TestRow {
  gameId: string;
  name: string;
  testDay: string;
  testValue: number;
  ageDays: number | null; // test date minus PS release
  latestDay: string;
  latestGapDays: number;
  nearestDay: string;
  nearestGapDays: number;
  pred: Record<Strategy, number | null>;
  abstain: Record<Strategy, string | null>;
  predFlat: number;
  predRelease: number | null;
}

interface CoverageRow {
  gameId: string;
  name: string;
  psReleaseDay: string | null;
  firstRealDay: string;
  uncoveredDays: number | null;
  syntheticRows: number;
  wouldWrite: Record<Strategy, number>;
  abstainReason: Record<Strategy, string | null>;
  // Reconstructed value the day before the first real point vs that point:
  // the visible jump on the chart (1 = continuous).
  jumpRatio: Record<Strategy, number | null>;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('ValidatePsReconstruction');
  logger.log(`min-gap-days=${opts.minGapDays} out=${opts.outPath}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);

  try {
    const games = await loadGamesWithRealPs(dataSource);
    logger.log(`Games with real PS_RATINGS: ${games.length}`);

    const testRows: TestRow[] = [];
    const coverage: CoverageRow[] = [];

    for (const game of games) {
      const [psPoints, steamReviews] = await Promise.all([
        loadPsPoints(dataSource, game.gameId),
        loadSteamPoints(dataSource, game.gameId),
      ]);
      if (psPoints.length === 0) continue;
      const psRelease = game.psReleaseDate;
      const inputsFor = (anchor: DatedValue): PsReconstructionInputs => ({
        anchor,
        psReleaseDate: psRelease,
        steamReviews,
      });

      coverage.push(coverageFor(game, psPoints, steamReviews, inputsFor));

      const latest = psPoints[psPoints.length - 1];
      for (let i = 0; i < psPoints.length - 1; i++) {
        const test = psPoints[i];
        const nearest = psPoints
          .slice(i + 1)
          .find((p) => days(test.capturedAt, p.capturedAt) >= opts.minGapDays);
        if (!nearest) continue;

        const anchors: Record<Strategy, DatedValue> = { latest, nearest };
        const pred = {} as Record<Strategy, number | null>;
        const abstain = {} as Record<Strategy, string | null>;
        for (const s of STRATEGIES) {
          const out = reconstructPsRatingAt(
            test.capturedAt,
            inputsFor(anchors[s]),
          );
          pred[s] = out.value;
          abstain[s] = out.reason;
        }

        testRows.push({
          gameId: game.gameId,
          name: game.name,
          testDay: day(test.capturedAt),
          testValue: test.value,
          ageDays: psRelease ? days(psRelease, test.capturedAt) : null,
          latestDay: day(latest.capturedAt),
          latestGapDays: days(test.capturedAt, latest.capturedAt),
          nearestDay: day(nearest.capturedAt),
          nearestGapDays: days(test.capturedAt, nearest.capturedAt),
          pred,
          abstain,
          predFlat: latest.value,
          predRelease: releasePrediction(
            psRelease,
            test.capturedAt,
            latest.capturedAt,
            latest.value,
          ),
        });
      }
    }

    const report = buildReport(testRows, coverage);
    printReport(report, opts);
    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          opts: { minGapDays: opts.minGapDays },
          report,
          rows: testRows,
          coverage,
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

function coverageFor(
  game: GameRow,
  psPoints: DatedValue[],
  steamReviews: DatedValue[],
  inputsFor: (anchor: DatedValue) => PsReconstructionInputs,
): CoverageRow {
  const first = psPoints[0];
  const anchors: Record<Strategy, DatedValue> = {
    latest: psPoints[psPoints.length - 1],
    nearest: first, // production "earliest" anchor
  };
  const fromDate = game.psReleaseDate ?? steamReviews[0]?.capturedAt ?? null;
  const toDate = new Date(first.capturedAt.getTime() - MS_PER_DAY);

  const wouldWrite = { latest: 0, nearest: 0 };
  const abstainReason = { latest: null, nearest: null } as Record<
    Strategy,
    string | null
  >;
  const jumpRatio = { latest: null, nearest: null } as Record<
    Strategy,
    number | null
  >;
  for (const s of STRATEGIES) {
    if (!fromDate || fromDate.getTime() > toDate.getTime()) {
      abstainReason[s] = 'no-gap';
      continue;
    }
    const inputs = inputsFor(anchors[s]);
    const curve = reconstructPsCurveMonthly(fromDate, toDate, inputs);
    wouldWrite[s] = curve.length;
    if (curve.length === 0) {
      abstainReason[s] = reconstructPsRatingAt(toDate, inputs).reason;
    } else {
      const last = curve[curve.length - 1];
      jumpRatio[s] = first.value > 0 ? last.value / first.value : null;
    }
  }

  return {
    gameId: game.gameId,
    name: game.name,
    psReleaseDay: game.psReleaseDate ? day(game.psReleaseDate) : null,
    firstRealDay: day(first.capturedAt),
    uncoveredDays: game.psReleaseDate
      ? days(game.psReleaseDate, first.capturedAt)
      : null,
    syntheticRows: game.syntheticRows,
    wouldWrite,
    abstainReason,
    jumpRatio,
  };
}

// ───── data loading ──────────────────────────────────────────────────────

async function loadGamesWithRealPs(dataSource: DataSource): Promise<GameRow[]> {
  const rows = await dataSource.query<
    Array<{
      gameId: string;
      name: string;
      psReleaseDate: Date | string | null;
      syntheticRows: string;
    }>
  >(
    `SELECT g.id AS "gameId", g.name AS name,
            COALESCE(ps."releaseDate", g."releaseDate") AS "psReleaseDate",
            COALESCE(syn.n, 0) AS "syntheticRows"
       FROM game g
       JOIN (SELECT DISTINCT "gameId" FROM signal_snapshot
              WHERE metric = 'PS_RATINGS' AND synthetic = false) r
         ON r."gameId" = g.id
       LEFT JOIN game_platform_release_date ps
              ON ps."gameId" = g.id AND ps.platform = 'PLAYSTATION'
       LEFT JOIN (SELECT "gameId", COUNT(*) AS n FROM signal_snapshot
                   WHERE metric = 'PS_RATINGS' AND synthetic = true
                   GROUP BY "gameId") syn
              ON syn."gameId" = g.id
      WHERE g."deletedAt" IS NULL
      ORDER BY g.name ASC`,
  );
  return rows.map((r) => ({
    gameId: r.gameId,
    name: r.name,
    psReleaseDate: r.psReleaseDate ? new Date(r.psReleaseDate) : null,
    syntheticRows: Number(r.syntheticRows),
  }));
}

/** One real PS point per UTC day (max cumulative value that day), oldest first. */
async function loadPsPoints(
  dataSource: DataSource,
  gameId: string,
): Promise<DatedValue[]> {
  const rows = await dataSource.query<Array<{ day: string; value: string }>>(
    `SELECT to_char(date_trunc('day', "capturedAt"), 'YYYY-MM-DD') AS day,
            MAX(value) AS value
       FROM signal_snapshot
      WHERE "gameId" = $1 AND metric = 'PS_RATINGS' AND synthetic = false
      GROUP BY date_trunc('day', "capturedAt")
      ORDER BY date_trunc('day', "capturedAt") ASC`,
    [gameId],
  );
  return rows.map((r) => ({
    capturedAt: new Date(`${r.day}T00:00:00.000Z`),
    value: Number(r.value),
  }));
}

/** Real cumulative STEAM_REVIEWS curve, ascending (same input as production). */
async function loadSteamPoints(
  dataSource: DataSource,
  gameId: string,
): Promise<DatedValue[]> {
  const rows = await dataSource.query<
    Array<{ capturedAt: Date; value: string }>
  >(
    `SELECT "capturedAt", value
       FROM signal_snapshot
      WHERE "gameId" = $1 AND metric = 'STEAM_REVIEWS' AND synthetic = false
      ORDER BY "capturedAt" ASC`,
    [gameId],
  );
  return rows.map((r) => ({
    capturedAt: new Date(r.capturedAt),
    value: Number(r.value),
  }));
}

// ───── helpers ───────────────────────────────────────────────────────────

function releasePrediction(
  releaseDate: Date | null,
  testDate: Date,
  anchorDate: Date,
  anchorValue: number,
): number | null {
  if (!releaseDate) return null;
  const spanAnchor = anchorDate.getTime() - releaseDate.getTime();
  if (spanAnchor <= 0) return null;
  const spanTest = testDate.getTime() - releaseDate.getTime();
  return anchorValue * Math.min(1, Math.max(0, spanTest / spanAnchor));
}

/** Signed log10 error (positive = overestimate). */
function signedErr(pred: number | null, actual: number): number | null {
  if (pred === null || pred <= 0 || actual <= 0) return null;
  return Math.log10(pred / actual);
}

function days(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ───── report ────────────────────────────────────────────────────────────

interface Stats {
  n: number;
  games: number;
  medianX: number; // median |error| as a multiplicative factor
  p90X: number;
  within1_26x: number;
  within2x: number;
  medianBiasX: number; // median signed error as a factor (>1 = overestimates)
}

function stats(pairs: Array<{ gameId: string; err: number }>): Stats | null {
  if (pairs.length === 0) return null;
  const abs = pairs.map((p) => Math.abs(p.err)).sort((a, b) => a - b);
  const signed = pairs.map((p) => p.err).sort((a, b) => a - b);
  const q = (xs: number[], f: number) =>
    xs[Math.min(xs.length - 1, Math.floor(xs.length * f))];
  return {
    n: pairs.length,
    games: new Set(pairs.map((p) => p.gameId)).size,
    medianX: 10 ** q(abs, 0.5),
    p90X: 10 ** q(abs, 0.9),
    within1_26x: abs.filter((e) => e <= 0.1).length / abs.length,
    within2x: abs.filter((e) => e <= 0.3).length / abs.length,
    medianBiasX: 10 ** q(signed, 0.5),
  };
}

type MethodKey = Strategy | 'flat' | 'linear-release';
const METHODS: MethodKey[] = ['latest', 'nearest', 'flat', 'linear-release'];

function errFor(r: TestRow, m: MethodKey): number | null {
  if (m === 'flat') return signedErr(r.predFlat, r.testValue);
  if (m === 'linear-release') return signedErr(r.predRelease, r.testValue);
  return signedErr(r.pred[m], r.testValue);
}

/**
 * Every method is scored on the SAME rows: those where both shape strategies
 * produced a value (neither tripped a guardrail), so differences come from
 * the method, not from which rows it chose to answer.
 */
function methodTable(rows: TestRow[]): Record<MethodKey, Stats | null> {
  const common = rows.filter(
    (r) => r.pred.latest !== null && r.pred.nearest !== null,
  );
  const out = {} as Record<MethodKey, Stats | null>;
  for (const m of METHODS) {
    out[m] = stats(
      common.flatMap((r) => {
        const err = errFor(r, m);
        return err === null ? [] : [{ gameId: r.gameId, err }];
      }),
    );
  }
  return out;
}

const AGE_BINS: Array<[string, number, number]> = [
  ['0-30d', 0, 31],
  ['31-90d', 31, 91],
  ['91-365d', 91, 366],
  ['1-2y', 366, 731],
  ['>2y', 731, Infinity],
];
const GAP_BINS: Array<[string, number, number]> = [
  ['60-180d', 0, 181],
  ['181-365d', 181, 366],
  ['1-2y', 366, 731],
  ['>2y', 731, Infinity],
];

function buildReport(rows: TestRow[], coverage: CoverageRow[]) {
  const byAge: Record<string, Record<MethodKey, Stats | null>> = {};
  for (const [label, lo, hi] of AGE_BINS) {
    byAge[label] = methodTable(
      rows.filter(
        (r) => r.ageDays !== null && r.ageDays >= lo && r.ageDays < hi,
      ),
    );
  }
  const byGap: Record<string, Stats | null> = {};
  for (const [label, lo, hi] of GAP_BINS) {
    byGap[label] = stats(
      rows.flatMap((r) => {
        if (r.latestGapDays < lo || r.latestGapDays >= hi) return [];
        const err = signedErr(r.pred.latest, r.testValue);
        return err === null ? [] : [{ gameId: r.gameId, err }];
      }),
    );
  }

  const abstained: Record<Strategy, Record<string, number>> = {
    latest: {},
    nearest: {},
  };
  for (const r of rows) {
    for (const s of STRATEGIES) {
      const reason = r.abstain[s];
      if (reason) abstained[s][reason] = (abstained[s][reason] ?? 0) + 1;
    }
  }

  const withGap = coverage.filter(
    (c) => c.uncoveredDays === null || c.uncoveredDays > LAUNCH_COVERED_DAYS,
  );
  const jumps = (s: Strategy) =>
    withGap
      .map((c) => c.jumpRatio[s])
      .filter((x): x is number => x !== null)
      .map((x) => Math.abs(Math.log10(x)))
      .sort((a, b) => a - b);
  const medianJump = (s: Strategy) => {
    const j = jumps(s);
    return j.length ? 10 ** j[Math.floor(j.length / 2)] : null;
  };

  return {
    testRows: rows.length,
    testGames: new Set(rows.map((r) => r.gameId)).size,
    overall: methodTable(rows),
    byAgeSincePsRelease: byAge,
    latestAnchorByGap: byGap,
    abstained,
    coverage: {
      gamesWithRealPs: coverage.length,
      coveredFromLaunch: coverage.length - withGap.length,
      withUncoveredLaunch: withGap.length,
      withUncoveredLaunchAndSynthetic: withGap.filter(
        (c) => c.syntheticRows > 0,
      ).length,
      withUncoveredLaunchNoSynthetic: withGap.filter(
        (c) => c.syntheticRows === 0,
      ).length,
      wouldGetCurve: {
        latest: withGap.filter((c) => c.wouldWrite.latest > 0).length,
        nearest: withGap.filter((c) => c.wouldWrite.nearest > 0).length,
      },
      pointsWouldWrite: {
        latest: withGap.reduce((a, c) => a + c.wouldWrite.latest, 0),
        nearest: withGap.reduce((a, c) => a + c.wouldWrite.nearest, 0),
      },
      medianJumpAtFirstRealPoint: {
        latest: medianJump('latest'),
        nearest: medianJump('nearest'),
      },
      abstainReasons: {
        latest: countBy(withGap, (c) => c.abstainReason.latest),
        nearest: countBy(withGap, (c) => c.abstainReason.nearest),
      },
    },
    worstNearest: rows
      .filter((r) => r.pred.nearest !== null)
      .map((r) => ({
        name: r.name,
        testDay: r.testDay,
        anchorDay: r.nearestDay,
        actual: r.testValue,
        pred: Math.round(r.pred.nearest!),
        factor: Number(
          (10 ** Math.abs(signedErr(r.pred.nearest, r.testValue)!)).toFixed(2),
        ),
      }))
      .sort((a, b) => b.factor - a.factor)
      .slice(0, 25),
  };
}

function countBy<T>(xs: T[], key: (x: T) => string | null) {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function printReport(
  report: ReturnType<typeof buildReport>,
  opts: CliOptions,
): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const fx = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v) ? 'n/a' : `x${v.toFixed(2)}`;
  const pct = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v) ? 'n/a' : `${Math.round(v * 100)}%`;
  const header = () =>
    console.log(
      `  ${pad('method', 16)}${pad('N', 6)}${pad('games', 7)}${pad('median', 9)}${pad('p90', 9)}${pad('<=1.26x', 9)}${pad('<=2x', 7)}bias`,
    );
  const line = (label: string, s: Stats | null) =>
    console.log(
      s
        ? `  ${pad(label, 16)}${pad(String(s.n), 6)}${pad(String(s.games), 7)}${pad(fx(s.medianX), 9)}${pad(fx(s.p90X), 9)}${pad(pct(s.within1_26x), 9)}${pad(pct(s.within2x), 7)}${fx(s.medianBiasX)}`
        : `  ${pad(label, 16)}no rows`,
    );
  const table = (title: string, t: Record<MethodKey, Stats | null>) => {
    console.log(`\n${title}`);
    header();
    for (const m of METHODS) line(m, t[m]);
  };

  console.log(
    `\nmin gap ${opts.minGapDays}d — ${report.testRows} test points across ${report.testGames} games`,
  );
  table('ALL (rows where both shape strategies answer)', report.overall);
  for (const [label, t] of Object.entries(report.byAgeSincePsRelease)) {
    table(`TEST AGE SINCE PS RELEASE ${label}`, t);
  }
  console.log('\nLATEST anchor, by gap test→anchor');
  header();
  for (const [label, s] of Object.entries(report.latestAnchorByGap)) {
    line(label, s);
  }
  console.log('\nAbstentions on test rows:', JSON.stringify(report.abstained));
  console.log('\nCOVERAGE');
  console.log(JSON.stringify(report.coverage, null, 2));
  console.log('\nWorst errors, nearest anchor:');
  for (const w of report.worstNearest) {
    console.log(
      `  ${pad(w.name.slice(0, 32), 34)}${w.testDay}→${w.anchorDay}  actual ${w.actual}  pred ${w.pred}  x${w.factor}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

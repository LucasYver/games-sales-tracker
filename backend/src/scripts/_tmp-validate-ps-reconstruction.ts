import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

/**
 * Read-only empirical validation of the "PS rating curve reconstruction"
 * idea: can we rebuild a PlayStation ratings-over-time curve from a single
 * recent anchor plus the SAME game's dense Steam-review cumulative curve
 * (used purely as a temporal SHAPE prior)?
 *
 * Protocol (leave-the-early-points-out):
 *   For every game with >= 2 real PS_RATINGS days:
 *     - anchor  = latest real PS day (value + date)   ← the only PS input we allow
 *     - test(s) = every earlier real PS day at least --min-gap-days before anchor
 *   Reconstruct the PS count at each test date t as:
 *       predShape(t) = anchorValue * steamRev(t) / steamRev(anchorDate)
 *   and compare to the real PS value at t.
 *
 * Baselines for context:
 *   - flat    : predFlat(t) = anchorValue         (no shape at all)
 *   - release : predRel(t)  = anchorValue * (t - release)/(anchorDate - release)
 *               clamped to [0,1] (naive linear-since-release accumulation)
 *
 * Error metric = |log10(pred / actual)| (0.30 ≈ 2x off, 0.10 ≈ 1.26x off).
 * Nothing is written to the DB. Read-only.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/_tmp-validate-ps-reconstruction.ts \
 *     [--min-gap-days 60] [--out <path>]
 */

interface CliOptions {
  minGapDays: number;
  steamFloor: number;
  outPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    minGapDays: get('--min-gap-days') ? Number(get('--min-gap-days')) : 60,
    // Below this many Steam reviews at the anchor the game has a negligible
    // Steam footprint (console-first titles like CoD Vanguard): the Steam
    // shape is meaningless and the guarded method abstains.
    steamFloor: get('--steam-floor') ? Number(get('--steam-floor')) : 500,
    outPath: get('--out')
      ? resolve(process.cwd(), get('--out')!)
      : resolve(__dirname, '../../../scripts/.validate-ps-reconstruction.json'),
  };
}

interface PsPoint {
  day: string; // YYYY-MM-DD (UTC)
  date: Date;
  value: number;
}

interface GameRow {
  gameId: string;
  name: string;
  releaseDate: Date | null;
  psReleaseDate: Date | null;
  pcReleaseDate: Date | null;
}

interface TestRow {
  gameId: string;
  name: string;
  anchorDay: string;
  anchorValue: number;
  testDay: string;
  testValue: number;
  gapDays: number;
  steamAtTest: number | null;
  steamAtAnchor: number | null;
  predShape: number | null;
  predShapeAligned: number | null;
  predFlat: number;
  predRelease: number | null;
  logErrShape: number | null;
  logErrShapeAligned: number | null;
  logErrFlat: number;
  logErrRelease: number | null;
  // Guardrail flags (prod would abstain / fall back to genre shape).
  preRelease: boolean; // test date before PS launch
  negligibleSteam: boolean; // Steam footprint too small at anchor
  desynced: boolean; // PS vs PC launch differ > 60d (alignment matters)
  steamLagDays: number | null; // first Steam review minus PS release (late-to-Steam)
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
    const games = await loadGamesWithPsHistory(dataSource);
    logger.log(`Games with >= 2 real PS_RATINGS days: ${games.length}`);

    const testRows: TestRow[] = [];
    for (const game of games) {
      const psPoints = await loadPsPoints(dataSource, game.gameId);
      if (psPoints.length < 2) continue;

      const psRelease = game.psReleaseDate ?? game.releaseDate;
      const pcRelease = game.pcReleaseDate ?? game.releaseDate;
      const desynced =
        psRelease !== null &&
        pcRelease !== null &&
        daysBetween(psRelease, pcRelease) > 60;

      const steamPoints = await loadSteamPoints(dataSource, game.gameId);
      // Production anchors the Steam-shape timeline on the FIRST Steam review,
      // not the IGDB PC release. Mirror that here so the validation reflects the
      // shipped algorithm.
      const firstSteam = steamPoints.length > 0 ? steamPoints[0].date : null;
      const steamTimelineStart = firstSteam ?? pcRelease;
      const steamLagDays =
        firstSteam !== null && psRelease !== null
          ? daysBetween(psRelease, firstSteam)
          : null;

      const anchor = psPoints[psPoints.length - 1];
      const steamAtAnchor = steamAt(steamPoints, anchor.date);
      // Aligned anchor: Steam reviews at the date equivalent to the anchor's
      // PS-elapsed time (steamTimelineStart + (anchorDate - psRelease)).
      const steamAtAnchorAligned = steamAt(
        steamPoints,
        mapToPcTimeline(anchor.date, psRelease, steamTimelineStart),
      );

      for (const test of psPoints.slice(0, -1)) {
        const gapDays = daysBetween(test.date, anchor.date);
        if (gapDays < opts.minGapDays) continue;

        const steamAtTest = steamAt(steamPoints, test.date);
        const steamAtTestAligned = steamAt(
          steamPoints,
          mapToPcTimeline(test.date, psRelease, steamTimelineStart),
        );

        const predShape =
          steamAtTest !== null && steamAtAnchor !== null && steamAtAnchor > 0
            ? anchor.value * (steamAtTest / steamAtAnchor)
            : null;

        const predShapeAligned =
          steamAtTestAligned !== null &&
          steamAtAnchorAligned !== null &&
          steamAtAnchorAligned > 0
            ? anchor.value * (steamAtTestAligned / steamAtAnchorAligned)
            : null;

        const predFlat = anchor.value;
        const predRelease = releasePrediction(
          psRelease,
          test.date,
          anchor.date,
          anchor.value,
        );

        const preRelease = psRelease !== null && test.date < psRelease;
        const negligibleSteam =
          steamAtAnchorAligned === null ||
          steamAtAnchorAligned < opts.steamFloor;

        testRows.push({
          gameId: game.gameId,
          name: game.name,
          anchorDay: anchor.day,
          anchorValue: anchor.value,
          testDay: test.day,
          testValue: test.value,
          gapDays,
          steamAtTest,
          steamAtAnchor,
          predShape,
          predShapeAligned,
          predFlat,
          predRelease,
          logErrShape: logErr(predShape, test.value),
          logErrShapeAligned: logErr(predShapeAligned, test.value),
          logErrFlat: logErr(predFlat, test.value)!,
          logErrRelease: logErr(predRelease, test.value),
          preRelease,
          negligibleSteam,
          desynced,
          steamLagDays,
        });
      }
    }

    const report = summarise(testRows);
    printReport(testRows, report, opts);
    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          opts,
          summary: report,
          rows: testRows,
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

/**
 * Games that have PS_RATINGS snapshots on at least two distinct UTC days.
 * De-duping to distinct days avoids counting multiple same-day live polls
 * as "history".
 */
async function loadGamesWithPsHistory(
  dataSource: DataSource,
): Promise<GameRow[]> {
  return dataSource.query<GameRow[]>(
    `SELECT g.id AS "gameId", g.name AS name, g."releaseDate" AS "releaseDate",
            ps."releaseDate" AS "psReleaseDate",
            pc."releaseDate" AS "pcReleaseDate"
       FROM game g
       JOIN (
         SELECT "gameId", COUNT(DISTINCT date_trunc('day', "capturedAt")) AS days
           FROM signal_snapshot
          WHERE metric = 'PS_RATINGS' AND synthetic = false
          GROUP BY "gameId"
         HAVING COUNT(DISTINCT date_trunc('day', "capturedAt")) >= 2
       ) h ON h."gameId" = g.id
       LEFT JOIN game_platform_release_date ps
              ON ps."gameId" = g.id AND ps.platform = 'PLAYSTATION'
       LEFT JOIN game_platform_release_date pc
              ON pc."gameId" = g.id AND pc.platform = 'PC'
      WHERE g."deletedAt" IS NULL
      ORDER BY g.name ASC`,
  );
}

/**
 * Map a date on the PS timeline to the equivalent date on the PC timeline by
 * preserving elapsed-time-since-launch: pcRelease + (date - psRelease). When
 * either per-platform date is missing (or they coincide) this is the identity.
 */
function mapToPcTimeline(
  date: Date,
  psRelease: Date | null,
  pcRelease: Date | null,
): Date {
  if (!psRelease || !pcRelease) return date;
  const elapsed = date.getTime() - psRelease.getTime();
  return new Date(pcRelease.getTime() + elapsed);
}

/**
 * One PS point per UTC day (max cumulative value that day), oldest first.
 */
async function loadPsPoints(
  dataSource: DataSource,
  gameId: string,
): Promise<PsPoint[]> {
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
    day: r.day,
    date: new Date(`${r.day}T00:00:00.000Z`),
    value: Number(r.value),
  }));
}

interface SteamPoint {
  date: Date;
  value: number;
}

// Load a game's full cumulative STEAM_REVIEWS curve in one query, then resolve
// lookups in memory. Avoids a network round-trip per test point (the previous
// per-lookup queries made the run take tens of minutes) and mirrors the prod
// pure function, which receives the whole steamReviews array.
async function loadSteamPoints(
  dataSource: DataSource,
  gameId: string,
): Promise<SteamPoint[]> {
  const rows = await dataSource.query<Array<{ capturedAt: Date; value: string }>>(
    `SELECT "capturedAt", value
       FROM signal_snapshot
      WHERE "gameId" = $1 AND metric = 'STEAM_REVIEWS' AND synthetic = false
      ORDER BY "capturedAt" ASC`,
    [gameId],
  );
  return rows.map((r) => ({
    date: new Date(r.capturedAt),
    value: Number(r.value),
  }));
}

// Latest cumulative Steam review count at/at-before `cutoff` (null if before the
// first review). `points` must be ascending by date.
function steamAt(points: SteamPoint[], cutoff: Date): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.date.getTime() <= cutoff.getTime()) found = p.value;
    else break;
  }
  return found;
}

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
  const frac = Math.min(1, Math.max(0, spanTest / spanAnchor));
  return anchorValue * frac;
}

function logErr(pred: number | null, actual: number): number | null {
  if (pred === null || pred <= 0 || actual <= 0) return null;
  return Math.abs(Math.log10(pred / actual));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (24 * 3600 * 1000));
}

interface MethodStats {
  method: string;
  n: number;
  medianAbsLogErr: number;
  meanAbsLogErr: number;
  within1_26x: number; // fraction with |logErr| <= 0.10
  within2x: number; // fraction with |logErr| <= 0.30
}

function summarise(rows: TestRow[]): MethodStats[] {
  const methods: Array<{ key: keyof TestRow; label: string }> = [
    { key: 'logErrShape', label: 'shape (raw)' },
    { key: 'logErrShapeAligned', label: 'shape (aligned)' },
    { key: 'logErrFlat', label: 'flat (anchor)' },
    { key: 'logErrRelease', label: 'linear-release' },
  ];
  return methods.map(({ key, label }) => {
    const errs = rows
      .map((r) => r[key] as number | null)
      .filter((e): e is number => e !== null && Number.isFinite(e))
      .sort((a, b) => a - b);
    if (errs.length === 0) {
      return {
        method: label,
        n: 0,
        medianAbsLogErr: NaN,
        meanAbsLogErr: NaN,
        within1_26x: NaN,
        within2x: NaN,
      };
    }
    return {
      method: label,
      n: errs.length,
      medianAbsLogErr: errs[Math.floor(errs.length / 2)],
      meanAbsLogErr: errs.reduce((a, b) => a + b, 0) / errs.length,
      within1_26x: errs.filter((e) => e <= 0.1).length / errs.length,
      within2x: errs.filter((e) => e <= 0.3).length / errs.length,
    };
  });
}

function printReport(
  rows: TestRow[],
  stats: MethodStats[],
  opts: CliOptions,
): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number, w = 8) =>
    Number.isFinite(v) ? v.toFixed(3).padStart(w) : 'n/a'.padStart(w);

  const table = (label: string, subset: TestRow[]): void => {
    const games = new Set(subset.map((r) => r.gameId)).size;
    const s = summarise(subset);
    console.log('');
    console.log(`${label}: ${subset.length} rows across ${games} game(s)`);
    console.log(
      `${pad('method', 16)} ${pad('N', 5)} ${pad('median|log|', 12)} ${pad('mean|log|', 12)} ${pad('<=1.26x', 9)} ${pad('<=2x', 8)}`,
    );
    console.log('-'.repeat(16 + 1 + 5 + 1 + 12 + 1 + 12 + 1 + 9 + 1 + 8));
    for (const m of s) {
      console.log(
        `${pad(m.method, 16)} ${pad(String(m.n), 5)} ${num(m.medianAbsLogErr, 12)} ${num(m.meanAbsLogErr, 12)} ${num(m.within1_26x, 9)} ${num(m.within2x, 8)}`,
      );
    }
  };

  void stats;
  console.log('');
  console.log(`min gap ${opts.minGapDays}d, steam floor ${opts.steamFloor}`);

  const guarded = rows.filter((r) => !r.preRelease && !r.negligibleSteam);
  const excluded = rows.length - guarded.length;

  table('ALL rows (no guardrails)', rows);
  table(
    `GUARDED rows (drop pre-release + negligible-Steam; ${excluded} excluded)`,
    guarded,
  );
  table(
    'DESYNCED subset (PS↔PC launch > 60d apart)',
    guarded.filter((r) => r.desynced),
  );

  console.log('');
  console.log('Worst aligned errors among GUARDED rows:');
  console.log(
    `${pad('game', 30)} ${pad('test→anchor', 24)} ${pad('gap', 5)} ${pad('actual', 8)} ${pad('predAlign', 10)} ${pad('|log|', 7)} ${pad('desync', 6)}`,
  );
  const detail = guarded
    .filter((r) => r.logErrShapeAligned !== null)
    .sort((a, b) => (b.logErrShapeAligned ?? 0) - (a.logErrShapeAligned ?? 0))
    .slice(0, 25);
  for (const r of detail) {
    console.log(
      `${pad(r.name.slice(0, 29), 30)} ${pad(`${r.testDay}→${r.anchorDay}`, 24)} ${pad(String(r.gapDays), 5)} ${pad(String(r.testValue), 8)} ${pad(r.predShapeAligned !== null ? r.predShapeAligned.toFixed(0) : 'n/a', 10)} ${num(r.logErrShapeAligned ?? NaN, 7)} ${pad(r.desynced ? 'yes' : 'no', 6)}`,
    );
  }
  console.log('');
  console.log(
    'Interpretation: |log|=0.30 ≈ 2x off, 0.10 ≈ 1.26x off. "aligned" maps PS-elapsed time onto the PC (Steam) timeline before taking the shape ratio.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

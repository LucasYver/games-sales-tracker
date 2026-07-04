import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

/**
 * PROTOTYPE — home-grown weekly "rank" of our own game universe, built from
 * OBSERVED units-proxies (never the model's estimated units — that's circular).
 *
 * We compute TWO leaderboards side by side so we can judge whether blending
 * helps:
 *   - reviews-only : rank by weekly review velocity (Δ cumulative STEAM_REVIEWS)
 *   - blended      : per week, rank EACH available signal (reviews velocity,
 *                    CCU level, followers velocity) into a percentile, then
 *                    average the available percentiles per game and re-rank.
 *
 * Blending is done in percentile space (not raw values) so heterogeneous units
 * combine cleanly and missing signals degrade gracefully. NOTE: pre-2024 CCU is
 * monthly-only and followers are absent, so the blend collapses toward
 * reviews-only there — the report prints avg signals/week-game so you can see
 * exactly where the extra signals actually contribute.
 *
 * Read-only: queries signal_snapshot + game, prints a comparison report, dumps
 * full per-game aggregates to --out. Nothing is written to the DB.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/compute-homegrown-rank.ts \
 *     [--top-n 50] [--min-week-games 5] [--out <path>]
 */

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;

interface CliOptions {
  topN: number;
  minWeekGames: number;
  outPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    topN: get('--top-n') ? Number(get('--top-n')) : 50,
    minWeekGames: get('--min-week-games') ? Number(get('--min-week-games')) : 5,
    outPath: get('--out')
      ? resolve(process.cwd(), get('--out')!)
      : resolve(__dirname, '../../../scripts/.homegrown-rank.json'),
  };
}

interface Point {
  t: number; // capturedAt epoch ms
  v: number; // metric value
}

interface GameMeta {
  id: string;
  name: string;
  year: number | null;
}

type Mode = 'velocity' | 'level';

// Cumulative/last value at time t via binary search (largest row with t' <= t).
function valueAt(rows: Point[], t: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans < 0 ? 0 : rows[ans].v;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

async function loadMetric(
  dataSource: DataSource,
  metric: string,
): Promise<Map<string, Point[]>> {
  const rows: Array<{ gameId: string; capturedAt: Date; value: number }> =
    await dataSource.query(
      `SELECT s."gameId" AS "gameId", s."capturedAt" AS "capturedAt", s.value AS value
         FROM signal_snapshot s
         JOIN game g ON g.id = s."gameId"
         JOIN game_source gs
           ON gs."gameId" = g.id AND gs.source = 'STEAM'
        WHERE s.metric = $1
          AND g."isFree" = false AND g."deletedAt" IS NULL
        ORDER BY s."gameId" ASC, s."capturedAt" ASC`,
      [metric],
    );
  const byGame = new Map<string, Point[]>();
  for (const r of rows) {
    const t = new Date(r.capturedAt).getTime();
    const v = Number(r.value);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    let arr = byGame.get(r.gameId);
    if (!arr) byGame.set(r.gameId, (arr = []));
    arr.push({ t, v });
  }
  return byGame;
}

// One (gameId, value) per week for a signal. velocity = Δ over the week (kept
// only when >0); level = last-known value as of week end (kept when >0).
function buildWeekVals(
  byGame: Map<string, Point[]>,
  mode: Mode,
): Map<number, Array<{ g: string; val: number }>> {
  const wm = new Map<number, Array<{ g: string; val: number }>>();
  const minRows = mode === 'velocity' ? 2 : 1;
  for (const [g, rows] of byGame) {
    if (rows.length < minRows) continue;
    const firstWeek = Math.floor(rows[0].t / WEEK_MS);
    const lastWeek = Math.floor(rows[rows.length - 1].t / WEEK_MS);
    for (let w = firstWeek; w <= lastWeek; w++) {
      let val: number;
      if (mode === 'velocity') {
        val = valueAt(rows, (w + 1) * WEEK_MS) - valueAt(rows, w * WEEK_MS);
      } else {
        val = valueAt(rows, (w + 1) * WEEK_MS);
      }
      if (val <= 0) continue;
      let list = wm.get(w);
      if (!list) wm.set(w, (list = []));
      list.push({ g, val });
    }
  }
  return wm;
}

// Per-week percentile (rank/n, lower = better) for each game on one signal.
function percentiles(
  weekVals: Map<number, Array<{ g: string; val: number }>>,
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const [w, list] of weekVals) {
    list.sort((a, b) => b.val - a.val || (a.g < b.g ? -1 : 1));
    const n = list.length;
    const mp = new Map<string, number>();
    for (let i = 0; i < n; i++) mp.set(list[i].g, (i + 1) / n);
    out.set(w, mp);
  }
  return out;
}

interface Positions {
  ranks: number[];
  pcts: number[];
}

// Reviews-only positions, ranking straight off the review-velocity weekVals.
function positionsFromWeekVals(
  weekVals: Map<number, Array<{ g: string; val: number }>>,
  minWeekGames: number,
): Map<string, Positions> {
  const pos = new Map<string, Positions>();
  for (const [, list] of weekVals) {
    if (list.length < minWeekGames) continue;
    list.sort((a, b) => b.val - a.val || (a.g < b.g ? -1 : 1));
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const g = list[i].g;
      let a = pos.get(g);
      if (!a) pos.set(g, (a = { ranks: [], pcts: [] }));
      a.ranks.push(i + 1);
      a.pcts.push((i + 1) / n);
    }
  }
  return pos;
}

interface GameAgg {
  id: string;
  name: string;
  year: number | null;
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  medianRank: number;
  peakPercentile: number;
  avgPercentile: number;
  weeksInTop10: number;
  weeksInTopN: number;
}

function aggregate(
  positions: Map<string, Positions>,
  meta: Map<string, GameMeta>,
  topN: number,
): Map<string, GameAgg> {
  const out = new Map<string, GameAgg>();
  for (const [gameId, { ranks, pcts }] of positions) {
    const m = meta.get(gameId);
    if (!m) continue;
    const sortedRanks = [...ranks].sort((a, b) => a - b);
    out.set(gameId, {
      id: gameId,
      name: m.name,
      year: m.year,
      weeksCharted: ranks.length,
      peakRank: Math.min(...ranks),
      avgRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
      medianRank: median(sortedRanks),
      peakPercentile: Math.min(...pcts),
      avgPercentile: pcts.reduce((a, b) => a + b, 0) / pcts.length,
      weeksInTop10: ranks.filter((r) => r <= 10).length,
      weeksInTopN: ranks.filter((r) => r <= topN).length,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('HomegrownRank');
  logger.log(
    `top-n=${opts.topN} min-week-games=${opts.minWeekGames} out=${opts.outPath}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);

  try {
    const gameRows: Array<{ id: string; name: string; yr: string | null }> =
      await dataSource.query(
        `SELECT g.id AS id, g.name AS name,
                EXTRACT(YEAR FROM g."releaseDate")::text AS yr
           FROM game g
           JOIN game_source gs
             ON gs."gameId" = g.id AND gs.source = 'STEAM'
          WHERE g."isFree" = false AND g."deletedAt" IS NULL`,
      );
    const meta = new Map<string, GameMeta>();
    for (const g of gameRows) {
      meta.set(g.id, { id: g.id, name: g.name, year: g.yr ? Number(g.yr) : null });
    }
    logger.log(`Universe: ${meta.size} tracked Steam game(s).`);

    const reviews = await loadMetric(dataSource, 'STEAM_REVIEWS');
    const ccu = await loadMetric(dataSource, 'STEAM_CONCURRENT');
    const followers = await loadMetric(dataSource, 'STEAM_FOLLOWERS');
    logger.log(
      `Signals loaded — reviews: ${reviews.size} games, ` +
        `ccu: ${ccu.size}, followers: ${followers.size}.`,
    );

    // Per-signal weekly values.
    const reviewsWV = buildWeekVals(reviews, 'velocity');
    const ccuWV = buildWeekVals(ccu, 'level');
    const followersWV = buildWeekVals(followers, 'velocity');

    // Reviews-only leaderboard (baseline).
    const reviewsPos = positionsFromWeekVals(reviewsWV, opts.minWeekGames);
    const reviewsAgg = aggregate(reviewsPos, meta, opts.topN);

    // Per-signal percentiles for blending.
    const reviewsPct = percentiles(reviewsWV);
    const ccuPct = percentiles(ccuWV);
    const followersPct = percentiles(followersWV);

    // Blended leaderboard: per week, average available percentiles, re-rank.
    const allWeeks = new Set<number>([
      ...reviewsPct.keys(),
      ...ccuPct.keys(),
      ...followersPct.keys(),
    ]);
    const blendPos = new Map<string, Positions>();
    let signalSum = 0;
    let signalCount = 0;
    for (const w of allWeeks) {
      const rp = reviewsPct.get(w);
      const cp = ccuPct.get(w);
      const fp = followersPct.get(w);
      const games = new Set<string>([
        ...(rp?.keys() ?? []),
        ...(cp?.keys() ?? []),
        ...(fp?.keys() ?? []),
      ]);
      const scored: Array<{ g: string; score: number }> = [];
      for (const g of games) {
        const vals: number[] = [];
        const a = rp?.get(g);
        if (a != null) vals.push(a);
        const b = cp?.get(g);
        if (b != null) vals.push(b);
        const c = fp?.get(g);
        if (c != null) vals.push(c);
        if (vals.length === 0) continue;
        scored.push({ g, score: vals.reduce((x, y) => x + y, 0) / vals.length });
        signalSum += vals.length;
        signalCount += 1;
      }
      if (scored.length < opts.minWeekGames) continue;
      scored.sort((x, y) => x.score - y.score || (x.g < y.g ? -1 : 1));
      const n = scored.length;
      for (let i = 0; i < n; i++) {
        const g = scored[i].g;
        let acc = blendPos.get(g);
        if (!acc) blendPos.set(g, (acc = { ranks: [], pcts: [] }));
        acc.ranks.push(i + 1);
        acc.pcts.push((i + 1) / n);
      }
    }
    const blendAgg = aggregate(blendPos, meta, opts.topN);

    const avgSignals = signalCount ? signalSum / signalCount : 0;
    logger.log(
      `Reviews-only: ${reviewsAgg.size} charted games. ` +
        `Blended: ${blendAgg.size} charted games. ` +
        `Avg signals per (week,game) = ${avgSignals.toFixed(2)}.`,
    );

    // ---- Comparison report ------------------------------------------------
    const num = (v: number, w = 7, d = 1) =>
      (Number.isFinite(v) ? v.toFixed(d) : 'n/a').padStart(w);
    const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

    const printCompare = (title: string, ids: string[]) => {
      console.log(`\n${title}`);
      console.log(
        `${pad('game', 32)} ${pad('yr', 4)} | ` +
          `${pad('R:wks', 6)} ${pad('R:peak', 6)} ${pad('R:avg', 7)} | ` +
          `${pad('B:wks', 6)} ${pad('B:peak', 6)} ${pad('B:avg', 7)} ${pad('B:top' + opts.topN, 7)}`,
      );
      console.log('-'.repeat(100));
      for (const id of ids) {
        const r = reviewsAgg.get(id);
        const b = blendAgg.get(id);
        const m = meta.get(id);
        if (!m) continue;
        console.log(
          `${pad(m.name, 32)} ${pad(String(m.year ?? '?'), 4)} | ` +
            `${String(r?.weeksCharted ?? 0).padStart(6)} ${String(r?.peakRank ?? '-').padStart(6)} ${num(r?.avgRank ?? NaN, 7)} | ` +
            `${String(b?.weeksCharted ?? 0).padStart(6)} ${String(b?.peakRank ?? '-').padStart(6)} ${num(b?.avgRank ?? NaN, 7)} ${String(b?.weeksInTopN ?? 0).padStart(7)}`,
        );
      }
    };

    // Biggest hits per the blended rank (best peak, then most weeks in top-N).
    const byPeakBlend = [...blendAgg.values()].sort(
      (a, b) => a.peakRank - b.peakRank || b.weeksInTopN - a.weeksInTopN,
    );
    printCompare('Top 25 by BLENDED peak rank (R = reviews-only, B = blended):', byPeakBlend.slice(0, 25).map((a) => a.id));

    const spotlightNames = [
      'hades',
      'elden ring',
      'baldur',
      'cyberpunk',
      'stardew',
      'hollow knight',
      'terraria',
      'vampire survivors',
      'palworld',
      'counter-strike',
      'dota',
    ];
    const spotlightIds = [...meta.values()]
      .filter((m) => spotlightNames.some((n) => m.name.toLowerCase().includes(n)))
      .map((m) => m.id);
    if (spotlightIds.length) {
      printCompare('Spotlight (known titles):', spotlightIds);
    }

    // How much does blending move things? Rank-change distribution on games
    // charted by both, by peak rank.
    const both = [...blendAgg.keys()].filter((id) => reviewsAgg.has(id));
    const peakDeltas = both
      .map((id) => Math.abs(blendAgg.get(id)!.peakRank - reviewsAgg.get(id)!.peakRank))
      .sort((a, b) => a - b);
    console.log(
      `\nBlend vs reviews-only peak-rank |Δ| over ${both.length} shared games: ` +
        `median ${median(peakDeltas).toFixed(1)}, ` +
        `mean ${(peakDeltas.reduce((a, b) => a + b, 0) / (peakDeltas.length || 1)).toFixed(1)}.`,
    );
    console.log(
      `Coverage: ${ccu.size} games have any CCU, ${followers.size} have any followers ` +
        `(of ${meta.size}). Avg signals/(week,game) = ${avgSignals.toFixed(2)} ` +
        `(1.0 = reviews only; >1 means extra signals contributed).`,
    );

    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          opts,
          universe: meta.size,
          coverage: { ccu: ccu.size, followers: followers.size },
          avgSignalsPerWeekGame: avgSignals,
          reviewsOnly: [...reviewsAgg.values()].sort(
            (a, b) => a.peakRank - b.peakRank,
          ),
          blended: byPeakBlend,
        },
        null,
        2,
      ),
    );
    logger.log(`Wrote full aggregates to ${opts.outPath}`);
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

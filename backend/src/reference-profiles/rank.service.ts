import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameRank } from '../entities';

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;
// A week is only ranked when at least this many games moved (charted) in it, so
// tiny early weeks don't produce meaningless #1s.
const MIN_WEEK_GAMES = 5;
// Sustain threshold: weeks spent in the best 10% of that week's participants.
const TOP_DECILE = 0.1;

interface Point {
  t: number; // capturedAt epoch ms
  v: number; // cumulative reviews
}

interface Positions {
  ranks: number[];
  pcts: number[];
}

/**
 * Builds the home-grown weekly rank of our own tracked-game universe from
 * review velocity (an OBSERVED units-proxy — never the model's estimated units,
 * which would be circular) and persists per-game aggregates to `game_rank`.
 *
 * Metric choice validated against a blend in `scripts/compute-homegrown-rank.ts`:
 * reviews-only is the cleanest base — CCU reintroduces the multiplayer bias and
 * breaks chart-presence semantics (it's a level, not a per-week flow).
 *
 * The rank is relative to our universe (not Steam's catalogue), which is the
 * right denominator for the matcher. Percentiles normalise for the universe
 * growing over time.
 */
@Injectable()
export class RankService {
  private readonly logger = new Logger(RankService.name);

  constructor(
    @InjectRepository(GameRank)
    private readonly gameRanks: Repository<GameRank>,
  ) {}

  /** Cumulative value at time t via binary search (largest row with t' <= t). */
  private valueAt(rows: Point[], t: number): number {
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

  /**
   * Recompute the whole leaderboard and overwrite `game_rank`. Read-heavy
   * (scans all STEAM_REVIEWS rows) but simple: derived, fully-recomputable data.
   */
  async recomputeAll(): Promise<{
    universe: number;
    rankedWeeks: number;
    charted: number;
  }> {
    // Cumulative-review series per tracked, non-free, non-deleted Steam game.
    const rows: Array<{ gameId: string; capturedAt: Date; value: number }> =
      await this.gameRanks.query(
        `SELECT s."gameId" AS "gameId", s."capturedAt" AS "capturedAt", s.value AS value
           FROM signal_snapshot s
           JOIN game g ON g.id = s."gameId"
           JOIN game_source gs
             ON gs."gameId" = g.id AND gs.source = 'STEAM'
          WHERE s.metric = 'STEAM_REVIEWS'
            AND g."isFree" = false AND g."deletedAt" IS NULL
          ORDER BY s."gameId" ASC, s."capturedAt" ASC`,
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

    // Per-game weekly review velocity → per-week list of {gameId, vel > 0}.
    const weekMap = new Map<number, Array<{ g: string; vel: number }>>();
    for (const [gameId, series] of byGame) {
      if (series.length < 2) continue;
      const firstWeek = Math.floor(series[0].t / WEEK_MS);
      const lastWeek = Math.floor(series[series.length - 1].t / WEEK_MS);
      for (let w = firstWeek; w <= lastWeek; w++) {
        const vel =
          this.valueAt(series, (w + 1) * WEEK_MS) -
          this.valueAt(series, w * WEEK_MS);
        if (vel <= 0) continue;
        let list = weekMap.get(w);
        if (!list) weekMap.set(w, (list = []));
        list.push({ g: gameId, vel });
      }
    }

    // Rank each qualifying week (desc velocity) and accumulate positions.
    const positions = new Map<string, Positions>();
    let rankedWeeks = 0;
    for (const [, list] of weekMap) {
      if (list.length < MIN_WEEK_GAMES) continue;
      rankedWeeks += 1;
      list.sort((a, b) => b.vel - a.vel || (a.g < b.g ? -1 : 1));
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const pos = i + 1;
        let acc = positions.get(list[i].g);
        if (!acc) positions.set(list[i].g, (acc = { ranks: [], pcts: [] }));
        acc.ranks.push(pos);
        acc.pcts.push(pos / n);
      }
    }

    const computedAt = new Date();
    const outRows: GameRank[] = [];
    for (const [gameId, { ranks, pcts }] of positions) {
      outRows.push(
        this.gameRanks.create({
          gameId,
          weeksCharted: ranks.length,
          peakRank: Math.min(...ranks),
          avgRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
          peakPercentile: Math.min(...pcts),
          avgPercentile: pcts.reduce((a, b) => a + b, 0) / pcts.length,
          weeksTopDecile: pcts.filter((p) => p <= TOP_DECILE).length,
          computedAt,
        }),
      );
    }

    // Full overwrite: the leaderboard is global, so a per-game upsert can't know
    // which games dropped out. Clear then bulk-insert.
    await this.gameRanks.query('DELETE FROM game_rank');
    if (outRows.length > 0) {
      await this.gameRanks.save(outRows, { chunk: 500 });
    }

    this.logger.log(
      `[rank] recomputed: ${byGame.size} game(s) with reviews, ` +
        `${rankedWeeks} ranked week(s), ${outRows.length} game(s) charted.`,
    );
    return {
      universe: byGame.size,
      rankedWeeks,
      charted: outRows.length,
    };
  }
}

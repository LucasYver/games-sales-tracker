import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game, Milestone, Platform, SalesSource } from '../entities';

/**
 * Deterministic, LLM-free consistency detector. It judges every active
 * milestone against its OWN game's sales trajectory (the other milestones on
 * the same game) plus a couple of hard invariants (a figure can't predate the
 * release, a single platform can't outsell the worldwide total). No external
 * fetch, no persisted verdicts — the whole thing is recomputed on demand, so
 * the triage view is always fresh and there is no stale-verdict problem.
 */

export type ConsistencyRule =
  | 'PRE_RELEASE'
  | 'NON_MONOTONIC'
  | 'PLATFORM_SUM_EXCEEDS_GLOBAL'
  | 'PLATFORM_EXCEEDS_GLOBAL'
  | 'MAGNITUDE_OUTLIER';

export type ConsistencySeverity = 'high' | 'medium';

export interface ConsistencyFlag {
  rule: ConsistencyRule;
  severity: ConsistencySeverity;
  message: string;
  // Other milestones on the same game that this flag is in conflict with, so
  // the UI can highlight the offending pair/group in the game's timeline.
  relatedMilestoneIds: string[];
}

export interface ConsistencyGameGroup {
  gameId: string;
  gameName: string;
  releaseDate: Date | null;
  // Every active milestone of the game (sorted oldest-first), so the triage UI
  // can render the full trajectory for context — not just the flagged rows.
  milestones: Milestone[];
  // milestoneId -> flags. Only flagged milestones appear as keys.
  flags: Record<string, ConsistencyFlag[]>;
  highFlagCount: number;
  totalFlagCount: number;
}

export interface ConsistencyIssuesResult {
  gamesFlagged: number;
  milestonesFlagged: number;
  byRule: Record<ConsistencyRule, number>;
  games: ConsistencyGameGroup[];
}

// Synthetic, algorithmically-derived milestones. Their value is a modeled
// estimate, not a per-milestone extraction, so mixing them into the
// trajectory/consistency checks produces noise rather than real errors. They
// still appear in the timeline for context, just never as context/anchors.
const SYNTHETIC_SOURCES = new Set<SalesSource>([
  SalesSource.STEAM_LEAK,
  SalesSource.PLAYSTATION_LEAK,
]);

const SINGLE_PLATFORMS: Platform[] = [
  Platform.PC,
  Platform.PLAYSTATION,
  Platform.XBOX,
  Platform.SWITCH,
];

const DAY_MS = 24 * 3600 * 1000;
// Timezone / rounding slack before a figure counts as predating the release.
const RELEASE_GRACE_MS = 3 * DAY_MS;
// A later figure may dip below an earlier one by this fraction (rounding,
// "over 2M" vs an exact 2,000,000) before it counts as non-monotonic.
const MONOTONIC_TOLERANCE = 0.05;
// Third-party estimates are inherently fuzzier, so they get a wider band.
const MONOTONIC_TOLERANCE_ESTIMATE = 0.15;
// Sum of per-platform figures may exceed the worldwide total by this factor
// (double-counting at boundaries, shipped-vs-sold) before it's flagged. Mirrors
// the ingestion pipeline's platform-consistency cap.
const PLATFORM_OVER_GLOBAL_TOLERANCE = 1.15;
// A per-platform figure is only compared against a worldwide total captured
// within this window of it (older globals are stale and legitimately smaller).
const PLATFORM_ALIGN_WINDOW_MS = 45 * DAY_MS;
// A point that towers over BOTH its neighbours by this factor looks like a
// stray extra zero / a franchise total rather than a real jump.
const OUTLIER_FACTOR = 8;

@Injectable()
export class MilestoneConsistencyService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
  ) {}

  async findIssues(gameId?: string): Promise<ConsistencyIssuesResult> {
    const qb = this.milestones
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.game', 'g')
      .where('m.rejectedAt IS NULL')
      .andWhere('g.deletedAt IS NULL');
    if (gameId) qb.andWhere('m.gameId = :gameId', { gameId });
    const all = await qb.getMany();

    const byGame = new Map<string, Milestone[]>();
    for (const m of all) {
      const list = byGame.get(m.gameId);
      if (list) list.push(m);
      else byGame.set(m.gameId, [m]);
    }

    const groups: ConsistencyGameGroup[] = [];
    const byRule: Record<ConsistencyRule, number> = {
      PRE_RELEASE: 0,
      NON_MONOTONIC: 0,
      PLATFORM_SUM_EXCEEDS_GLOBAL: 0,
      PLATFORM_EXCEEDS_GLOBAL: 0,
      MAGNITUDE_OUTLIER: 0,
    };
    let milestonesFlagged = 0;

    for (const [gid, milestones] of byGame) {
      const game = milestones[0].game;
      const flags = this.evaluateGame(milestones, game);
      if (flags.size === 0) continue;

      let highFlagCount = 0;
      let totalFlagCount = 0;
      const flagsObj: Record<string, ConsistencyFlag[]> = {};
      for (const [mid, list] of flags) {
        flagsObj[mid] = list;
        totalFlagCount += list.length;
        for (const f of list) {
          byRule[f.rule] += 1;
          if (f.severity === 'high') highFlagCount += 1;
        }
      }
      milestonesFlagged += flags.size;

      groups.push({
        gameId: gid,
        gameName: game.name,
        releaseDate: game.releaseDate,
        milestones: [...milestones].sort(byReportedAtAsc),
        flags: flagsObj,
        highFlagCount,
        totalFlagCount,
      });
    }

    groups.sort(
      (a, b) =>
        b.highFlagCount - a.highFlagCount ||
        b.totalFlagCount - a.totalFlagCount,
    );

    return {
      gamesFlagged: groups.length,
      milestonesFlagged,
      byRule,
      games: groups,
    };
  }

  private evaluateGame(
    milestones: Milestone[],
    game: Game,
  ): Map<string, ConsistencyFlag[]> {
    const flags = new Map<string, ConsistencyFlag[]>();
    const add = (id: string, flag: ConsistencyFlag) => {
      const list = flags.get(id);
      if (list) list.push(flag);
      else flags.set(id, [flag]);
    };

    // Sales-only, real (non-synthetic) figures feed every trajectory rule.
    const sales = milestones.filter(
      (m) =>
        !m.isEngagement &&
        !SYNTHETIC_SOURCES.has(m.source) &&
        m.reportedAt != null,
    );

    this.checkPreRelease(milestones, game, add);
    this.checkMonotonicAndOutliers(sales, add);
    this.checkPlatformVsGlobal(sales, add);

    return flags;
  }

  // Rule 1 — a figure dated before the game's earliest release is a wrong date
  // (or the wrong game entirely). We floor on `game.releaseDate` (the earliest
  // date across platforms) rather than per-platform release dates: those are
  // demonstrably unreliable in the data and would produce false positives,
  // whereas nothing can legitimately predate the earliest release.
  private checkPreRelease(
    milestones: Milestone[],
    game: Game,
    add: (id: string, flag: ConsistencyFlag) => void,
  ): void {
    const release = game.releaseDate;
    if (!release) return;
    for (const m of milestones) {
      if (!m.reportedAt) continue;
      if (m.reportedAt.getTime() < release.getTime() - RELEASE_GRACE_MS) {
        add(m.id, {
          rule: 'PRE_RELEASE',
          severity: 'high',
          message: `Reported ${fmtDate(
            m.reportedAt,
          )}, before the game's release (${fmtDate(release)}).`,
          relatedMilestoneIds: [],
        });
      }
    }
  }

  // Rules 2 & 5 — within a (game, platform) series ordered by date, cumulative
  // lifetime units should only grow. We take the longest non-decreasing
  // subsequence as the "true" trajectory and flag only the points that fall
  // outside it, so a single bad HIGH point is flagged on its own instead of
  // poisoning every legitimate later point (the failure mode of a naive
  // running-max). A flagged point that also towers over both its kept
  // neighbours is additionally called out as a magnitude outlier (stray
  // digit / franchise total).
  private checkMonotonicAndOutliers(
    sales: Milestone[],
    add: (id: string, flag: ConsistencyFlag) => void,
  ): void {
    const byPlatform = new Map<Platform, Milestone[]>();
    for (const m of sales) {
      const list = byPlatform.get(m.platform);
      if (list) list.push(m);
      else byPlatform.set(m.platform, [m]);
    }

    for (const [, series] of byPlatform) {
      if (series.length < 2) continue;
      series.sort(byReportedAtAsc);

      const kept = longestNonDecreasingChain(series);
      for (let i = 0; i < series.length; i++) {
        if (kept.has(i)) continue;
        const cur = series[i];
        const before = nearestKept(kept, i, -1, series);
        const after = nearestKept(kept, i, 1, series);
        const context = [before, after].filter(
          (m): m is Milestone => m != null,
        );
        const isSpike =
          (!before || cur.units > before.units) &&
          (!after || cur.units > after.units);

        add(cur.id, {
          rule: 'NON_MONOTONIC',
          severity: 'high',
          message: isSpike
            ? `${fmtUnits(cur.units)} on ${fmtDate(
                cur.reportedAt,
              )} spikes above the surrounding trajectory (${describeNeighbours(
                before,
                after,
              )}) — likely wrong number or wrong date.`
            : `${fmtUnits(cur.units)} on ${fmtDate(
                cur.reportedAt,
              )} dips below the surrounding trajectory (${describeNeighbours(
                before,
                after,
              )}) — a cumulative ${cur.platform} total should only grow.`,
          relatedMilestoneIds: context.map((m) => m.id),
        });

        if (
          isSpike &&
          before &&
          after &&
          cur.units > before.units * OUTLIER_FACTOR &&
          cur.units > after.units * OUTLIER_FACTOR
        ) {
          add(cur.id, {
            rule: 'MAGNITUDE_OUTLIER',
            severity: 'medium',
            message: `${fmtUnits(cur.units)} dwarfs its neighbours (${fmtUnits(
              before.units,
            )} / ${fmtUnits(
              after.units,
            )}) — likely a stray digit or a franchise total.`,
            relatedMilestoneIds: [before.id, after.id],
          });
        }
      }
    }
  }

  // Rules 3 & 4 — cross-platform sanity against the worldwide total.
  private checkPlatformVsGlobal(
    sales: Milestone[],
    add: (id: string, flag: ConsistencyFlag) => void,
  ): void {
    const globals = sales.filter((m) => m.platform === Platform.GLOBAL);
    if (globals.length === 0) return;

    // Rule 4 — a single platform can't outsell the worldwide total known at a
    // comparable-or-later date.
    for (const p of sales) {
      if (p.platform === Platform.GLOBAL || !p.reportedAt) continue;
      const alignedGlobals = globals.filter(
        (g) =>
          g.reportedAt != null &&
          g.reportedAt.getTime() >=
            p.reportedAt!.getTime() - PLATFORM_ALIGN_WINDOW_MS,
      );
      if (alignedGlobals.length === 0) continue;
      const bestGlobal = alignedGlobals.reduce((a, b) =>
        b.units > a.units ? b : a,
      );
      if (p.units > bestGlobal.units * PLATFORM_OVER_GLOBAL_TOLERANCE) {
        add(p.id, {
          rule: 'PLATFORM_EXCEEDS_GLOBAL',
          severity: 'high',
          message: `${p.platform} ${fmtUnits(
            p.units,
          )} exceeds the worldwide ${fmtUnits(bestGlobal.units)} on ${fmtDate(
            bestGlobal.reportedAt,
          )} — wrong platform label or wrong number.`,
          relatedMilestoneIds: [bestGlobal.id],
        });
      }
    }

    // Rule 3 — the sum of the latest per-platform figures shouldn't blow past
    // the most recent worldwide total.
    const anchor = globals.reduce((a, b) =>
      (b.reportedAt?.getTime() ?? 0) > (a.reportedAt?.getTime() ?? 0) ? b : a,
    );
    if (!anchor.reportedAt) return;
    const cutoff = anchor.reportedAt.getTime() + PLATFORM_ALIGN_WINDOW_MS;

    const contributors: Milestone[] = [];
    for (const platform of SINGLE_PLATFORMS) {
      const candidates = sales.filter(
        (m) =>
          m.platform === platform &&
          m.reportedAt != null &&
          m.reportedAt.getTime() <= cutoff,
      );
      if (candidates.length === 0) continue;
      const latest = candidates.reduce((a, b) =>
        (b.reportedAt?.getTime() ?? 0) > (a.reportedAt?.getTime() ?? 0) ? b : a,
      );
      contributors.push(latest);
    }
    if (contributors.length < 2) return;

    const sum = contributors.reduce((acc, m) => acc + m.units, 0);
    if (sum > anchor.units * PLATFORM_OVER_GLOBAL_TOLERANCE) {
      add(anchor.id, {
        rule: 'PLATFORM_SUM_EXCEEDS_GLOBAL',
        severity: 'medium',
        message: `Platform figures sum to ${fmtUnits(
          sum,
        )} but the worldwide total is only ${fmtUnits(
          anchor.units,
        )} — a platform figure is likely mislabeled or the global is too low.`,
        relatedMilestoneIds: contributors.map((m) => m.id),
      });
    }
  }
}

function byReportedAtAsc(a: Milestone, b: Milestone): number {
  return (a.reportedAt?.getTime() ?? 0) - (b.reportedAt?.getTime() ?? 0);
}

/**
 * Indices of the longest tolerance-aware non-decreasing subsequence of a
 * date-sorted milestone series. This is the "true" growth trajectory; every
 * index NOT returned is an anomaly (a high spike or a low dip). O(n²) DP —
 * fine for the handful of milestones a single game/platform ever has.
 */
function longestNonDecreasingChain(series: Milestone[]): Set<number> {
  const n = series.length;
  const dp = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let bestEnd = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const tol =
        series[j].isEstimate || series[i].isEstimate
          ? MONOTONIC_TOLERANCE_ESTIMATE
          : MONOTONIC_TOLERANCE;
      if (series[i].units >= series[j].units * (1 - tol) && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1;
        prev[i] = j;
      }
    }
    // Tie-break toward the later index so the most recent data stays "true".
    if (dp[i] >= dp[bestEnd]) bestEnd = i;
  }

  const kept = new Set<number>();
  for (let i = bestEnd; i !== -1; i = prev[i]) kept.add(i);
  return kept;
}

function nearestKept(
  kept: Set<number>,
  from: number,
  dir: 1 | -1,
  series: Milestone[],
): Milestone | null {
  for (let i = from + dir; i >= 0 && i < series.length; i += dir) {
    if (kept.has(i)) return series[i];
  }
  return null;
}

function describeNeighbours(
  before: Milestone | null,
  after: Milestone | null,
): string {
  const parts: string[] = [];
  if (before)
    parts.push(`${fmtUnits(before.units)} on ${fmtDate(before.reportedAt)}`);
  if (after)
    parts.push(`${fmtUnits(after.units)} on ${fmtDate(after.reportedAt)}`);
  return parts.join(' → ') || 'no clean neighbour';
}

function fmtDate(date: Date | null): string {
  if (!date) return 'unknown date';
  return date.toISOString().slice(0, 10);
}

function fmtUnits(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${n}`;
}

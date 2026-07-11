import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository, IsNull } from 'typeorm';
import {
  AchievementSnapshot,
  EstimateSnapshot,
  EstimationDiscrepancy,
  Game,
  GameRank,
  GameSource,
  Milestone,
  Platform,
  PriceSnapshot,
  ProcessedArticle,
  SalesEstimate,
  SalesSource,
  SerializedReconciliationEntry,
  SignalMetric,
  SignalSnapshot,
  SourceType,
  TrustedSource,
} from '../entities';
import { isPeriodicQuote } from '../ingestion/sales-figure.utils';
import { slugify } from '../common/slug';
import { GamesService } from '../games/games.service';
import { ReferenceProfileService } from '../reference-profiles/reference-profile.service';

export interface UpdateGameInput {
  name?: string;
  releaseDate?: string | null;
  igdbId?: number | null;
}

export interface UpdateMilestoneInput {
  source?: SalesSource;
  platform?: Platform;
  units?: number;
  publisher?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
  reportedAt?: string | null;
  isEngagement?: boolean;
  isEstimate?: boolean;
  confidenceScore?: number | null;
}

export interface AdminStats {
  games: {
    total: number;
    withSales: number;
    withEstimate: number;
  };
  milestones: {
    total: number;
    bySource: Record<SalesSource, number>;
    undated: number;
  };
  signals: {
    steamReviewsTotal: number;
    lastCapturedAt: Date | null;
  };
  trustedSources: {
    total: number;
    active: number;
    withFeed: number;
  };
  estimates: {
    total: number;
  };
}

export interface AdminGameSummary {
  id: string;
  name: string;
  slug: string;
  releaseDate: Date | null;
  isFree: boolean;
  platforms: Platform[];
  hasMilestone: boolean;
  hasEstimate: boolean;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregated view of the latest achievement capture for a (platform, source)
 * pair on a single game — what the admin UI shows. Each row collapses ~30-70
 * individual snapshot rows into the headline numbers the operator actually
 * cares about (sample size, most-common achievement, capture date).
 */
export interface AdminAchievementSummary {
  platform: Platform;
  source: SourceType;
  achievementsCount: number;
  playersTracked: number | null;
  mostCommonName: string;
  mostCommonPercent: number;
  mostCommonPlayers: number | null;
  capturedAt: Date;
}

/**
 * One historical point of the headline reconciled estimate, used to draw
 * the sales-over-time chart on the admin detail page.
 */
export interface AdminEstimateSnapshot {
  computedAt: Date;
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
  reconciliation: SerializedReconciliationEntry[];
}

export interface AdminGameDetail extends AdminGameSummary {
  milestonesCount: number;
  estimatesCount: number;
  latestReviews: number | null;
  latestReviewsAt: Date | null;
  igdbId: number | null;
  coverUrl: string | null;
  summary: string | null;
  genres: string[];
  categories: string[];
  steamTags: string[];
  dlc: number[];
  developer: string | null;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
  liveService: boolean;
  lastRefreshedAt: Date | null;
  allTimePeakCcu: number | null;
  allTimePeakCcuAt: Date | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
  } | null;
  sources: GameSource[];
  milestones: Milestone[];
  estimates: SalesEstimate[];
  signals: SignalSnapshot[];
  // Full STEAM_CONCURRENT series (the `signals` array is capped at the 200
  // most recent rows for the table view; the CCU chart needs every point,
  // which can be years of daily history after a SteamDB CSV import).
  ccuHistory: { capturedAt: Date; value: number }[];
  // Full STEAM_REVIEWS series (cumulative review counts over time).
  reviewHistory: { capturedAt: Date; value: number }[];
  // Full STEAM_FOLLOWERS series (community-group member count over time).
  // Sourced from games-popularity.com; history only reaches ~2024-03.
  followersHistory: { capturedAt: Date; value: number }[];
  prices: PriceSnapshot[];
  achievementSnapshots: AdminAchievementSummary[];
  estimateSnapshots: AdminEstimateSnapshot[];
  // IGDB `release_dates` broken out per platform, e.g. a PlayStation launch
  // a year ahead of the PC port. Empty when IGDB had no breakdown for this
  // game; `releaseDate` above (earliest across all platforms) is then the
  // only known date.
  platformReleaseDates: { platform: Platform; releaseDate: Date }[];
}

export interface PaginatedAdmin<T> {
  items: T[];
  total: number;
}

export interface LatestSignal {
  metric: SignalMetric;
  value: number;
  capturedAt: Date;
}

/**
 * Lightweight payload for the game page's pinned header + Overview tab. Kept
 * deliberately free of the heavy multi-year series (those load per-tab) so the
 * first paint is one fast round-trip.
 */
export interface AdminGameSummary2 {
  id: string;
  name: string;
  slug: string;
  coverUrl: string | null;
  summary: string | null;
  releaseDate: Date | null;
  platforms: Platform[];
  isFree: boolean;
  developer: string | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
  } | null;
  genres: string[];
  categories: string[];
  steamTags: string[];
  dlc: number[];
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
  liveService: boolean;
  excludedFromReference: boolean;
  igdbId: number | null;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sources: unknown[];
  latestSignals: LatestSignal[];
  peakCcu: { value: number; capturedAt: Date } | null;
  homeRank: {
    weeksCharted: number;
    peakRank: number;
    avgRank: number;
    peakPercentile: number;
    weeksTopDecile: number;
  } | null;
  latestEstimate: {
    computedAt: Date;
    estimatedTodayLow: number;
    estimatedTodayHigh: number;
    reconciliation: unknown;
  } | null;
  milestones: Milestone[];
  milestonesCount: number;
  estimatesCount: number;
  // See `AdminGameDetail.platformReleaseDates`.
  platformReleaseDates: { platform: Platform; releaseDate: Date }[];
}

export interface AdminGameCharts {
  ccuHistory: { capturedAt: Date; value: number }[];
  reviewHistory: { capturedAt: Date; value: number }[];
  followersHistory: { capturedAt: Date; value: number }[];
  // Console store-rating series (cumulative counts). Only rendered per-platform
  // and only when the game has data, so a PC-only game shows none.
  psRatingsHistory: { capturedAt: Date; value: number }[];
  // Reconstructed (synthetic) PS ratings filling the pre-measurement gap —
  // rendered as a distinct dashed overlay, never mixed with the real series.
  psRatingsSyntheticHistory: { capturedAt: Date; value: number }[];
  xboxRatingsHistory: { capturedAt: Date; value: number }[];
  switchRatingsHistory: { capturedAt: Date; value: number }[];
  prices: PriceSnapshot[];
  signals: SignalSnapshot[];
}

export interface AdminRankRow {
  gameId: string;
  name: string;
  year: number | null;
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  peakPercentile: number;
  avgPercentile: number;
  weeksTopDecile: number;
  computedAt: Date;
}

export interface IssueGroup<T> {
  count: number;
  items: T[];
}

export interface AdminIssues {
  undatedMilestones: IssueGroup<Milestone & { gameName: string }>;
  suspectQuotes: IssueGroup<Milestone & { gameName: string }>;
  staleGames: IssueGroup<{
    gameId: string;
    gameName: string;
    lastSignalAt: Date | null;
  }>;
  inactiveTrustedSources: IssueGroup<TrustedSource>;
  gamesWithoutAnySignal: IssueGroup<{ id: string; name: string; slug: string }>;
  estimationDiscrepancies: IssueGroup<{
    gameId: string;
    gameName: string;
    platform: Platform;
    declaredUnits: number;
    declaredSource: SalesSource;
    declaredAt: Date | null;
    priorEstimateLow: number;
    priorEstimateHigh: number;
    ratio: number;
    detectedAt: Date;
  }>;
}

const STALE_DAYS = 30;
const ISSUE_PREVIEW_LIMIT = 50;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(GameSource)
    private readonly gameSources: Repository<GameSource>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(PriceSnapshot)
    private readonly prices: Repository<PriceSnapshot>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(TrustedSource)
    private readonly trustedSources: Repository<TrustedSource>,
    @InjectRepository(ProcessedArticle)
    private readonly processedArticles: Repository<ProcessedArticle>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    @InjectRepository(EstimateSnapshot)
    private readonly estimateSnapshots: Repository<EstimateSnapshot>,
    @InjectRepository(EstimationDiscrepancy)
    private readonly discrepancies: Repository<EstimationDiscrepancy>,
    @InjectRepository(GameRank)
    private readonly gameRanks: Repository<GameRank>,
    private readonly gamesService: GamesService,
    private readonly referenceProfiles: ReferenceProfileService,
  ) {}

  /**
   * Home-grown review-velocity rank leaderboard (from `game_rank`), joined with
   * game name/year, biggest first (most weeks in top decile, then best peak
   * percentile). Cap at 500 rows for the admin table.
   */
  async listRanks(): Promise<AdminRankRow[]> {
    const rows: Array<{
      gameId: string;
      name: string;
      yr: string | null;
      weeksCharted: number;
      peakRank: number;
      avgRank: number;
      peakPercentile: number;
      avgPercentile: number;
      weeksTopDecile: number;
      computedAt: Date;
    }> = await this.gameRanks.query(
      `SELECT r."gameId" AS "gameId", g.name AS name,
              EXTRACT(YEAR FROM g."releaseDate")::text AS yr,
              r."weeksCharted", r."peakRank", r."avgRank",
              r."peakPercentile", r."avgPercentile", r."weeksTopDecile",
              r."computedAt"
         FROM game_rank r
         JOIN game g ON g.id = r."gameId"
        WHERE g."deletedAt" IS NULL
        ORDER BY r."weeksTopDecile" DESC, r."peakPercentile" ASC
        LIMIT 500`,
    );
    return rows.map((r) => ({
      gameId: r.gameId,
      name: r.name,
      year: r.yr ? Number(r.yr) : null,
      weeksCharted: Number(r.weeksCharted),
      peakRank: Number(r.peakRank),
      avgRank: Number(r.avgRank),
      peakPercentile: Number(r.peakPercentile),
      avgPercentile: Number(r.avgPercentile),
      weeksTopDecile: Number(r.weeksTopDecile),
      computedAt: r.computedAt,
    }));
  }

  async stats(): Promise<AdminStats> {
    const [
      gamesTotal,
      gamesWithSales,
      gamesWithEstimate,
      salesTotal,
      salesUndated,
      bySourceRows,
      latestSteamSignal,
      steamReviewsTotal,
      trustedTotal,
      trustedActive,
      trustedWithFeed,
      estimatesTotal,
    ] = await Promise.all([
      this.games.count(),
      this.games
        .createQueryBuilder('g')
        .innerJoin('g.milestones', 'm', 'm.rejectedAt IS NULL')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.games
        .createQueryBuilder('g')
        .innerJoin('g.estimates', 'e')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.milestones.count({ where: { rejectedAt: IsNull() } }),
      this.milestones.count({
        where: { reportedAt: IsNull(), rejectedAt: IsNull() },
      }),
      this.milestones
        .createQueryBuilder('m')
        .where('m.rejectedAt IS NULL')
        .select('m.source', 'source')
        .addSelect('COUNT(*)', 'c')
        .groupBy('m.source')
        .getRawMany<{ source: SalesSource; c: string }>(),
      this.signals
        .createQueryBuilder('s')
        .where('s.metric = :m', { m: SignalMetric.STEAM_REVIEWS })
        .orderBy('s.capturedAt', 'DESC')
        .limit(1)
        .getOne(),
      this.signals.count({ where: { metric: SignalMetric.STEAM_REVIEWS } }),
      this.trustedSources.count(),
      this.trustedSources.count({ where: { active: true } }),
      this.trustedSources
        .createQueryBuilder('ts')
        .where('ts.feedUrl IS NOT NULL')
        .getCount(),
      this.estimates.count(),
    ]);

    const bySource = Object.values(SalesSource).reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<SalesSource, number>,
    );
    for (const row of bySourceRows) bySource[row.source] = Number(row.c);

    return {
      games: {
        total: gamesTotal,
        withSales: Number(gamesWithSales?.c ?? 0),
        withEstimate: Number(gamesWithEstimate?.c ?? 0),
      },
      milestones: {
        total: salesTotal,
        bySource,
        undated: salesUndated,
      },
      signals: {
        steamReviewsTotal,
        lastCapturedAt: latestSteamSignal?.capturedAt ?? null,
      },
      trustedSources: {
        total: trustedTotal,
        active: trustedActive,
        withFeed: trustedWithFeed,
      },
      estimates: { total: estimatesTotal },
    };
  }

  async listGames(opts: {
    q?: string;
    platform?: string;
    platformExclusive?: boolean;
    hasSales?: boolean;
    hasEstimates?: boolean;
    sort?: 'updated' | 'releaseDate' | 'lastRefreshed';
    direction?: 'asc' | 'desc';
    offset?: number;
    limit?: number;
  }): Promise<PaginatedAdmin<AdminGameSummary>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    // Existence is checked via correlated EXISTS subqueries instead of
    // joining + aggregating the milestone/estimate rows. The previous
    // multi-join + GROUP BY produced a cartesian fan-out (tens of millions
    // of intermediate rows for the busiest games), which made this query
    // take minutes. EXISTS short-circuits on the per-game indexes.
    const hasMilestoneExpr =
      'EXISTS (SELECT 1 FROM milestone m ' +
      'WHERE m."gameId" = g.id AND m."rejectedAt" IS NULL)';
    const hasEstimateExpr =
      'EXISTS (SELECT 1 FROM sales_estimate e WHERE e."gameId" = g.id)';

    const applyFilters = (
      builder: ReturnType<typeof this.games.createQueryBuilder>,
    ) => {
      if (opts.q && opts.q.trim()) {
        builder.andWhere('g.name ILIKE :q', { q: `%${opts.q.trim()}%` });
      }
      if (opts.platform) {
        if (opts.platformExclusive) {
          builder.andWhere(
            'g.platforms = ARRAY[:platform]::game_platforms_enum[]',
            { platform: opts.platform },
          );
        } else {
          builder.andWhere(
            'g.platforms @> ARRAY[:platform]::game_platforms_enum[]',
            { platform: opts.platform },
          );
        }
      }
      if (opts.hasSales === true) {
        builder.andWhere(hasMilestoneExpr);
      } else if (opts.hasSales === false) {
        builder.andWhere(`NOT ${hasMilestoneExpr}`);
      }
      if (opts.hasEstimates === true) {
        builder.andWhere(hasEstimateExpr);
      } else if (opts.hasEstimates === false) {
        builder.andWhere(`NOT ${hasEstimateExpr}`);
      }
      return builder;
    };

    const qb = this.games
      .createQueryBuilder('g')
      .select([
        'g.id AS id',
        'g.name AS name',
        'g.slug AS slug',
        'g.releaseDate AS "releaseDate"',
        'g.isFree AS "isFree"',
        'g.platforms AS platforms',
        'g.lastRefreshedAt AS "lastRefreshedAt"',
        'g.createdAt AS "createdAt"',
        'g.updatedAt AS "updatedAt"',
      ])
      .addSelect(hasMilestoneExpr, 'hasMilestone')
      .addSelect(hasEstimateExpr, 'hasEstimate');
    applyFilters(qb);

    const countQb = applyFilters(this.games.createQueryBuilder('g'));

    const direction = opts.direction === 'asc' ? 'ASC' : 'DESC';
    // NULLS LAST keeps games missing the sorted attribute (no release date /
    // never refreshed) at the bottom regardless of direction.
    const SORT_EXPR: Record<string, string> = {
      updated: 'g.updatedAt',
      releaseDate: 'g.releaseDate',
      lastRefreshed: 'g.lastRefreshedAt',
    };
    const sortExpr = SORT_EXPR[opts.sort ?? 'updated'] ?? SORT_EXPR.updated;

    const rawRows = await qb
      .orderBy(sortExpr, direction, 'NULLS LAST')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string;
        slug: string;
        releaseDate: Date | null;
        isFree: boolean;
        platforms: string | Platform[];
        lastRefreshedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        hasMilestone: boolean;
        hasEstimate: boolean;
      }>();

    const total = await countQb.getCount();

    const items: AdminGameSummary[] = rawRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      releaseDate: r.releaseDate,
      isFree: r.isFree,
      platforms: parsePlatforms(r.platforms),
      hasMilestone: Boolean(r.hasMilestone),
      hasEstimate: Boolean(r.hasEstimate),
      lastRefreshedAt: r.lastRefreshedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return { items, total };
  }

  async getGameDetail(id: string): Promise<AdminGameDetail> {
    const game = await this.games.findOne({
      where: { id },
      relations: {
        sources: true,
        milestones: true,
        estimates: true,
        publisherRecord: true,
        platformReleaseDates: true,
      },
    });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    const visibleMilestones = game.milestones.filter(
      (m) => m.rejectedAt == null,
    );

    const signals = await this.signals.find({
      where: { gameId: id },
      order: { capturedAt: 'DESC' },
      take: 200,
    });

    const latestReviews = signals.find(
      (s) => s.metric === SignalMetric.STEAM_REVIEWS,
    );

    // Sort by `value DESC` (not `capturedAt`): the historical-import path
    // writes a STEAM_PEAK_CCU row with the SteamCharts month as
    // capturedAt, so the most recent row by date is *not* necessarily the
    // largest. We query it explicitly (and not via `signals`) so the
    // 200-row cap can't exclude it on games with dense CCU/reviews history.
    const allTimePeak = await this.signals.findOne({
      where: { gameId: id, metric: SignalMetric.STEAM_PEAK_CCU },
      order: { value: 'DESC' },
    });

    const ccuRows = await this.signals.find({
      where: { gameId: id, metric: SignalMetric.STEAM_CONCURRENT },
      order: { capturedAt: 'ASC' },
      select: { capturedAt: true, value: true },
    });
    const ccuHistory = ccuRows.map((s) => ({
      capturedAt: s.capturedAt,
      value: s.value,
    }));

    const reviewRows = await this.signals.find({
      where: { gameId: id, metric: SignalMetric.STEAM_REVIEWS },
      order: { capturedAt: 'ASC' },
      select: { capturedAt: true, value: true },
    });
    const reviewHistory = reviewRows.map((s) => ({
      capturedAt: s.capturedAt,
      value: s.value,
    }));

    const followersRows = await this.signals.find({
      where: { gameId: id, metric: SignalMetric.STEAM_FOLLOWERS },
      order: { capturedAt: 'ASC' },
      select: { capturedAt: true, value: true },
    });
    const followersHistory = followersRows.map((s) => ({
      capturedAt: s.capturedAt,
      value: s.value,
    }));

    const prices = await this.prices.find({
      where: { gameId: id },
      order: { capturedAt: 'ASC' },
      take: 500,
    });

    const achievementSnapshots = await this.aggregateAchievementSnapshots(id);

    const estimateSnapshotsRaw = await this.estimateSnapshots.find({
      where: { gameId: id },
      order: { computedAt: 'ASC' },
      take: 500,
    });
    const estimateSnapshots: AdminEstimateSnapshot[] = estimateSnapshotsRaw.map(
      (s) => ({
        computedAt: s.computedAt,
        estimatedTodayLow: s.estimatedTodayLow,
        estimatedTodayHigh: s.estimatedTodayHigh,
        reconciliation: s.reconciliation,
      }),
    );

    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      releaseDate: game.releaseDate,
      isFree: game.isFree,
      platforms: game.platforms,
      hasMilestone: visibleMilestones.length > 0,
      hasEstimate: game.estimates.length > 0,
      milestonesCount: visibleMilestones.length,
      estimatesCount: game.estimates.length,
      latestReviews: latestReviews?.value ?? null,
      latestReviewsAt: latestReviews?.capturedAt ?? null,
      allTimePeakCcu: allTimePeak?.value ?? null,
      allTimePeakCcuAt: allTimePeak?.capturedAt ?? null,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      igdbId: game.igdbId,
      coverUrl: game.coverUrl,
      summary: game.summary,
      genres: game.genres ?? [],
      categories: game.categories ?? [],
      steamTags: game.steamTags ?? [],
      dlc: game.dlc ?? [],
      developer: game.developer,
      franchiseSlug: game.franchiseSlug,
      isAnnualIteration: game.isAnnualIteration,
      iterationNumber: game.iterationNumber,
      liveService: game.liveService,
      lastRefreshedAt: game.lastRefreshedAt,
      publisher: game.publisher,
      publisherRecord: game.publisherRecord
        ? {
            id: game.publisherRecord.id,
            name: game.publisherRecord.name,
          }
        : null,
      sources: game.sources,
      milestones: visibleMilestones.sort(
        (a, b) =>
          (b.reportedAt?.getTime() ?? 0) - (a.reportedAt?.getTime() ?? 0),
      ),
      estimates: game.estimates,
      signals,
      ccuHistory,
      reviewHistory,
      followersHistory,
      prices,
      achievementSnapshots,
      estimateSnapshots,
      platformReleaseDates: game.platformReleaseDates.map((r) => ({
        platform: r.platform,
        releaseDate: r.releaseDate,
      })),
    };
  }

  /**
   * Pinned header + Overview payload. Every query runs in parallel (one logical
   * round-trip) and the heavy multi-year series are excluded — those load from
   * {@link getGameCharts} when the Charts tab opens. All latest-per-metric
   * values come from a single `DISTINCT ON` query instead of one query per
   * metric.
   */
  async getGameSummary(id: string): Promise<AdminGameSummary2> {
    const [
      game,
      milestones,
      rank,
      latestSignals,
      latestSnap,
      estimatesCount,
      peakRow,
    ] = await Promise.all([
      this.games.findOne({
        where: { id },
        relations: {
          publisherRecord: true,
          sources: true,
          platformReleaseDates: true,
        },
      }),
      this.milestones.find({
        where: { gameId: id, rejectedAt: IsNull() },
        order: { reportedAt: 'DESC' },
      }),
      this.gameRanks.findOne({ where: { gameId: id } }),
      this.signals.query(
        `SELECT DISTINCT ON (metric) metric, value, "capturedAt"
             FROM signal_snapshot
            WHERE "gameId" = $1
            ORDER BY metric, "capturedAt" DESC`,
        [id],
      ) as Promise<
        Array<{ metric: SignalMetric; value: number; capturedAt: Date }>
      >,
      this.estimateSnapshots.findOne({
        where: { gameId: id },
        order: { computedAt: 'DESC' },
      }),
      this.estimates.count({ where: { gameId: id } }),
      // Peak CCU is ordered by value (not date): the SteamCharts import writes
      // a peak row dated at the historical month, so latest-by-date is wrong.
      this.signals.findOne({
        where: { gameId: id, metric: SignalMetric.STEAM_PEAK_CCU },
        order: { value: 'DESC' },
      }),
    ]);
    if (!game) throw new NotFoundException(`Game ${id} not found`);

    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      coverUrl: game.coverUrl,
      summary: game.summary,
      releaseDate: game.releaseDate,
      platforms: game.platforms,
      isFree: game.isFree,
      developer: game.developer,
      publisher: game.publisher,
      publisherRecord: game.publisherRecord
        ? {
            id: game.publisherRecord.id,
            name: game.publisherRecord.name,
          }
        : null,
      genres: game.genres ?? [],
      categories: game.categories ?? [],
      steamTags: game.steamTags ?? [],
      dlc: game.dlc ?? [],
      franchiseSlug: game.franchiseSlug,
      isAnnualIteration: game.isAnnualIteration,
      iterationNumber: game.iterationNumber,
      liveService: game.liveService,
      excludedFromReference: game.excludedFromReference,
      igdbId: game.igdbId,
      lastRefreshedAt: game.lastRefreshedAt,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      sources: game.sources,
      latestSignals: latestSignals.map((s) => ({
        metric: s.metric,
        value: Number(s.value),
        capturedAt: s.capturedAt,
      })),
      peakCcu: peakRow
        ? { value: peakRow.value, capturedAt: peakRow.capturedAt }
        : null,
      homeRank: rank
        ? {
            weeksCharted: rank.weeksCharted,
            peakRank: rank.peakRank,
            avgRank: rank.avgRank,
            peakPercentile: rank.peakPercentile,
            weeksTopDecile: rank.weeksTopDecile,
          }
        : null,
      latestEstimate: latestSnap
        ? {
            computedAt: latestSnap.computedAt,
            estimatedTodayLow: latestSnap.estimatedTodayLow,
            estimatedTodayHigh: latestSnap.estimatedTodayHigh,
            reconciliation: latestSnap.reconciliation,
          }
        : null,
      milestones,
      milestonesCount: milestones.length,
      estimatesCount,
      platformReleaseDates: game.platformReleaseDates.map((r) => ({
        platform: r.platform,
        releaseDate: r.releaseDate,
      })),
    };
  }

  /**
   * Charts-tab payload: the time-series + the recent signal table. Each series
   * is a single indexed query and they all run in parallel; sizes are bounded
   * so a game with years of daily history can't return an unbounded blob.
   */
  async getGameCharts(id: string): Promise<AdminGameCharts> {
    const series = (metric: SignalMetric, synthetic = false) =>
      this.signals.find({
        where: { gameId: id, metric, synthetic },
        order: { capturedAt: 'ASC' },
        select: { capturedAt: true, value: true },
        take: 5000,
      });

    const [
      ccu,
      reviews,
      followers,
      psR,
      psRSynthetic,
      xboxR,
      switchR,
      prices,
      signals,
    ] = await Promise.all([
      series(SignalMetric.STEAM_CONCURRENT),
      series(SignalMetric.STEAM_REVIEWS),
      series(SignalMetric.STEAM_FOLLOWERS),
      series(SignalMetric.PS_RATINGS),
      series(SignalMetric.PS_RATINGS, true),
      series(SignalMetric.XBOX_RATINGS),
      series(SignalMetric.SWITCH_RATINGS),
      this.prices.find({
        where: { gameId: id },
        order: { capturedAt: 'ASC' },
        take: 2000,
      }),
      this.signals.find({
        where: { gameId: id },
        order: { capturedAt: 'DESC' },
        take: 200,
      }),
    ]);

    const map = (rows: { capturedAt: Date; value: number }[]) =>
      rows.map((s) => ({ capturedAt: s.capturedAt, value: s.value }));

    return {
      ccuHistory: map(ccu),
      reviewHistory: map(reviews),
      followersHistory: map(followers),
      psRatingsHistory: map(psR),
      psRatingsSyntheticHistory: map(psRSynthetic),
      xboxRatingsHistory: map(xboxR),
      switchRatingsHistory: map(switchR),
      prices,
      signals,
    };
  }

  /**
   * Collapse the achievement_snapshot rows for a game into one row per
   * (platform, source). For each group we keep the *latest* capture
   * (max capturedAt) and reduce its individual achievements to: how many
   * achievements were captured, total achievements declared for the game
   * (from any row in the capture, all equal), the sample size, and the
   * single most-common achievement (highest unlock %).
   */
  private async aggregateAchievementSnapshots(
    gameId: string,
  ): Promise<AdminAchievementSummary[]> {
    const rows = await this.achievements.find({
      where: { gameId },
      order: { capturedAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const groups = new Map<string, AchievementSnapshot[]>();
    for (const row of rows) {
      const key = `${row.platform}::${row.source}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, [row]);
        continue;
      }
      const latestAt = existing[0].capturedAt.getTime();
      const rowAt = row.capturedAt.getTime();
      if (rowAt > latestAt) {
        groups.set(key, [row]);
      } else if (rowAt === latestAt) {
        existing.push(row);
      }
    }

    return Array.from(groups.values())
      .map((capture) => {
        const mostCommon = capture.reduce((max, a) =>
          a.percentEarned > max.percentEarned ? a : max,
        );
        return {
          platform: mostCommon.platform,
          source: mostCommon.source,
          achievementsCount: capture.length,
          playersTracked: mostCommon.playersTracked,
          mostCommonName: mostCommon.achievementName,
          mostCommonPercent: mostCommon.percentEarned,
          mostCommonPlayers: mostCommon.playersWithAchievement,
          capturedAt: mostCommon.capturedAt,
        };
      })
      .sort((a, b) => {
        if (a.platform !== b.platform)
          return a.platform.localeCompare(b.platform);
        return a.source.localeCompare(b.source);
      });
  }

  async deleteGame(id: string): Promise<{ deleted: boolean }> {
    const result = await this.games.softDelete(id);
    const deleted = (result.affected ?? 0) > 0;
    if (deleted) {
      await this.referenceProfiles.removeForGame(id);
    }
    return { deleted };
  }

  /**
   * Patch a game's editable metadata. Currently supports name, releaseDate
   * and igdbId. When name changes, the slug is regenerated and de-duplicated
   * against existing games (collisions get a numeric suffix).
   */
  /**
   * Include/exclude a game from the reference corpus (matcher anchors). Excluded
   * games are skipped by `MatcherService.loadCorpus`, so they no longer skew the
   * derived reference vectors — used for titles with sparse/unreliable data.
   */
  async setReferenceExclusion(
    id: string,
    excluded: boolean,
  ): Promise<{ id: string; excludedFromReference: boolean }> {
    const game = await this.games.findOne({ where: { id } });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    game.excludedFromReference = excluded;
    await this.games.save(game);
    return { id, excludedFromReference: excluded };
  }

  async updateGame(id: string, input: UpdateGameInput): Promise<Game> {
    const game = await this.games.findOne({ where: { id } });
    if (!game) throw new NotFoundException(`Game ${id} not found`);

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw new BadRequestException('name cannot be empty');
      if (trimmed !== game.name) {
        game.name = trimmed;
        game.slug = await this.buildUniqueSlug(trimmed, id);
      }
    }

    if (input.releaseDate !== undefined) {
      if (input.releaseDate === null || input.releaseDate === '') {
        game.releaseDate = null;
      } else {
        const parsed = new Date(input.releaseDate);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('releaseDate must be a valid date');
        }
        game.releaseDate = parsed;
      }
    }

    if (input.igdbId !== undefined) {
      if (input.igdbId === null) {
        game.igdbId = null;
      } else {
        if (!Number.isInteger(input.igdbId) || input.igdbId <= 0) {
          throw new BadRequestException('igdbId must be a positive integer');
        }
        if (input.igdbId !== game.igdbId) {
          const conflict = await this.games.findOne({
            where: { igdbId: input.igdbId, id: Not(id) },
          });
          if (conflict) {
            throw new BadRequestException(
              `igdbId ${input.igdbId} is already used by "${conflict.name}"`,
            );
          }
          game.igdbId = input.igdbId;
        }
      }
    }

    return this.games.save(game);
  }

  private async buildUniqueSlug(
    name: string,
    excludeGameId: string,
  ): Promise<string> {
    const base = slugify(name) || 'game';
    let candidate = base;
    let suffix = 2;
    while (
      await this.games.findOne({
        where: { slug: candidate, id: Not(excludeGameId) },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async listMilestones(opts: {
    gameId?: string;
    source?: SalesSource;
    undated?: boolean;
    suspect?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<PaginatedAdmin<Milestone & { gameName: string }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const qb = this.milestones
      .createQueryBuilder('m')
      .innerJoin('m.game', 'g')
      .addSelect('g.name', 'gameName')
      .where('m.rejectedAt IS NULL')
      .orderBy('m.capturedAt', 'DESC');

    if (opts.gameId) qb.andWhere('m.gameId = :gid', { gid: opts.gameId });
    if (opts.source) qb.andWhere('m.source = :src', { src: opts.source });
    if (opts.undated) qb.andWhere('m.reportedAt IS NULL');

    const [entities, raws, total] = await Promise.all([
      qb.clone().offset(offset).limit(limit).getMany(),
      qb.clone().offset(offset).limit(limit).getRawMany<{ gameName: string }>(),
      qb.clone().getCount(),
    ]);

    let items = entities.map((m, i) => ({
      ...m,
      gameName: raws[i]?.gameName ?? '',
    }));

    if (opts.suspect) {
      items = items.filter((m) => m.note && isPeriodicQuote(m.note));
    }

    return { items, total };
  }

  /**
   * Patch a milestone's editable fields. Every field the LLM extraction
   * pipeline can populate is editable here so an operator can correct
   * mistakes (wrong platform, mis-scraped units, wrong date, etc.) without
   * having to delete and re-ingest the row.
   */
  async updateMilestone(
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    const milestone = await this.milestones.findOne({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone ${id} not found`);

    if (input.source !== undefined) milestone.source = input.source;
    if (input.platform !== undefined) milestone.platform = input.platform;
    if (input.units !== undefined) milestone.units = input.units;
    if (input.publisher !== undefined) milestone.publisher = input.publisher;
    if (input.sourceUrl !== undefined) milestone.sourceUrl = input.sourceUrl;
    if (input.note !== undefined) milestone.note = input.note;
    if (input.reportedAt !== undefined) {
      milestone.reportedAt =
        input.reportedAt === null ? null : new Date(input.reportedAt);
    }
    if (input.isEngagement !== undefined) {
      milestone.isEngagement = input.isEngagement;
    }
    if (input.isEstimate !== undefined) {
      milestone.isEstimate = input.isEstimate;
    }
    if (input.confidenceScore !== undefined) {
      milestone.confidenceScore = input.confidenceScore;
    }

    return this.milestones.save(milestone);
  }

  /**
   * Soft-delete: mark the milestone as rejected instead of hard-deleting
   * it. The row is then hidden from every read (admin + public) AND used
   * as an ingestion fingerprint guard so the next refresh can't re-create
   * it.
   */
  async deleteMilestone(id: string): Promise<{ deleted: boolean }> {
    const result = await this.milestones.update(
      { id, rejectedAt: IsNull() },
      { rejectedAt: new Date() },
    );
    return { deleted: (result.affected ?? 0) > 0 };
  }

  /**
   * Hard-delete a single signal snapshot (Steam reviews / concurrent / peak
   * CCU). Used by the admin detail page to prune erroneous or test readings.
   */
  async deleteSignal(id: string): Promise<{ deleted: boolean }> {
    const result = await this.signals.delete(id);
    return { deleted: (result.affected ?? 0) > 0 };
  }

  /**
   * Replay the estimate history from the signals / milestones already on
   * record, WITHOUT re-scraping any external source. Mirrors the rebuild
   * step of the full refresh but skips all ingestion.
   */
  async rebuildEstimates(
    id: string,
  ): Promise<{ points: number; estimates: number; snapshots: number }> {
    return this.gamesService.rebuildEstimateHistory(id);
  }

  async listTrustedSources(): Promise<
    (TrustedSource & { recordCount: number })[]
  > {
    const sources = await this.trustedSources.find({
      order: { active: 'DESC', weight: 'DESC', name: 'ASC' },
    });

    // Aggregate non-rejected milestones by the hostname of their sourceUrl,
    // then sum the counts of hostnames matching each source's host (exact
    // or subdomain — same rule as SourcesService.findByUrl).
    const rows = await this.milestones
      .createQueryBuilder('m')
      .select('m.sourceUrl', 'sourceUrl')
      .where('m.rejectedAt IS NULL')
      .andWhere('m.sourceUrl IS NOT NULL')
      .getRawMany<{ sourceUrl: string }>();

    const countsByHost = new Map<string, number>();
    for (const r of rows) {
      try {
        const host = new URL(r.sourceUrl).hostname
          .replace(/^www\./, '')
          .toLowerCase();
        countsByHost.set(host, (countsByHost.get(host) ?? 0) + 1);
      } catch {
        // skip URLs that don't parse — they can't be matched to a host anyway
      }
    }

    return sources.map((s) => {
      let recordCount = 0;
      if (s.host) {
        for (const [host, count] of countsByHost) {
          if (host === s.host || host.endsWith(`.${s.host}`)) {
            recordCount += count;
          }
        }
      }
      return Object.assign(s, { recordCount });
    });
  }

  async deleteTrustedSource(id: string): Promise<{ deleted: boolean }> {
    const result = await this.trustedSources.delete(id);
    return { deleted: (result.affected ?? 0) > 0 };
  }

  async issues(): Promise<AdminIssues> {
    const [undatedRows, undatedCount] = await this.milestones
      .createQueryBuilder('m')
      .innerJoin('m.game', 'g')
      .addSelect('g.name', 'gameName')
      .where('m.reportedAt IS NULL')
      .andWhere('m.rejectedAt IS NULL')
      .orderBy('m.capturedAt', 'DESC')
      .limit(ISSUE_PREVIEW_LIMIT)
      .getManyAndCount();
    const undatedNames = await this.gameNameMap(
      undatedRows.map((r) => r.gameId),
    );

    // Suspect quotes: pull a bounded recent window and apply the regex
    // filter in-memory. We deliberately limit this scan to avoid scanning
    // the full table on every dashboard refresh.
    const recentForScan = await this.milestones
      .createQueryBuilder('m')
      .innerJoin('m.game', 'g')
      .where('m.note IS NOT NULL')
      .andWhere('m.rejectedAt IS NULL')
      .orderBy('m.capturedAt', 'DESC')
      .limit(2000)
      .getMany();
    const suspectAll = recentForScan.filter(
      (m) => m.note && isPeriodicQuote(m.note),
    );
    const suspectNames = await this.gameNameMap(
      suspectAll.map((s) => s.gameId),
    );

    // Stale games: no STEAM_REVIEWS signal in the last STALE_DAYS.
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000);
    const staleRows = await this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's', 's.metric = :m', {
        m: SignalMetric.STEAM_REVIEWS,
      })
      .select(['g.id AS "gameId"', 'g.name AS "gameName"'])
      .addSelect('MAX(s.capturedAt)', 'lastSignalAt')
      .groupBy('g.id')
      .having('MAX(s.capturedAt) IS NULL OR MAX(s.capturedAt) < :cutoff', {
        cutoff: staleCutoff,
      })
      .limit(ISSUE_PREVIEW_LIMIT)
      .getRawMany<{
        gameId: string;
        gameName: string;
        lastSignalAt: Date | null;
      }>();
    const staleTotalRow = await this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's', 's.metric = :m', {
        m: SignalMetric.STEAM_REVIEWS,
      })
      .select('COUNT(DISTINCT g.id)', 'c')
      .groupBy('g.id')
      .having('MAX(s.capturedAt) IS NULL OR MAX(s.capturedAt) < :cutoff', {
        cutoff: staleCutoff,
      })
      .getRawMany<{ c: string }>();
    const staleTotal = staleTotalRow.length;

    // Inactive trusted sources: never produced any milestone.
    const inactiveRows = await this.trustedSources
      .createQueryBuilder('ts')
      .leftJoin(
        Milestone,
        'm',
        // Heuristic: match by sourceUrl host or matching tier — we don't
        // have a direct FK from milestone to trusted_source. Fall back to
        // entries flagged inactive in the registry.
        "ts.host IS NOT NULL AND m.sourceUrl ILIKE '%' || ts.host || '%'",
      )
      .where('ts.active = false OR m.id IS NULL')
      .andWhere('ts.host IS NOT NULL')
      .groupBy('ts.id')
      .having('COUNT(m.id) = 0')
      .orderBy('ts.name', 'ASC')
      .getMany();

    // Estimation discrepancies: declared figures that were >=2× off (or
    // <=0.5×) from the prior estimate at the time they arrived. Rows are
    // frozen at detection so recalibration doesn't hide past misses.
    const [discrepancyRows, discrepancyCount] = await this.discrepancies
      .createQueryBuilder('d')
      .innerJoin('d.game', 'g')
      .addSelect('g.name', 'gameName')
      .orderBy('GREATEST(d.ratio, 1.0 / NULLIF(d.ratio, 0))', 'DESC')
      .limit(ISSUE_PREVIEW_LIMIT)
      .getManyAndCount();
    const discrepancyNames = await this.gameNameMap(
      discrepancyRows.map((d) => d.gameId),
    );

    // Games tracked but never received a single signal snapshot.
    const noSignalRows = await this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's')
      .select(['g.id AS id', 'g.name AS name', 'g.slug AS slug'])
      .groupBy('g.id')
      .having('COUNT(s.id) = 0')
      .limit(ISSUE_PREVIEW_LIMIT)
      .getRawMany<{ id: string; name: string; slug: string }>();
    const noSignalTotalRows = await this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's')
      .select('g.id')
      .groupBy('g.id')
      .having('COUNT(s.id) = 0')
      .getRawMany();
    const noSignalTotal = noSignalTotalRows.length;

    return {
      undatedMilestones: {
        count: undatedCount,
        items: undatedRows.slice(0, ISSUE_PREVIEW_LIMIT).map((r) => ({
          ...r,
          gameName: undatedNames.get(r.gameId) ?? '',
        })),
      },
      suspectQuotes: {
        count: suspectAll.length,
        items: suspectAll.slice(0, ISSUE_PREVIEW_LIMIT).map((r) => ({
          ...r,
          gameName: suspectNames.get(r.gameId) ?? '',
        })),
      },
      staleGames: {
        count: staleTotal,
        items: staleRows.slice(0, ISSUE_PREVIEW_LIMIT),
      },
      inactiveTrustedSources: {
        count: inactiveRows.length,
        items: inactiveRows.slice(0, ISSUE_PREVIEW_LIMIT),
      },
      gamesWithoutAnySignal: {
        count: noSignalTotal,
        items: noSignalRows,
      },
      estimationDiscrepancies: {
        count: discrepancyCount,
        items: discrepancyRows.map((d) => ({
          gameId: d.gameId,
          gameName: discrepancyNames.get(d.gameId) ?? '',
          platform: d.platform,
          declaredUnits: d.declaredUnits,
          declaredSource: d.declaredSource,
          declaredAt: d.declaredAt,
          priorEstimateLow: d.priorEstimateLow,
          priorEstimateHigh: d.priorEstimateHigh,
          ratio: d.ratio,
          detectedAt: d.detectedAt,
        })),
      },
    };
  }

  private async gameNameMap(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.games
      .createQueryBuilder('g')
      .select(['g.id AS id', 'g.name AS name'])
      .where('g.id IN (:...ids)', { ids: [...new Set(ids)] })
      .getRawMany<{ id: string; name: string }>();
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

// Raw queries return enum[] columns as the Postgres array literal
// "{PC,SWITCH}". Normalize it back to a string[] for the API payload.
function parsePlatforms(value: Platform[] | string | null): Platform[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value
    .replace(/^{|}$/g, '')
    .split(',')
    .map((p) => p.replace(/^"|"$/g, '').trim())
    .filter(Boolean) as Platform[];
}

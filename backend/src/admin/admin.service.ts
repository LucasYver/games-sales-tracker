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
  GameSource,
  LauncherProfile,
  Platform,
  ProcessedArticle,
  SalesEstimate,
  SalesRecord,
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

export interface UpdateGameInput {
  name?: string;
  releaseDate?: string | null;
  igdbId?: number | null;
  calibratedMultiplier?: number | null;
  calibratedPsMultiplier?: number | null;
  calibratedXboxMultiplier?: number | null;
  calibrationSourcePc?: SalesSource | null;
  calibrationSourcePs?: SalesSource | null;
  calibrationSourceXbox?: SalesSource | null;
}

export interface AdminStats {
  games: {
    total: number;
    withSales: number;
    withEstimate: number;
    withCalibration: number;
  };
  salesRecords: {
    total: number;
    bySource: Record<SalesSource, number>;
    byPlatform: Record<Platform, number>;
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
  calibratedMultiplier: number | null;
  calibratedPsMultiplier: number | null;
  calibratedXboxMultiplier: number | null;
  calibrationSourcePc: SalesSource | null;
  calibrationSourcePs: SalesSource | null;
  calibrationSourceXbox: SalesSource | null;
  salesRecordsCount: number;
  estimatesCount: number;
  latestReviews: number | null;
  latestReviewsAt: Date | null;
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
  pureEstimatedTodayLow: number | null;
  pureEstimatedTodayHigh: number | null;
  reconciliation: SerializedReconciliationEntry[];
}

export interface AdminGameDetail extends AdminGameSummary {
  igdbId: number | null;
  coverUrl: string | null;
  summary: string | null;
  lastRefreshedAt: Date | null;
  allTimePeakCcu: number | null;
  allTimePeakCcuAt: Date | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
    launcherProfile: LauncherProfile;
  } | null;
  sources: GameSource[];
  salesRecords: SalesRecord[];
  estimates: SalesEstimate[];
  signals: SignalSnapshot[];
  achievementSnapshots: AdminAchievementSummary[];
  estimateSnapshots: AdminEstimateSnapshot[];
}

export interface PaginatedAdmin<T> {
  items: T[];
  total: number;
}

export interface IssueGroup<T> {
  count: number;
  items: T[];
}

export interface AdminIssues {
  undatedSalesRecords: IssueGroup<SalesRecord & { gameName: string }>;
  suspectQuotes: IssueGroup<SalesRecord & { gameName: string }>;
  calibrationOutliers: IssueGroup<{
    gameId: string;
    gameName: string;
    platform: Platform;
    calibratedMultiplier: number;
  }>;
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

const CALIBRATION_LOW_BOUND = 6;
const CALIBRATION_HIGH_BOUND = 400;
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
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(SalesRecord)
    private readonly salesRecords: Repository<SalesRecord>,
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
    private readonly gamesService: GamesService,
  ) {}

  async stats(): Promise<AdminStats> {
    const [
      gamesTotal,
      gamesWithSales,
      gamesWithEstimate,
      gamesWithCalibration,
      salesTotal,
      salesUndated,
      bySourceRows,
      byPlatformRows,
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
        .innerJoin('g.salesRecords', 'sr', 'sr.rejectedAt IS NULL')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.games
        .createQueryBuilder('g')
        .innerJoin('g.estimates', 'e')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.games.count({ where: { calibratedMultiplier: undefined } as never }),
      this.salesRecords.count({ where: { rejectedAt: IsNull() } }),
      this.salesRecords.count({
        where: { reportedAt: IsNull(), rejectedAt: IsNull() },
      }),
      this.salesRecords
        .createQueryBuilder('sr')
        .where('sr.rejectedAt IS NULL')
        .select('sr.source', 'source')
        .addSelect('COUNT(*)', 'c')
        .groupBy('sr.source')
        .getRawMany<{ source: SalesSource; c: string }>(),
      this.salesRecords
        .createQueryBuilder('sr')
        .where('sr.rejectedAt IS NULL')
        .select('sr.platform', 'platform')
        .addSelect('COUNT(*)', 'c')
        .groupBy('sr.platform')
        .getRawMany<{ platform: Platform; c: string }>(),
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

    const byPlatform = Object.values(Platform).reduce(
      (acc, p) => {
        acc[p] = 0;
        return acc;
      },
      {} as Record<Platform, number>,
    );
    for (const row of byPlatformRows) byPlatform[row.platform] = Number(row.c);

    // Count games that have at least one calibrated Boxleiter multiplier
    // (PC, PlayStation or Xbox). Done in raw SQL because TypeORM's typed
    // where helpers don't compose well with multi-column "any not null".
    const calibrated = await this.games
      .createQueryBuilder('g')
      .where(
        'g.calibratedMultiplier IS NOT NULL ' +
          'OR g.calibratedPsMultiplier IS NOT NULL ' +
          'OR g.calibratedXboxMultiplier IS NOT NULL',
      )
      .getCount();

    return {
      games: {
        total: gamesTotal,
        withSales: Number(gamesWithSales?.c ?? 0),
        withEstimate: Number(gamesWithEstimate?.c ?? 0),
        withCalibration: calibrated,
      },
      salesRecords: {
        total: salesTotal,
        bySource,
        byPlatform,
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
    hasSales?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<PaginatedAdmin<AdminGameSummary>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const qb = this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's', 's.metric = :metric', {
        metric: SignalMetric.STEAM_REVIEWS,
      })
      .leftJoin('g.salesRecords', 'sr', 'sr.rejectedAt IS NULL')
      .leftJoin('g.estimates', 'e')
      .select([
        'g.id AS id',
        'g.name AS name',
        'g.slug AS slug',
        'g.releaseDate AS "releaseDate"',
        'g.isFree AS "isFree"',
        'g.platforms AS platforms',
        'g.calibratedMultiplier AS "calibratedMultiplier"',
        'g.calibratedPsMultiplier AS "calibratedPsMultiplier"',
        'g.calibratedXboxMultiplier AS "calibratedXboxMultiplier"',
        'g.calibrationSourcePc AS "calibrationSourcePc"',
        'g.calibrationSourcePs AS "calibrationSourcePs"',
        'g.calibrationSourceXbox AS "calibrationSourceXbox"',
        'g.createdAt AS "createdAt"',
        'g.updatedAt AS "updatedAt"',
      ])
      .addSelect('COUNT(DISTINCT sr.id)', 'salesRecordsCount')
      .addSelect('COUNT(DISTINCT e.id)', 'estimatesCount')
      .addSelect('MAX(s.value)', 'latestReviews')
      .addSelect('MAX(s.capturedAt)', 'latestReviewsAt')
      .groupBy('g.id');

    if (opts.q && opts.q.trim()) {
      qb.andWhere('g.name ILIKE :q', { q: `%${opts.q.trim()}%` });
    }
    if (opts.platform) {
      qb.andWhere(
        'g.platforms @> ARRAY[:platform]::game_platforms_enum[]',
        { platform: opts.platform },
      );
    }
    if (opts.hasSales === true) {
      qb.andHaving('COUNT(DISTINCT sr.id) > 0');
    } else if (opts.hasSales === false) {
      qb.andHaving('COUNT(DISTINCT sr.id) = 0');
    }

    const countQb = this.games.createQueryBuilder('g');
    if (opts.q && opts.q.trim()) {
      countQb.andWhere('g.name ILIKE :q', { q: `%${opts.q.trim()}%` });
    }
    if (opts.platform) {
      countQb.andWhere(
        'g.platforms @> ARRAY[:platform]::game_platforms_enum[]',
        { platform: opts.platform },
      );
    }
    // hasSales filter doesn't influence total here since we don't replicate
    // the HAVING; admin-table totals are approximate when that filter is on.

    const rawRows = await qb
      .orderBy('g.updatedAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string;
        slug: string;
        releaseDate: Date | null;
        isFree: boolean;
        platforms: string | Platform[];
        calibratedMultiplier: string | null;
        calibratedPsMultiplier: string | null;
        calibratedXboxMultiplier: string | null;
        calibrationSourcePc: SalesSource | null;
        calibrationSourcePs: SalesSource | null;
        calibrationSourceXbox: SalesSource | null;
        createdAt: Date;
        updatedAt: Date;
        salesRecordsCount: string;
        estimatesCount: string;
        latestReviews: string | null;
        latestReviewsAt: Date | null;
      }>();

    const total = await countQb.getCount();

    const items: AdminGameSummary[] = rawRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      releaseDate: r.releaseDate,
      isFree: r.isFree,
      platforms: parsePlatforms(r.platforms),
      calibratedMultiplier:
        r.calibratedMultiplier == null ? null : Number(r.calibratedMultiplier),
      calibratedPsMultiplier:
        r.calibratedPsMultiplier == null
          ? null
          : Number(r.calibratedPsMultiplier),
      calibratedXboxMultiplier:
        r.calibratedXboxMultiplier == null
          ? null
          : Number(r.calibratedXboxMultiplier),
      calibrationSourcePc: r.calibrationSourcePc,
      calibrationSourcePs: r.calibrationSourcePs,
      calibrationSourceXbox: r.calibrationSourceXbox,
      salesRecordsCount: Number(r.salesRecordsCount ?? 0),
      estimatesCount: Number(r.estimatesCount ?? 0),
      latestReviews: r.latestReviews == null ? null : Number(r.latestReviews),
      latestReviewsAt: r.latestReviewsAt,
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
        salesRecords: true,
        estimates: true,
        publisherRecord: true,
      },
    });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    const visibleSalesRecords = game.salesRecords.filter(
      (sr) => sr.rejectedAt == null,
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
        pureEstimatedTodayLow: s.pureEstimatedTodayLow,
        pureEstimatedTodayHigh: s.pureEstimatedTodayHigh,
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
      calibratedMultiplier: game.calibratedMultiplier,
      calibratedPsMultiplier: game.calibratedPsMultiplier,
      calibratedXboxMultiplier: game.calibratedXboxMultiplier,
      calibrationSourcePc: game.calibrationSourcePc,
      calibrationSourcePs: game.calibrationSourcePs,
      calibrationSourceXbox: game.calibrationSourceXbox,
      salesRecordsCount: visibleSalesRecords.length,
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
      lastRefreshedAt: game.lastRefreshedAt,
      publisher: game.publisher,
      publisherRecord: game.publisherRecord
        ? {
            id: game.publisherRecord.id,
            name: game.publisherRecord.name,
            launcherProfile: game.publisherRecord.launcherProfile,
          }
        : null,
      sources: game.sources,
      salesRecords: visibleSalesRecords.sort(
        (a, b) =>
          (b.reportedAt?.getTime() ?? 0) - (a.reportedAt?.getTime() ?? 0),
      ),
      estimates: game.estimates,
      signals,
      achievementSnapshots,
      estimateSnapshots,
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
        if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
        return a.source.localeCompare(b.source);
      });
  }

  async deleteGame(id: string): Promise<{ deleted: boolean }> {
    const result = await this.games.delete(id);
    return { deleted: (result.affected ?? 0) > 0 };
  }

  /**
   * Patch a game's editable metadata. Currently supports name, releaseDate
   * and igdbId. When name changes, the slug is regenerated and de-duplicated
   * against existing games (collisions get a numeric suffix).
   */
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

    // Calibrated multipliers must always travel with their source (the entity
    // contract says "always populated when the corresponding multiplier is").
    // Setting one without the other would break downstream confidence logic
    // (CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE).
    this.applyCalibration(
      game,
      'calibratedMultiplier',
      'calibrationSourcePc',
      'PC',
      input.calibratedMultiplier,
      input.calibrationSourcePc,
    );
    this.applyCalibration(
      game,
      'calibratedPsMultiplier',
      'calibrationSourcePs',
      'PlayStation',
      input.calibratedPsMultiplier,
      input.calibrationSourcePs,
    );
    this.applyCalibration(
      game,
      'calibratedXboxMultiplier',
      'calibrationSourceXbox',
      'Xbox',
      input.calibratedXboxMultiplier,
      input.calibrationSourceXbox,
    );

    return this.games.save(game);
  }

  private applyCalibration(
    game: Game,
    multiplierField:
      | 'calibratedMultiplier'
      | 'calibratedPsMultiplier'
      | 'calibratedXboxMultiplier',
    sourceField:
      | 'calibrationSourcePc'
      | 'calibrationSourcePs'
      | 'calibrationSourceXbox',
    label: string,
    multiplier: number | null | undefined,
    source: SalesSource | null | undefined,
  ): void {
    if (multiplier === undefined && source === undefined) return;

    const nextMultiplier =
      multiplier === undefined ? game[multiplierField] : multiplier;
    const nextSource = source === undefined ? game[sourceField] : source;

    if (nextMultiplier === null) {
      game[multiplierField] = null;
      game[sourceField] = null;
      return;
    }

    if (!Number.isFinite(nextMultiplier) || nextMultiplier <= 0) {
      throw new BadRequestException(
        `${label} calibrated multiplier must be a positive number`,
      );
    }
    if (!nextSource) {
      throw new BadRequestException(
        `${label} calibrated multiplier requires a calibration source`,
      );
    }

    game[multiplierField] = nextMultiplier;
    game[sourceField] = nextSource;
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

  async listSalesRecords(opts: {
    gameId?: string;
    source?: SalesSource;
    platform?: Platform;
    undated?: boolean;
    suspect?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<PaginatedAdmin<SalesRecord & { gameName: string }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const qb = this.salesRecords
      .createQueryBuilder('sr')
      .innerJoin('sr.game', 'g')
      .addSelect('g.name', 'gameName')
      .where('sr.rejectedAt IS NULL')
      .orderBy('sr.capturedAt', 'DESC');

    if (opts.gameId) qb.andWhere('sr.gameId = :gid', { gid: opts.gameId });
    if (opts.source) qb.andWhere('sr.source = :src', { src: opts.source });
    if (opts.platform) qb.andWhere('sr.platform = :pf', { pf: opts.platform });
    if (opts.undated) qb.andWhere('sr.reportedAt IS NULL');

    const [entities, raws, total] = await Promise.all([
      qb.clone().offset(offset).limit(limit).getMany(),
      qb.clone().offset(offset).limit(limit).getRawMany<{ gameName: string }>(),
      qb.clone().getCount(),
    ]);

    let items = entities.map((sr, i) => ({
      ...sr,
      gameName: raws[i]?.gameName ?? '',
    }));

    if (opts.suspect) {
      items = items.filter((sr) => sr.note && isPeriodicQuote(sr.note));
    }

    return { items, total };
  }

  /**
   * Soft-delete: mark the record as rejected instead of hard-deleting it.
   * The row is then hidden from every read (admin + public) AND used as an
   * ingestion fingerprint guard so the next refresh can't re-create it.
   */
  async deleteSalesRecord(id: string): Promise<{ deleted: boolean }> {
    const result = await this.salesRecords.update(
      { id, rejectedAt: IsNull() },
      { rejectedAt: new Date() },
    );
    return { deleted: (result.affected ?? 0) > 0 };
  }

  async listTrustedSources(): Promise<(TrustedSource & { recordCount: number })[]> {
    const sources = await this.trustedSources.find({
      order: { active: 'DESC', weight: 'DESC', name: 'ASC' },
    });

    // Aggregate non-rejected sales records by the hostname of their sourceUrl,
    // then sum the counts of hostnames matching each source's host (exact or
    // subdomain — same rule as SourcesService.findByUrl).
    const rows = await this.salesRecords
      .createQueryBuilder('sr')
      .select('sr.sourceUrl', 'sourceUrl')
      .where('sr.rejectedAt IS NULL')
      .andWhere('sr.sourceUrl IS NOT NULL')
      .getRawMany<{ sourceUrl: string }>();

    const countsByHost = new Map<string, number>();
    for (const r of rows) {
      try {
        const host = new URL(r.sourceUrl)
          .hostname.replace(/^www\./, '')
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
    const [undatedRows, undatedCount] = await this.salesRecords
      .createQueryBuilder('sr')
      .innerJoin('sr.game', 'g')
      .addSelect('g.name', 'gameName')
      .where('sr.reportedAt IS NULL')
      .andWhere('sr.rejectedAt IS NULL')
      .orderBy('sr.capturedAt', 'DESC')
      .limit(ISSUE_PREVIEW_LIMIT)
      .getManyAndCount();
    const undatedNames = await this.gameNameMap(undatedRows.map((r) => r.gameId));

    // Suspect quotes: pull a bounded recent window and apply the regex
    // filter in-memory. We deliberately limit this scan to avoid scanning
    // the full table on every dashboard refresh.
    const recentForScan = await this.salesRecords
      .createQueryBuilder('sr')
      .innerJoin('sr.game', 'g')
      .where('sr.note IS NOT NULL')
      .andWhere('sr.rejectedAt IS NULL')
      .orderBy('sr.capturedAt', 'DESC')
      .limit(2000)
      .getMany();
    const suspectAll = recentForScan.filter(
      (sr) => sr.note && isPeriodicQuote(sr.note),
    );
    const suspectNames = await this.gameNameMap(suspectAll.map((s) => s.gameId));

    // Calibration outliers: any per-platform calibrated multiplier sitting
    // near the plausible-bounds edges, across PC / PlayStation / Xbox.
    const calibrationRows = await this.games
      .createQueryBuilder('g')
      .select(['g.id AS "gameId"', 'g.name AS "gameName"'])
      .addSelect('g.calibratedMultiplier', 'pc')
      .addSelect('g.calibratedPsMultiplier', 'ps')
      .addSelect('g.calibratedXboxMultiplier', 'xbox')
      .where(
        '(g.calibratedMultiplier IS NOT NULL AND (g.calibratedMultiplier < :low OR g.calibratedMultiplier > :high)) ' +
          'OR (g.calibratedPsMultiplier IS NOT NULL AND (g.calibratedPsMultiplier < :low OR g.calibratedPsMultiplier > :high)) ' +
          'OR (g.calibratedXboxMultiplier IS NOT NULL AND (g.calibratedXboxMultiplier < :low OR g.calibratedXboxMultiplier > :high))',
        { low: CALIBRATION_LOW_BOUND, high: CALIBRATION_HIGH_BOUND },
      )
      .getRawMany<{
        gameId: string;
        gameName: string;
        pc: string | null;
        ps: string | null;
        xbox: string | null;
      }>();

    const calibrationOutliers: {
      gameId: string;
      gameName: string;
      platform: Platform;
      calibratedMultiplier: number;
    }[] = [];
    for (const row of calibrationRows) {
      const push = (platform: Platform, value: string | null) => {
        if (value == null) return;
        const m = Number(value);
        if (m < CALIBRATION_LOW_BOUND || m > CALIBRATION_HIGH_BOUND) {
          calibrationOutliers.push({
            gameId: row.gameId,
            gameName: row.gameName,
            platform,
            calibratedMultiplier: m,
          });
        }
      };
      push(Platform.PC, row.pc);
      push(Platform.PLAYSTATION, row.ps);
      push(Platform.XBOX, row.xbox);
    }
    calibrationOutliers.sort(
      (a, b) => b.calibratedMultiplier - a.calibratedMultiplier,
    );

    // Stale games: no STEAM_REVIEWS signal in the last STALE_DAYS.
    const staleCutoff = new Date(
      Date.now() - STALE_DAYS * 24 * 3600 * 1000,
    );
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
      .getRawMany<{ gameId: string; gameName: string; lastSignalAt: Date | null }>();
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

    // Inactive trusted sources: never produced any record.
    const inactiveRows = await this.trustedSources
      .createQueryBuilder('ts')
      .leftJoin(
        SalesRecord,
        'sr',
        // Heuristic: match by sourceUrl host or matching tier — we don't have
        // a direct FK from sales_record to trusted_source. Fall back to
        // entries flagged inactive in the registry.
        'ts.host IS NOT NULL AND sr.sourceUrl ILIKE \'%\' || ts.host || \'%\'',
      )
      .where('ts.active = false OR sr.id IS NULL')
      .andWhere('ts.host IS NOT NULL')
      .groupBy('ts.id')
      .having('COUNT(sr.id) = 0')
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
      undatedSalesRecords: {
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
      calibrationOutliers: {
        count: calibrationOutliers.length,
        items: calibrationOutliers.slice(0, ISSUE_PREVIEW_LIMIT),
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository, IsNull } from 'typeorm';
import {
  Game,
  GameSource,
  Platform,
  ProcessedArticle,
  SalesEstimate,
  SalesRecord,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
  TrustedSource,
} from '../entities';
import { isPeriodicQuote } from '../ingestion/sales-figure.utils';
import { slugify } from '../common/slug';

export interface UpdateGameInput {
  name?: string;
  releaseDate?: string | null;
  igdbId?: number | null;
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
  salesRecordsCount: number;
  estimatesCount: number;
  latestReviews: number | null;
  latestReviewsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminGameDetail extends AdminGameSummary {
  igdbId: number | null;
  coverUrl: string | null;
  summary: string | null;
  sources: GameSource[];
  salesRecords: SalesRecord[];
  estimates: SalesEstimate[];
  signals: SignalSnapshot[];
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
        .innerJoin('g.salesRecords', 'sr')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.games
        .createQueryBuilder('g')
        .innerJoin('g.estimates', 'e')
        .select('COUNT(DISTINCT g.id)', 'c')
        .getRawOne<{ c: string }>(),
      this.games.count({ where: { calibratedMultiplier: undefined } as never }),
      this.salesRecords.count(),
      this.salesRecords.count({ where: { reportedAt: IsNull() } }),
      this.salesRecords
        .createQueryBuilder('sr')
        .select('sr.source', 'source')
        .addSelect('COUNT(*)', 'c')
        .groupBy('sr.source')
        .getRawMany<{ source: SalesSource; c: string }>(),
      this.salesRecords
        .createQueryBuilder('sr')
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
      .leftJoin('g.salesRecords', 'sr')
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
      },
    });
    if (!game) throw new NotFoundException(`Game ${id} not found`);

    const signals = await this.signals.find({
      where: { gameId: id },
      order: { capturedAt: 'DESC' },
      take: 200,
    });

    const latestReviews = signals.find(
      (s) => s.metric === SignalMetric.STEAM_REVIEWS,
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
      salesRecordsCount: game.salesRecords.length,
      estimatesCount: game.estimates.length,
      latestReviews: latestReviews?.value ?? null,
      latestReviewsAt: latestReviews?.capturedAt ?? null,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      igdbId: game.igdbId,
      coverUrl: game.coverUrl,
      summary: game.summary,
      sources: game.sources,
      salesRecords: game.salesRecords.sort(
        (a, b) =>
          (b.reportedAt?.getTime() ?? 0) - (a.reportedAt?.getTime() ?? 0),
      ),
      estimates: game.estimates,
      signals,
    };
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

  async deleteSalesRecord(id: string): Promise<{ deleted: boolean }> {
    const result = await this.salesRecords.delete(id);
    return { deleted: (result.affected ?? 0) > 0 };
  }

  async listTrustedSources(): Promise<TrustedSource[]> {
    return this.trustedSources.find({
      order: { active: 'DESC', weight: 'DESC', name: 'ASC' },
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

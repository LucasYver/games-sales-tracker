import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, Or, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  ConfidenceLevel,
  EstimateSnapshot,
  EstimationDiscrepancy,
  Game,
  Platform,
  SalesEstimate,
  SalesRecord,
  SalesSource,
  SerializedReconciliationEntry,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import type { Agreement } from '../entities';
import {
  AGGREGATED_METHOD_CODE,
  EstimationMethodService,
} from '../estimation/estimation-method.service';
import { EstimationService } from '../estimation/estimation.service';
import {
  AGREEMENT_GROWTH_PER_YEAR,
  AGREEMENT_OVERSHOOT_RATIO,
  DISCREPANCY_RATIO_HIGH,
  DISCREPANCY_RATIO_LOW,
  FALLBACK_ANNUAL_GROWTH,
  FALLBACK_GROWTH_CAP_YEARS,
  FRESHNESS_MIN_HEADROOM,
  FRESHNESS_VARIANCE_BUFFER,
  PC_DOMINANCE_RATIO_THRESHOLD,
  ageInDays,
  ageInYears,
  lifetimeSalesPct,
} from './sales-modeling.constants';

export interface PopularGame {
  id: string;
  name: string;
  slug: string;
  releaseDate: Date | null;
  coverUrl: string | null;
  platforms: Platform[];
  genres: string[];
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
}

export interface GenreOption {
  name: string;
  count: number;
}

export interface PaginatedGames {
  items: PopularGame[];
  total: number;
}

export type DisplaySource = SalesSource | 'ESTIMATE';

// How a declared figure compares to our independent estimate for the same
// platform. 'strong' = estimate range brackets the figure; 'weak' = off but
// plausible (e.g. growth since an old figure); 'conflict' = they disagree
// beyond what time/uncertainty explains, flagging a figure or model to review.
// Defined in entities/enums.ts; re-exported here for backwards compatibility.
export { type Agreement } from '../entities';

export interface PlatformSales {
  platform: Platform;
  low: number;
  high: number;
  source: DisplaySource;
  confidence: ConfidenceLevel | null;
  sourceUrl: string | null;
  // Set on declared lines that also have an estimate to cross-check against.
  agreement: Agreement | null;
}

// Side-by-side comparison of a platform's declared figure and our estimate.
export interface ReconciliationEntry {
  platform: Platform;
  declaredUnits: number;
  declaredSource: SalesSource;
  declaredAt: Date | null;
  estimateLow: number;
  estimateHigh: number;
  estimateMethod: string;
  agreement: Agreement;
  // estimate midpoint / declared figure. >1 = we estimate more than declared.
  ratio: number;
  detail: string;
}

export interface TotalSales {
  low: number;
  high: number;
  // 'reported' = an authoritative worldwide figure (e.g. Wikipedia/official);
  // 'sum' = our per-platform figures added up.
  basis: 'reported' | 'sum';
  sources: DisplaySource[];
  source: DisplaySource | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: Date | null;
  confidence: ConfidenceLevel | null;
}

// A single dated sales figure, kept for the timeline so the same game can show
// how its reported sales evolved over time across sources.
export interface StoreRatings {
  steam: { reviews: number } | null;
  playstation: { reviews: number; score: number | null } | null;
  xbox: { reviews: number; score: number | null } | null;
}

/**
 * One historical point of the headline reconciled estimate, exposed on the
 * public game detail to draw the sales-over-time chart. Mirrors the admin
 * `AdminEstimateSnapshot` but stripped of the internal reconciliation jsonb.
 */
export interface PublicEstimateSnapshot {
  computedAt: Date;
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
}

// Higher value = more reliable. Used to pick the best figure per platform.
const SOURCE_PRIORITY: Record<SalesSource, number> = {
  [SalesSource.OFFICIAL]: 3,
  [SalesSource.ANNOUNCEMENT]: 2,
  [SalesSource.WIKIPEDIA]: 1,
  [SalesSource.MEDIA]: 1,
};

const DEFAULT_CONFIDENCE: Record<SalesSource, ConfidenceLevel> = {
  [SalesSource.OFFICIAL]: ConfidenceLevel.HIGH,
  [SalesSource.WIKIPEDIA]: ConfidenceLevel.MEDIUM,
  [SalesSource.ANNOUNCEMENT]: ConfidenceLevel.MEDIUM,
  [SalesSource.MEDIA]: ConfidenceLevel.MEDIUM,
};

function serializeReconciliationEntry(
  entry: ReconciliationEntry,
): SerializedReconciliationEntry {
  return {
    ...entry,
    declaredAt: entry.declaredAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(EstimateSnapshot)
    private readonly estimateSnapshots: Repository<EstimateSnapshot>,
    @InjectRepository(EstimationDiscrepancy)
    private readonly discrepancies: Repository<EstimationDiscrepancy>,
    @InjectRepository(SalesRecord)
    private readonly salesRecords: Repository<SalesRecord>,
    private readonly estimation: EstimationService,
    private readonly estimationMethods: EstimationMethodService,
  ) {}

  /**
   * Resolve a free-form article title to a tracked game. Uses trigram
   * word_similarity so the game name only has to appear as a fragment of the
   * headline (e.g. "Helldivers 2" within "Helldivers 2 tops 12m sales"). A
   * strict threshold avoids false matches; null when nothing is confident.
   */
  async matchByTitle(title: string, threshold = 0.6): Promise<Game | null> {
    const trimmed = title.trim();
    if (trimmed.length < 3) return null;

    return this.games
      .createQueryBuilder('g')
      .where('word_similarity(g.name, :title) >= :threshold', {
        title: trimmed,
        threshold,
      })
      .orderBy('word_similarity(g.name, :title)', 'DESC')
      .addOrderBy('length(g.name)', 'DESC')
      .limit(1)
      .getOne();
  }

  async search(query: string, limit = 20): Promise<Game[]> {
    const trimmed = query.trim();

    if (!trimmed) {
      return this.games.find({ take: limit, order: { releaseDate: 'DESC' } });
    }

    // Trigram search via word_similarity: compares the query against the
    // best-matching fragment of the title, so short typo-prone queries
    // still rank their full game. ILIKE fallback catches short substrings.
    return this.games
      .createQueryBuilder('g')
      .where('word_similarity(:q, g.name) > 0.3', { q: trimmed })
      .orWhere('g.name ILIKE :pattern', { pattern: `%${trimmed}%` })
      .orderBy('word_similarity(:q, g.name)', 'DESC')
      .addOrderBy('g.releaseDate', 'DESC', 'NULLS LAST')
      .limit(limit)
      .getMany();
  }

  async listPopular(
    options: {
      limit?: number;
      sort?: 'popular' | 'recent' | 'oldest';
      platform?: string;
      offset?: number;
      genre?: string;
      status?: 'released' | 'new' | 'upcoming';
      yearMin?: number;
      yearMax?: number;
      minReviews?: number;
    } = {},
  ): Promise<PaginatedGames> {
    const {
      limit = 24,
      sort = 'popular',
      platform,
      offset = 0,
      genre,
      status,
      yearMin,
      yearMax,
      minReviews,
    } = options;

    const qb = this.games
      .createQueryBuilder('g')
      .leftJoin('g.signals', 's', 's.metric = :metric', {
        metric: SignalMetric.STEAM_REVIEWS,
      })
      .select('g.id', 'id')
      .addSelect('g.name', 'name')
      .addSelect('g.slug', 'slug')
      .addSelect('g.releaseDate', 'releaseDate')
      .addSelect('g.coverUrl', 'coverUrl')
      .addSelect('g.platforms', 'platforms')
      .addSelect('g.genres', 'genres')
      .addSelect('g.isFree', 'isFree')
      .addSelect('COALESCE(MAX(s.value), 0)', 'reviews')
      .groupBy('g.id');

    const countQb = this.games.createQueryBuilder('g');

    // Apply identical row-level filters to both query builders so the
    // pagination total stays consistent with the visible page.
    const applyRowFilters = (target: typeof qb) => {
      if (platform) {
        // PostgreSQL enum-array containment: platforms @> ARRAY['X']::platform_enum[]
        target.andWhere(
          `g.platforms @> ARRAY[:platform]::game_platforms_enum[]`,
          { platform },
        );
      }

      if (genre) {
        // `genres` is stored as a comma-separated `simple-array`; match whole
        // tokens (with optional surrounding spaces) so "RPG" doesn't
        // accidentally hit "Role-playing (RPG)" via substring.
        target.andWhere(
          `string_to_array(g.genres, ',') ` +
            `&& ARRAY[:genre, ' ' || :genre, :genre || ' ', ' ' || :genre || ' ']`,
          { genre },
        );
      }

      if (status === 'upcoming') {
        target.andWhere('g.releaseDate > NOW()');
      } else if (status === 'released') {
        target.andWhere('g.releaseDate <= NOW()');
      } else if (status === 'new') {
        target.andWhere(
          `g.releaseDate <= NOW() AND g.releaseDate >= NOW() - INTERVAL '30 days'`,
        );
      }

      if (yearMin != null) {
        target.andWhere(`EXTRACT(YEAR FROM g.releaseDate) >= :yearMin`, {
          yearMin,
        });
      }

      if (yearMax != null) {
        target.andWhere(`EXTRACT(YEAR FROM g.releaseDate) <= :yearMax`, {
          yearMax,
        });
      }
    };

    applyRowFilters(qb);
    applyRowFilters(countQb);

    // `minReviews` filters on an aggregate, so it must go through HAVING on
    // the grouped query and be counted via a wrapping subquery.
    if (minReviews != null && minReviews > 0) {
      qb.having('COALESCE(MAX(s.value), 0) >= :minReviews', { minReviews });
    }

    if (sort === 'recent') {
      qb.orderBy('g.releaseDate', 'DESC', 'NULLS LAST');
    } else if (sort === 'oldest') {
      qb.orderBy('g.releaseDate', 'ASC', 'NULLS LAST');
    } else {
      qb.orderBy('reviews', 'DESC');
    }

    // When a HAVING filter is in play we can't rely on getCount() (which
    // ignores GROUP BY/HAVING); count rows of the grouped projection instead.
    const totalPromise =
      minReviews != null && minReviews > 0
        ? qb
            .clone()
            .offset(0)
            .limit(undefined)
            .getRawMany()
            .then((r) => r.length)
        : countQb.getCount();

    const [rows, total] = await Promise.all([
      qb.offset(offset).limit(limit).getRawMany<{
        id: string;
        name: string;
        slug: string;
        releaseDate: Date | null;
        coverUrl: string | null;
        platforms: Platform[];
        genres: string | null;
        isFree: boolean;
        reviews: string;
      }>(),
      totalPromise,
    ]);

    const latestByGame = await this.latestReconciledEstimates(
      rows.map((r) => r.id),
    );

    const items = rows.map((r) => {
      const estimate = latestByGame.get(r.id);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        releaseDate: r.releaseDate,
        coverUrl: r.coverUrl,
        platforms: this.parsePlatforms(r.platforms),
        genres: this.parseGenres(r.genres),
        isFree: r.isFree,
        reviews: Number(r.reviews),
        estimatedLow: estimate?.low ?? null,
        estimatedHigh: estimate?.high ?? null,
      };
    });

    return { items, total };
  }

  /**
   * Distinct genres across all games with usage counts, sorted by popularity.
   * Powers the genre filter dropdown on the public list. Bare minimum count
   * filter to keep one-off / typo genres out of the UI.
   */
  async listGenres(): Promise<GenreOption[]> {
    const rows = await this.games.query<{ name: string; count: string }[]>(
      `
      SELECT trim(g) AS name, COUNT(*) AS count
      FROM (
        SELECT regexp_split_to_table(genres, ',') AS g
        FROM game
        WHERE genres IS NOT NULL AND genres <> ''
      ) sub
      WHERE trim(g) <> ''
      GROUP BY name
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC, name ASC
      `,
    );
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  private parseGenres(value: string | null): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  async getBySlug(slug: string) {
    const game = await this.games.findOne({
      where: { slug },
      relations: { sources: true, salesRecords: true },
    });

    if (!game) throw new NotFoundException(`Game "${slug}" not found`);

    const visibleSalesRecords = game.salesRecords.filter(
      (sr) => sr.rejectedAt == null,
    );

    const latestEstimates = await this.latestEstimatesByPlatform(game.id);

    const { breakdown, total, reconciliation, estimatedToday } =
      this.aggregateSales(
        visibleSalesRecords,
        latestEstimates,
        game.releaseDate,
      );

    const reviewHistory = await this.signals.find({
      where: { gameId: game.id, metric: SignalMetric.STEAM_REVIEWS },
      order: { capturedAt: 'ASC' },
      select: { capturedAt: true, value: true },
    });

    const storeRatings = await this.buildStoreRatings(game.id);

    const estimateSnapshotRows = await this.estimateSnapshots.find({
      where: { gameId: game.id },
      order: { computedAt: 'ASC' },
      select: {
        computedAt: true,
        estimatedTodayLow: true,
        estimatedTodayHigh: true,
      },
      take: 500,
    });
    const estimateSnapshots: PublicEstimateSnapshot[] =
      estimateSnapshotRows.map((s) => ({
        computedAt: s.computedAt,
        estimatedTodayLow: s.estimatedTodayLow,
        estimatedTodayHigh: s.estimatedTodayHigh,
      }));

    return {
      id: game.id,
      igdbId: game.igdbId,
      name: game.name,
      slug: game.slug,
      releaseDate: game.releaseDate,
      coverUrl: game.coverUrl,
      summary: game.summary,
      isFree: game.isFree,
      platforms: game.platforms,
      developer: game.developer,
      publisher: game.publisher,
      genres: game.genres ?? [],
      sources: game.sources,
      salesBreakdown: breakdown,
      totalSales: total,
      reconciliation,
      estimatedToday,
      estimateSnapshots,
      reviewHistory,
      storeRatings,
    };
  }

  private async buildStoreRatings(gameId: string): Promise<StoreRatings> {
    const metrics = [
      SignalMetric.STEAM_REVIEWS,
      SignalMetric.PS_RATINGS,
      SignalMetric.XBOX_RATINGS,
    ];

    const snapshots = await this.signals.find({
      where: { gameId, metric: In(metrics) },
      order: { capturedAt: 'DESC' },
      select: { metric: true, value: true, averageRating: true },
    });

    const latest = new Map<SignalMetric, (typeof snapshots)[0]>();
    for (const s of snapshots) {
      if (!latest.has(s.metric)) latest.set(s.metric, s);
    }

    const steam = latest.get(SignalMetric.STEAM_REVIEWS);
    const ps = latest.get(SignalMetric.PS_RATINGS);
    const xbox = latest.get(SignalMetric.XBOX_RATINGS);

    return {
      steam: steam ? { reviews: steam.value } : null,
      playstation: ps
        ? { reviews: ps.value, score: ps.averageRating ?? null }
        : null,
      xbox: xbox
        ? { reviews: xbox.value, score: xbox.averageRating ?? null }
        : null,
    };
  }

  /**
   * Persist a snapshot of the headline "today" range and the per-platform
   * reconciliation as they stand right now (or as they stood at `asOf` for
   * a historical replay). Idempotent: calling twice in the same second
   * for the same game produces two rows — callers that don't want
   * duplicates should dedupe upstream (the cron refresh is naturally
   * de-duped because it runs at most once a day per game).
   *
   * When `asOf` is provided, declared figures dated *after* `asOf` are
   * dropped (we reconstruct what the reconciliation would have looked
   * like at that point in time), and only the most recent estimate per
   * platform with `computedAt <= asOf` is considered.
   */
  async snapshotReconcile(gameId: string, asOf?: Date): Promise<void> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return;

    const records = await this.recordsAsOf(gameId, asOf);
    const estimates = await this.latestEstimatesByPlatform(gameId, asOf);
    const { reconciliation, estimatedToday } = this.aggregateSales(
      records,
      estimates,
      game.releaseDate,
    );

    if (!estimatedToday) return;

    // aggregateSales returns floats (freshness cap multiplies by a real
    // number); the column is `int`, so round before persisting.
    await this.estimateSnapshots.save(
      this.estimateSnapshots.create({
        gameId,
        estimatedTodayLow: Math.round(estimatedToday.low),
        estimatedTodayHigh: Math.round(estimatedToday.high),
        reconciliation: reconciliation.map(serializeReconciliationEntry),
        computedAt: asOf ?? new Date(),
      }),
    );
  }

  /**
   * Detect "model misses": records whose declared figure diverges by more
   * than DISCREPANCY_RATIO_HIGH (or less than DISCREPANCY_RATIO_LOW) from
   * the prior estimate that pre-dates the record.
   *
   * Each record produces at most one discrepancy row (unique on recordId).
   * Once written, the row is **never updated** — even if a later
   * recalibration aligns the live estimate with the figure, the frozen
   * miss remains as a paper trail of past model error.
   *
   * Lookup strategy for "prior estimate":
   *  - Reference moment T = record.reportedAt ?? record.capturedAt.
   *  - For platform = GLOBAL → take the latest EstimateSnapshot with
   *    computedAt < T (snapshot stores the aggregated total band).
   *  - For per-platform records → take the latest SalesEstimate for the
   *    same platform with computedAt < T (more precise than reading the
   *    snapshot JSON, which only contains entries for platforms that had
   *    a declared figure at T).
   *
   * Skipped silently when no prior estimate exists at T (e.g. first
   * declared figure ever for a brand-new game).
   */
  async evaluateDiscrepanciesForGame(gameId: string): Promise<number> {
    const records = await this.salesRecords.find({
      where: { gameId, rejectedAt: IsNull(), isEngagement: false },
    });
    if (records.length === 0) return 0;

    let created = 0;
    for (const record of records) {
      const existing = await this.discrepancies.findOne({
        where: { recordId: record.id },
      });
      if (existing) continue;

      const referenceMoment = record.reportedAt ?? record.capturedAt;
      if (!referenceMoment) continue;

      const prior = await this.findPriorEstimateBand(
        gameId,
        record.platform,
        referenceMoment,
      );
      if (!prior) continue;

      const mid = (prior.low + prior.high) / 2;
      if (mid <= 0) continue;
      const ratio = record.units / mid;

      if (ratio >= DISCREPANCY_RATIO_LOW && ratio <= DISCREPANCY_RATIO_HIGH) {
        continue;
      }

      await this.discrepancies.save(
        this.discrepancies.create({
          gameId,
          platform: record.platform,
          recordId: record.id,
          declaredUnits: record.units,
          declaredSource: record.source,
          declaredAt: record.reportedAt,
          priorEstimateLow: prior.low,
          priorEstimateHigh: prior.high,
          priorEstimateAt: prior.computedAt,
          ratio,
        }),
      );
      created++;
    }

    if (created > 0) {
      this.logger.warn(
        `[discrepancy] ${gameId}: ${created} new estimation miss(es) recorded`,
      );
    }
    return created;
  }

  private async findPriorEstimateBand(
    gameId: string,
    platform: Platform,
    before: Date,
  ): Promise<{ low: number; high: number; computedAt: Date } | null> {
    if (platform === Platform.GLOBAL) {
      const snap = await this.estimateSnapshots.findOne({
        where: { gameId, computedAt: LessThan(before) },
        order: { computedAt: 'DESC' },
      });
      if (!snap) return null;
      return {
        low: snap.estimatedTodayLow,
        high: snap.estimatedTodayHigh,
        computedAt: snap.computedAt,
      };
    }

    const estimate = await this.estimates.findOne({
      where: { gameId, platform, computedAt: LessThan(before) },
      order: { computedAt: 'DESC' },
    });
    if (!estimate) return null;
    return {
      low: estimate.estimatedLow,
      high: estimate.estimatedHigh,
      computedAt: estimate.computedAt,
    };
  }

  /**
   * Replay the entire estimate history for a game using current
   * multipliers and constants. This is the canonical recompute pathway:
   * the refresh flow calls it after every scrape (so a freshly arrived
   * declared figure can recalibrate the multiplier and propagate
   * backwards in time), and the admin "Refresh & rebuild" button hits
   * the same code path through `IngestionService.refreshGame`.
   *
   * Pipeline:
   *  1. `recalibrateAll`: re-derive `Game.calibrated*Multiplier` from
   *     the latest declared figures. Idempotent when nothing changed.
   *  2. Find every distinct signal-capture moment (SignalSnapshot ∪
   *     AchievementSnapshot), dedup at minute granularity.
   *  3. Wipe all existing SalesEstimate + EstimateSnapshot rows for the
   *     game (clean slate; estimates are derivatives, never primary data).
   *  4. For each capture moment T (ascending), run
   *     `EstimationService.computeAndStoreAt(gameId, T)` then
   *     `snapshotReconcile(gameId, T)`. Each step uses the multipliers
   *     **as they stand after step 1**, not whatever they were at T.
   *
   * Returns the count of (estimate, snapshot) rows produced.
   */
  async rebuildEstimateHistory(
    gameId: string,
  ): Promise<{ points: number; estimates: number; snapshots: number }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    await this.estimation.recalibrateAll(gameId);

    const moments = await this.collectCaptureMoments(gameId);
    this.logger.log(
      `[rebuild] "${game.name}" — ${moments.length} historical capture moments`,
    );

    await this.estimates.delete({ gameId });
    await this.estimateSnapshots.delete({ gameId });

    let estimates = 0;
    let snapshots = 0;
    for (const t of moments) {
      const inserted = await this.estimation.computeAndStoreAt(gameId, t);
      if (inserted.length === 0) continue;
      estimates += inserted.length;

      const before = await this.estimateSnapshots.count({ where: { gameId } });
      await this.snapshotReconcile(gameId, t);
      const after = await this.estimateSnapshots.count({ where: { gameId } });
      snapshots += after - before;
    }

    // After rebuilding, some records may now have a prior estimate band
    // to compare against. We never delete or rewrite existing
    // discrepancies, so this only fills the gaps.
    await this.evaluateDiscrepanciesForGame(gameId);

    return { points: moments.length, estimates, snapshots };
  }

  /**
   * Distinct minute-aligned capture timestamps across SignalSnapshot and
   * AchievementSnapshot for a game, ascending. Dedup at minute granularity
   * because a single cron run writes several signals within the same
   * second/minute — we want one rebuild point per refresh, not one per
   * signal.
   */
  private async collectCaptureMoments(gameId: string): Promise<Date[]> {
    const [signals, achievements] = await Promise.all([
      this.signals.find({
        where: { gameId },
        select: { capturedAt: true },
        order: { capturedAt: 'ASC' },
      }),
      this.achievements.find({
        where: { gameId },
        select: { capturedAt: true },
        order: { capturedAt: 'ASC' },
      }),
    ]);

    const byMinute = new Map<number, Date>();
    for (const row of [...signals, ...achievements]) {
      const t = row.capturedAt;
      const minuteKey = Math.floor(t.getTime() / 60_000);
      if (!byMinute.has(minuteKey)) byMinute.set(minuteKey, t);
    }
    return Array.from(byMinute.values()).sort(
      (a, b) => a.getTime() - b.getTime(),
    );
  }

  /**
   * Sales records visible at `asOf`. When `asOf` is undefined: all
   * records (live mode). When provided: records whose `reportedAt` is
   * before `asOf`, plus records with no `reportedAt` (knowledge whose
   * date we can't pin — we keep them rather than drop them silently).
   */
  private async recordsAsOf(
    gameId: string,
    asOf?: Date,
  ): Promise<SalesRecord[]> {
    if (!asOf) {
      return this.salesRecords.find({
        where: { gameId, rejectedAt: IsNull(), isEngagement: false },
      });
    }
    return this.salesRecords.find({
      where: {
        gameId,
        rejectedAt: IsNull(),
        isEngagement: false,
        reportedAt: Or(LessThanOrEqual(asOf), IsNull()),
      },
    });
  }

  /**
   * Build the per-platform breakdown and the headline total. For each platform
   * we keep the single most reliable figure (official > Wikipedia >
   * announcement > media), falling back to an estimate when no concrete
   * figure exists. A GLOBAL worldwide figure (e.g. Wikipedia) is not a
   * platform line: when present it becomes the authoritative reported total,
   * overriding the summed breakdown.
   */
  private aggregateSales(
    records: SalesRecord[],
    estimates: Map<Platform, SalesEstimate>,
    releaseDate: Date | null,
  ): {
    breakdown: PlatformSales[];
    total: TotalSales | null;
    reconciliation: ReconciliationEntry[];
    estimatedToday: { low: number; high: number } | null;
  } {
    const globalRecords: SalesRecord[] = [];
    const bestByPlatform = new Map<Platform, SalesRecord>();

    for (const record of records) {
      if (record.platform === Platform.GLOBAL) {
        globalRecords.push(record);
        continue;
      }
      const current = bestByPlatform.get(record.platform);
      if (!current || this.isMoreReliable(record, current)) {
        bestByPlatform.set(record.platform, record);
      }
    }

    // Pick the single most reliable global declared figure (if any) — used as
    // a floor + freshness-aware cap on the platform-summed estimate below.
    const bestGlobal = globalRecords.reduce<SalesRecord | null>(
      (best, r) => (!best || this.isMoreReliable(r, best) ? r : best),
      null,
    );

    const { reconciliation, estimatedToday } = this.reconcile(
      bestByPlatform,
      estimates,
      bestGlobal,
      releaseDate,
    );
    const agreementByPlatform = new Map<Platform, Agreement>(
      reconciliation.map((r) => [r.platform, r.agreement]),
    );
    // Headline-level cross-check: how the Boxleiter-derived "today" estimate
    // sits relative to the most reliable global declared figure. Used to
    // adjust the headline confidence (boost when corroborated, drop on
    // conflict).
    const globalAgreement =
      reconciliation.find((r) => r.platform === Platform.GLOBAL)?.agreement ??
      null;

    const breakdown: PlatformSales[] = [...bestByPlatform.values()].map(
      (r) => ({
        platform: r.platform,
        low: r.units,
        high: r.units,
        source: r.source,
        confidence: r.confidence ?? DEFAULT_CONFIDENCE[r.source],
        sourceUrl: r.sourceUrl,
        agreement: agreementByPlatform.get(r.platform) ?? null,
      }),
    );

    // Fall back to an estimate on any platform that has no concrete figure.
    for (const [platform, estimate] of estimates) {
      if (bestByPlatform.has(platform)) continue;
      breakdown.push({
        platform,
        low: estimate.estimatedLow,
        high: estimate.estimatedHigh,
        source: 'ESTIMATE',
        confidence: estimate.confidence,
        sourceUrl: null,
        agreement: null,
      });
    }

    breakdown.sort((a, b) => b.high - a.high);

    return {
      breakdown,
      total: this.buildTotal(breakdown, globalRecords, globalAgreement),
      reconciliation,
      estimatedToday,
    };
  }

  /**
   * Cross-check each platform's declared figure against our independent
   * estimate. Produces a reconciliation entry per platform that has both, and
   * a single "today" estimate: per platform we take the live value, treating a
   * declared figure as a floor sales can only have grown past (Level 2).
   */
  private reconcile(
    bestByPlatform: Map<Platform, SalesRecord>,
    estimates: Map<Platform, SalesEstimate>,
    globalDeclared: SalesRecord | null,
    releaseDate: Date | null,
  ): {
    reconciliation: ReconciliationEntry[];
    estimatedToday: { low: number; high: number } | null;
  } {
    const reconciliation: ReconciliationEntry[] = [];
    let todayLow = 0;
    let todayHigh = 0;
    let hasToday = false;

    const platforms = new Set<Platform>([
      ...bestByPlatform.keys(),
      ...estimates.keys(),
    ]);

    // Console-weight evidence: sum of every declared console (and worldwide)
    // figure we have for this game. Used to detect when a Boxleiter PC
    // estimate alone would dramatically under-represent the title (PS
    // exclusive, console-heavy AAA with a tiny PC port…). When this evidence
    // dwarfs the PC estimate we drop the PC estimate's contribution to
    // `estimatedToday` rather than let it set the headline number.
    let consoleEvidence = 0;
    for (const [platform, record] of bestByPlatform) {
      if (platform === Platform.PLAYSTATION || platform === Platform.XBOX) {
        consoleEvidence += record.units;
      }
    }
    if (globalDeclared) {
      consoleEvidence = Math.max(consoleEvidence, globalDeclared.units);
    }

    for (const platform of platforms) {
      if (platform === Platform.GLOBAL) continue;
      const declared = bestByPlatform.get(platform);
      const estimate = estimates.get(platform);

      let low: number | null = null;
      let high: number | null = null;

      if (declared && estimate) {
        const cap = this.freshnessCap(declared, releaseDate);
        low = Math.max(declared.units, Math.min(estimate.estimatedLow, cap));
        high = Math.max(declared.units, Math.min(estimate.estimatedHigh, cap));

        const cls = this.classifyAgreement(
          declared.units,
          declared.reportedAt,
          estimate.estimatedLow,
          estimate.estimatedHigh,
        );
        reconciliation.push({
          platform,
          declaredUnits: declared.units,
          declaredSource: declared.source,
          declaredAt: declared.reportedAt,
          estimateLow: estimate.estimatedLow,
          estimateHigh: estimate.estimatedHigh,
          estimateMethod: estimate.method,
          agreement: cls.agreement,
          ratio: Math.round(cls.ratio * 100) / 100,
          detail: cls.detail,
        });
      } else if (declared) {
        low = declared.units;
        high = declared.units;
      } else if (estimate) {
        // Guardrail: Boxleiter PC estimates are unreliable when console
        // declared figures suggest PC is a marginal share of total sales
        // (PS-exclusive PC port, Switch first-party with a tiny PC release…).
        if (
          platform === Platform.PC &&
          consoleEvidence > 0 &&
          this.isPcMarginal(estimate, consoleEvidence)
        ) {
          continue;
        }
        low = estimate.estimatedLow;
        high = estimate.estimatedHigh;
      }

      if (low !== null && high !== null) {
        todayLow += low;
        todayHigh += high;
        hasToday = true;
      }
    }

    // A worldwide declared figure (e.g. "30M copies sold worldwide") anchors
    // the platform-summed total: it's a floor (already sold) and, when fresh,
    // a freshness-aware cap (no 3.5x in 3 days). It's also surfaced as an
    // explicit reconciliation entry so the user sees the headline cross-check.
    if (globalDeclared && hasToday) {
      const cap = this.freshnessCap(globalDeclared, releaseDate);
      todayLow = Math.max(globalDeclared.units, Math.min(todayLow, cap));
      todayHigh = Math.max(globalDeclared.units, Math.min(todayHigh, cap));

      const cls = this.classifyAgreement(
        globalDeclared.units,
        globalDeclared.reportedAt,
        todayLow,
        todayHigh,
      );
      reconciliation.push({
        platform: Platform.GLOBAL,
        declaredUnits: globalDeclared.units,
        declaredSource: globalDeclared.source,
        declaredAt: globalDeclared.reportedAt,
        estimateLow: todayLow,
        estimateHigh: todayHigh,
        estimateMethod: 'platform-sum',
        agreement: cls.agreement,
        ratio: Math.round(cls.ratio * 100) / 100,
        detail: cls.detail,
      });
    }

    reconciliation.sort((a, b) => b.declaredUnits - a.declaredUnits);

    return {
      reconciliation,
      estimatedToday: hasToday ? { low: todayLow, high: todayHigh } : null,
    };
  }

  /**
   * Build the upper bound for "today" derived from a dated declared figure.
   * Sales follow a front-loaded decay curve, so growth potential between the
   * declared date and today depends on where each falls on the game's
   * lifetime curve, not just on calendar time.
   *
   * Uses `lifetimeSalesPct` + buffers from `sales-modeling.constants.ts`.
   * Falls back to a flat annual-growth model when the release date is
   * unknown (older catalog entries).
   */
  /**
   * True when the Boxleiter PC estimate represents less than
   * PC_DOMINANCE_RATIO_THRESHOLD of the cross-checked PC + console total,
   * meaning PC is a marginal channel for this title (console-exclusive PC
   * port, Switch first-party port…). In that case the PC estimate can't be
   * trusted to drive the headline number on its own.
   */
  private isPcMarginal(
    estimate: SalesEstimate,
    consoleEvidence: number,
  ): boolean {
    const pcMid = (estimate.estimatedLow + estimate.estimatedHigh) / 2;
    if (pcMid <= 0) return true;
    const share = pcMid / (pcMid + consoleEvidence);
    return share < PC_DOMINANCE_RATIO_THRESHOLD;
  }

  private freshnessCap(
    declared: SalesRecord,
    releaseDate: Date | null,
  ): number {
    if (!declared.reportedAt) return Number.POSITIVE_INFINITY;

    if (releaseDate) {
      const declaredPct = lifetimeSalesPct(
        ageInDays(releaseDate, declared.reportedAt),
      );
      const todayPct = lifetimeSalesPct(ageInDays(releaseDate));

      // Pre-release declared shouldn't happen; fall through to the time-based
      // formula in that case.
      if (declaredPct > 0) {
        const expectedRatio = todayPct / declaredPct;
        const cap =
          declared.units *
          (1 + (expectedRatio - 1) * FRESHNESS_VARIANCE_BUFFER);
        return Math.max(cap, declared.units * FRESHNESS_MIN_HEADROOM);
      }
    }

    const ageYears = Math.max(0, ageInYears(declared.reportedAt));
    if (ageYears >= FALLBACK_GROWTH_CAP_YEARS) return Number.POSITIVE_INFINITY;
    return declared.units * (1 + FALLBACK_ANNUAL_GROWTH * ageYears);
  }

  /**
   * Classify how a dated declared figure sits relative to our estimate range,
   * accounting for the fact that sales only grow: an estimate above an old
   * declared figure is plausible growth, while a declared figure above our
   * whole range means the model undershoots a known number.
   */
  private classifyAgreement(
    declared: number,
    declaredAt: Date | null,
    estLow: number,
    estHigh: number,
  ): { agreement: Agreement; ratio: number; detail: string } {
    const mid = (estLow + estHigh) / 2;
    const ratio = declared > 0 ? mid / declared : 0;

    if (declared >= estLow && declared <= estHigh) {
      return {
        agreement: 'strong',
        ratio,
        detail: 'Declared figure falls within the estimated range.',
      };
    }

    if (declared > estHigh) {
      const overshoot = estHigh > 0 ? declared / estHigh : Infinity;
      return overshoot <= AGREEMENT_OVERSHOOT_RATIO
        ? {
            agreement: 'weak',
            ratio,
            detail:
              'Declared figure sits just above the estimate; the model slightly undershoots.',
          }
        : {
            agreement: 'conflict',
            ratio,
            detail:
              'Declared figure is well above the estimate — the model undershoots or the figure may be mismatched.',
          };
    }

    // declared < estLow: we estimate more than was ever declared. Plausible if
    // the figure is old; relax the threshold with its age.
    const ageYears = declaredAt ? Math.max(0, ageInYears(declaredAt)) : 0;
    const growthBudget = 1 + AGREEMENT_GROWTH_PER_YEAR * ageYears;
    const over = declared > 0 ? estLow / declared : Infinity;

    if (over <= growthBudget) {
      return {
        agreement: 'weak',
        ratio,
        detail:
          'Estimate exceeds the older declared figure, consistent with sales growth since then.',
      };
    }
    if (over <= growthBudget * 2) {
      return {
        agreement: 'weak',
        ratio,
        detail:
          'Estimate is above the declared figure beyond typical growth; treat with caution.',
      };
    }
    return {
      agreement: 'conflict',
      ratio,
      detail:
        'Estimate is far above any declared figure even allowing for growth — likely an estimation outlier.',
    };
  }

  private buildTotal(
    breakdown: PlatformSales[],
    globalRecords: SalesRecord[],
    globalAgreement: Agreement | null,
  ): TotalSales | null {
    const reported = globalRecords.reduce<SalesRecord | null>(
      (best, r) => (!best || this.isMoreReliable(r, best) ? r : best),
      null,
    );

    if (reported) {
      const baseConfidence =
        reported.confidence ?? DEFAULT_CONFIDENCE[reported.source];
      return {
        low: reported.units,
        high: reported.units,
        basis: 'reported',
        sources: [reported.source],
        source: reported.source,
        sourceUrl: reported.sourceUrl,
        note: reported.note,
        reportedAt: reported.reportedAt,
        confidence: this.adjustConfidence(baseConfidence, globalAgreement),
      };
    }

    if (breakdown.length === 0) return null;

    return {
      low: breakdown.reduce((sum, p) => sum + p.low, 0),
      high: breakdown.reduce((sum, p) => sum + p.high, 0),
      basis: 'sum',
      sources: [...new Set(breakdown.map((p) => p.source))],
      source: null,
      sourceUrl: null,
      note: null,
      reportedAt: null,
      confidence: null,
    };
  }

  /**
   * Adjust the headline confidence based on how the Boxleiter-derived estimate
   * agrees with the declared figure:
   *   - strong: model brackets the declared figure → trust HIGH (the figure
   *     is independently corroborated).
   *   - weak: plausible but off → keep the source-tier default.
   *   - conflict: model strongly disagrees → drop one notch (figure or model
   *     is suspect, even if the source is OFFICIAL).
   */
  private adjustConfidence(
    base: ConfidenceLevel,
    agreement: Agreement | null,
  ): ConfidenceLevel {
    if (!agreement) return base;
    if (agreement === 'strong') return ConfidenceLevel.HIGH;
    if (agreement === 'conflict') {
      if (base === ConfidenceLevel.HIGH) return ConfidenceLevel.MEDIUM;
      return ConfidenceLevel.LOW;
    }
    return base;
  }

  private isMoreReliable(
    candidate: SalesRecord,
    current: SalesRecord,
  ): boolean {
    const candidatePriority = SOURCE_PRIORITY[candidate.source];
    const currentPriority = SOURCE_PRIORITY[current.source];
    if (candidatePriority !== currentPriority) {
      return candidatePriority > currentPriority;
    }

    // Same source tier: prefer the figure we know the most about chronologically.
    // 1. A dated figure always beats an undated one — dates are essential for
    //    building an accurate history and for the reconciliation floor logic.
    const cDated = candidate.reportedAt !== null;
    const xDated = current.reportedAt !== null;
    if (cDated !== xDated) return cDated;

    // 2. Between two dated figures, the more recent one wins (sales only grow,
    //    so the latest figure is the closest to the current truth).
    if (cDated && xDated) {
      const ct = candidate.reportedAt!.getTime();
      const xt = current.reportedAt!.getTime();
      if (ct !== xt) return ct > xt;
    }

    // 3. Between two undated figures of the same tier, keep the higher number
    //    — for the same reason (sales trajectory is monotonically increasing).
    return candidate.units > current.units;
  }

  // Raw queries (getRawMany) don't hydrate enum arrays: node-postgres returns
  // a user-defined enum[] column as the Postgres array literal "{PC,SWITCH}".
  // Normalize it back to a string[] so consumers always get an array.
  private parsePlatforms(value: Platform[] | string | null): Platform[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return value
      .replace(/^{|}$/g, '')
      .split(',')
      .map((p) => p.replace(/^"|"$/g, '').trim())
      .filter(Boolean) as Platform[];
  }

  /**
   * Pick the estimate to feed into reconciliation, per platform. We
   * prefer the `aggregated` row (weighted combination of every enabled
   * method written at the same `computedAt`). If no aggregate exists yet
   * for a platform — historical rows produced before the registry
   * migration, or a platform with no method enabled — we fall back on
   * whatever row is most recent. This keeps the headline stable during
   * the rollout while encouraging the aggregate to take over once
   * `rebuildEstimateHistory` has been replayed.
   */
  private async latestEstimatesByPlatform(
    gameId: string,
    asOf?: Date,
  ): Promise<Map<Platform, SalesEstimate>> {
    const aggregateMethod =
      this.estimationMethods.findByCode(AGGREGATED_METHOD_CODE);

    const estimates = await this.estimates.find({
      where: {
        gameId,
        ...(asOf ? { computedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { computedAt: 'DESC' },
    });

    const aggregateByPlatform = new Map<Platform, SalesEstimate>();
    const fallbackByPlatform = new Map<Platform, SalesEstimate>();
    for (const estimate of estimates) {
      if (
        aggregateMethod &&
        estimate.methodId === aggregateMethod.id &&
        !aggregateByPlatform.has(estimate.platform)
      ) {
        aggregateByPlatform.set(estimate.platform, estimate);
        continue;
      }
      if (!fallbackByPlatform.has(estimate.platform)) {
        fallbackByPlatform.set(estimate.platform, estimate);
      }
    }

    const map = new Map<Platform, SalesEstimate>();
    for (const [platform, estimate] of fallbackByPlatform) {
      map.set(platform, aggregateByPlatform.get(platform) ?? estimate);
    }
    return map;
  }

  /**
   * Pull the latest reconciled "today" estimate per game from
   * `estimate_snapshot`. This is the same source the public detail page and
   * the chart consume, so the list cards and the detail headline always agree.
   * Games without any snapshot are simply absent from the map (the card
   * renders "no estimate yet" rather than falling back to a raw PC Boxleiter
   * figure that would diverge from the detail headline).
   */
  private async latestReconciledEstimates(
    gameIds: string[],
  ): Promise<Map<string, { low: number; high: number }>> {
    const map = new Map<string, { low: number; high: number }>();
    if (gameIds.length === 0) return map;

    const rows = await this.estimateSnapshots
      .createQueryBuilder('s')
      .distinctOn(['s.gameId'])
      .select('s.gameId', 'gameId')
      .addSelect('s.estimatedTodayLow', 'low')
      .addSelect('s.estimatedTodayHigh', 'high')
      .where('s.gameId IN (:...gameIds)', { gameIds })
      .orderBy('s.gameId')
      .addOrderBy('s.computedAt', 'DESC')
      .getRawMany<{ gameId: string; low: number; high: number }>();

    for (const row of rows) {
      map.set(row.gameId, { low: Number(row.low), high: Number(row.high) });
    }
    return map;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ConfidenceLevel,
  Game,
  Platform,
  SalesEstimate,
  SalesRecord,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import {
  AGREEMENT_GROWTH_PER_YEAR,
  AGREEMENT_OVERSHOOT_RATIO,
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
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
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
export type Agreement = 'strong' | 'weak' | 'conflict';

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

export interface SalesHistoryPoint {
  platform: Platform;
  units: number;
  source: SalesSource;
  confidence: ConfidenceLevel | null;
  sourceUrl: string | null;
  note: string | null;
  publisher: string | null;
  reportedAt: Date | null;
  capturedAt: Date;
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

@Injectable()
export class GamesService {
  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(SalesRecord)
    private readonly salesRecords: Repository<SalesRecord>,
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
    limit = 24,
    sort: 'popular' | 'recent' | 'oldest' = 'popular',
    platform?: string,
    offset = 0,
  ): Promise<PaginatedGames> {
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
      .addSelect('g.isFree', 'isFree')
      .addSelect('COALESCE(MAX(s.value), 0)', 'reviews')
      .groupBy('g.id');

    const countQb = this.games.createQueryBuilder('g');

    if (platform) {
      // PostgreSQL enum-array containment: platforms @> ARRAY['X']::platform_enum[]
      qb.andWhere(
        `g.platforms @> ARRAY[:platform]::game_platforms_enum[]`,
        { platform },
      );
      countQb.andWhere(
        `g.platforms @> ARRAY[:platform]::game_platforms_enum[]`,
        { platform },
      );
    }

    if (sort === 'recent') {
      qb.orderBy('g.releaseDate', 'DESC', 'NULLS LAST');
    } else if (sort === 'oldest') {
      qb.orderBy('g.releaseDate', 'ASC', 'NULLS LAST');
    } else {
      qb.orderBy('reviews', 'DESC');
    }

    const [rows, total] = await Promise.all([
      qb
        .offset(offset)
        .limit(limit)
        .getRawMany<{
          id: string;
          name: string;
          slug: string;
          releaseDate: Date | null;
          coverUrl: string | null;
          platforms: Platform[];
          isFree: boolean;
          reviews: string;
        }>(),
      countQb.getCount(),
    ]);

    const latestByGame = await this.latestEstimates(rows.map((r) => r.id));

    const items = rows.map((r) => {
      const estimate = latestByGame.get(r.id);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        releaseDate: r.releaseDate,
        coverUrl: r.coverUrl,
        platforms: this.parsePlatforms(r.platforms),
        isFree: r.isFree,
        reviews: Number(r.reviews),
        estimatedLow: estimate?.estimatedLow ?? null,
        estimatedHigh: estimate?.estimatedHigh ?? null,
      };
    });

    return { items, total };
  }

  async getBySlug(slug: string) {
    const game = await this.games.findOne({
      where: { slug },
      relations: { sources: true, salesRecords: true },
    });

    if (!game) throw new NotFoundException(`Game "${slug}" not found`);

    const latestEstimates = await this.latestEstimatesByPlatform(game.id);

    const { breakdown, total, reconciliation, estimatedToday } =
      this.aggregateSales(
        game.salesRecords,
        latestEstimates,
        game.releaseDate,
      );

    const reviewHistory = await this.signals.find({
      where: { gameId: game.id, metric: SignalMetric.STEAM_REVIEWS },
      order: { capturedAt: 'ASC' },
      select: { capturedAt: true, value: true },
    });

    const storeRatings = await this.buildStoreRatings(game.id);

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
      salesHistory: this.buildHistory(game.salesRecords),
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

  // All recorded figures (official, Wikipedia, media, announcements) ordered
  // chronologically by the date they were reported as of. Undated
  // figures sort last. Estimates are excluded: they are a live "today" value,
  // not a dated historical data point.
  private buildHistory(records: SalesRecord[]): SalesHistoryPoint[] {
    return records
      .map((r) => ({
        platform: r.platform,
        units: r.units,
        source: r.source,
        confidence: r.confidence ?? DEFAULT_CONFIDENCE[r.source],
        sourceUrl: r.sourceUrl,
        note: r.note,
        publisher: r.publisher,
        reportedAt: r.reportedAt,
        capturedAt: r.capturedAt,
      }))
      .sort((a, b) => {
        const ta = a.reportedAt?.getTime() ?? Number.POSITIVE_INFINITY;
        const tb = b.reportedAt?.getTime() ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        return a.capturedAt.getTime() - b.capturedAt.getTime();
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
      if (
        platform === Platform.PLAYSTATION ||
        platform === Platform.XBOX
      ) {
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
          declared.units * (1 + (expectedRatio - 1) * FRESHNESS_VARIANCE_BUFFER);
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

  private isMoreReliable(candidate: SalesRecord, current: SalesRecord): boolean {
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

  private async latestEstimatesByPlatform(
    gameId: string,
  ): Promise<Map<Platform, SalesEstimate>> {
    const estimates = await this.estimates.find({
      where: { gameId },
      order: { computedAt: 'DESC' },
    });

    const map = new Map<Platform, SalesEstimate>();
    for (const estimate of estimates) {
      if (!map.has(estimate.platform)) {
        map.set(estimate.platform, estimate);
      }
    }
    return map;
  }

  private async latestEstimates(
    gameIds: string[],
  ): Promise<Map<string, SalesEstimate>> {
    const map = new Map<string, SalesEstimate>();
    if (gameIds.length === 0) return map;

    const estimates = await this.estimates.find({
      where: { gameId: In(gameIds), platform: Platform.PC },
      order: { computedAt: 'DESC' },
    });

    for (const estimate of estimates) {
      if (!map.has(estimate.gameId)) {
        map.set(estimate.gameId, estimate);
      }
    }
    return map;
  }
}

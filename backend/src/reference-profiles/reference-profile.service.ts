import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Game,
  Milestone,
  Platform,
  ReferenceProfile,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import { platformReleaseDate } from '../games/platform-release-date';
/**
 * Curve checkpoints (days from release) at which we sample the observed
 * cumulative-units fraction. Normalised to `a1` (= 1.0). Ordered chronologically
 * so `a1` sits mid-array — we still expose it explicitly to make the
 * dependency between it and the other points visible.
 */
const CURVE_CHECKPOINTS = [
  { key: 's1', days: 7 },
  { key: 'm1', days: 30 },
  { key: 'm3', days: 90 },
  { key: 'm6', days: 180 },
  { key: 'a1', days: 365 },
  { key: 'a2', days: 730 },
] as const;

type CurveKey = (typeof CURVE_CHECKPOINTS)[number]['key'];
type CurveVector = Record<CurveKey, number | null>;

/** Normalised per-platform unit shares (sum to 1.0). */
type PlatformShareVector = {
  pc: number;
  ps: number;
  xbox: number;
  switch: number;
};

/**
 * Internal weights for turning per-platform rating counters into a
 * proxied unit estimate before normalising into `platformShare*`. The
 * exact absolute values do not matter (they cancel out at normalisation)
 * as long as the ratios reflect the review-density gap between stores
 * — sourced from the Boxleiter default ranges in
 * `sales-modeling.constants.ts` (midpoints).
 */
const PLATFORM_UNIT_WEIGHT = {
  pc: 45,
  ps: 70,
  xbox: 62.5,
  switch: 60,
} as const;

/**
 * Anchors below this many total proxied units across platforms are too
 * noisy to yield a meaningful share breakdown — we skip the platform
 * split rather than persist junk shares.
 */
const MIN_PLATFORM_TOTAL_UNITS = 1_000;

/**
 * PC publishers whose Steam review counts badly understate total PC sales
 * because a large share sells on their own storefront (EA App, Battle.net,
 * Ubisoft Connect) or via Game Pass. For these the reviews→units PC estimate
 * is unreliable, so the residual split (`Global − PC_est`) is skipped and we
 * fall back to the ratings proxy. Matched as case-insensitive substrings of
 * `game.publisher`.
 */
const OFF_STEAM_PC_PUBLISHERS = [
  'activision',
  'blizzard',
  'epic games',
  'riot',
  'xbox game studios',
  'microsoft',
] as const;

/**
 * Relative console-platform weights used to split the residual console total
 * (`Global − PC_est`) when we cannot measure the split from ratings — the usual
 * case, since Xbox/Switch rating coverage is near-zero. Normalised over the
 * console platforms the game actually shipped on. Rough current-gen priors,
 * superseded by ratings whenever every present console platform has a count.
 */
const CONSOLE_SPLIT_PRIOR = { ps: 0.6, xbox: 0.3, switch: 0.1 } as const;

/**
 * Residual-split guards: skip (fall back to the ratings proxy) when the PC
 * estimate would be an implausibly large share of the global total — a small
 * console residual there is dominated by PC-estimation noise — or when Steam
 * review coverage at the observation date is too thin to estimate PC at all.
 */
const RESIDUAL_MAX_PC_SHARE = 0.85;
const RESIDUAL_MIN_REVIEWS = 50;

/**
 * Quality score decays for anchors observed this far in the past. The
 * matcher still uses them (older observations remain informative) but
 * with a smaller weight in the kNN aggregate.
 */
const RECENCY_STEPS = [
  { maxAgeYears: 3, weight: 1.0 },
  { maxAgeYears: 7, weight: 0.75 },
  { maxAgeYears: Number.POSITIVE_INFINITY, weight: 0.5 },
] as const;

/**
 * Eligibility threshold under which the anchor is dropped — we need
 * either the reviews→units ratio OR at least two normalised curve
 * points to say anything useful. `scaleUnits` is always required
 * because the whole vector is anchored to it.
 */
const MIN_CURVE_POINTS_WITHOUT_RATIO = 2;

/**
 * PC Boxleiter ratios above this multiple of the per-game median (across the
 * game's lifecycle points) are dropped before the log-space mean. Mirrors the
 * matcher's aggregation guard so a single inflated point (e.g. a leak owner
 * count bundling non-buyers) can't skew a game's calibrated ratio.
 */
const REVIEWS_TO_UNITS_OUTLIER_FACTOR = 2;

/**
 * Steam's review rate (reviews per sale) has risen steadily since ~2013, so a
 * units/reviews ratio measured in an early calendar year is far higher than the
 * same game's ratio measured today. Because the estimator applies
 * `reviewsToUnits` to a game's CURRENT cumulative reviews, we normalise every
 * anchor's raw ratio from its observation year to the current review-rate era —
 * otherwise leak-2018 anchors (~89% of the corpus) inflate estimates ~2×.
 *
 * `kEra(year)` is fitted on the whole corpus (median units/reviews by calendar
 * year of observation), anchored by known-sales titles (e.g. EU5 = 980k /
 * 29.6k reviews ≈ 33 in 2026):
 *   kEra(year) = ERA_AMP · exp(-ERA_SLOPE · (year − ERA_BASE_YEAR)) + ERA_FLOOR
 * The normalisation factor to the current year is `kEra(now) / kEra(observed)`.
 */
const ERA_AMP = 193.8;
const ERA_SLOPE = 0.275;
const ERA_BASE_YEAR = 2013;
const ERA_FLOOR = 33.4;

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365 * DAY_MS;

/**
 * Launch-window used to observe the peak CCU that feeds `peakCcuRatio`.
 * Leak-era CCU is stored as one point per calendar month (first of the
 * month), so the estimator's tight 14-day window silently misses it and
 * every pre-live-tracking anchor (incl. the whole grand-strategy family)
 * ends up with a `null` ratio. We instead take the max over the launch
 * month plus the following one, which captures the launch spike for both
 * monthly leak points and daily live series.
 */
const LAUNCH_CCU_WINDOW_MONTHS = 2;

/**
 * Guardrails for the observed `peakCcuRatio`:
 *   - the launch peak must be a meaningful fraction of the game's all-time
 *     peak, otherwise the launch window never captured the real launch
 *     (re-releases, or late-blooming free/bundled titles whose popularity
 *     came years after release) and the ratio is garbage;
 *   - the resulting ratio is capped to a physical ceiling — week-1 units
 *     per launch concurrent player above this only happens when `scaleUnits`
 *     is franchise-contaminated (e.g. a GOTY edition inheriting 14M units).
 */
const MIN_LAUNCH_PEAK_ALLTIME_FRAC = 0.15;
const MAX_PEAK_CCU_RATIO = 60;

/** A single dated sales figure scoped to one platform (or GLOBAL). */
interface PlatformFigure {
  units: number;
  observedAt: Date;
}

interface AnchorSelection {
  observedAt: Date;
  scaleUnits: number;
  hasMilestone: boolean;
  source: SalesSource | 'LEAK';
  // Platform the scale figure is scoped to. Only a GLOBAL anchor can feed the
  // console-residual split (`Global − PC`); the leak is a PC player count.
  platform: Platform;
  // Most-recent (= largest, since figures are cumulative) sourced figure per
  // scope — GLOBAL / PC / PLAYSTATION / XBOX / SWITCH. Feeds the scale total
  // and the reviews→units fallback.
  platformFigures: Partial<Record<Platform, PlatformFigure>>;
  // Every non-rejected sourced figure (all dates, all scopes). The split picks
  // the GLOBAL anchor date whose coexisting per-platform breakdown best covers
  // the total, so it needs the full history, not just the latest per scope.
  allFigures: Array<PlatformFigure & { platform: Platform }>;
  // Every PC-scoped dated observation (all PC milestones + the Steam leak),
  // kept individually so the PC Boxleiter ratio is averaged across the game's
  // lifecycle rather than trusting a single point.
  pcPoints: PlatformFigure[];
}

/**
 * ETL for `reference_profile`: turns a game's raw signals + milestones
 * into a single observed behavioural vector, or removes any existing
 * anchor when the game no longer meets the eligibility bar. This is the
 * only writer of the table — callers should invoke `rebuildOne` after
 * ingesting new snapshots/milestones for a game, and `rebuildAll` when
 * a full re-fit is needed (e.g. after tuning the eligibility gate).
 */
@Injectable()
export class ReferenceProfileService {
  private readonly logger = new Logger(ReferenceProfileService.name);

  constructor(
    @InjectRepository(ReferenceProfile)
    private readonly anchors: Repository<ReferenceProfile>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
  ) {}

  /**
   * Recompute the anchor vector for a single game and persist it. When
   * the game is ineligible (free-to-play, no trustworthy scale anchor,
   * insufficient signal coverage) any pre-existing row is deleted so
   * consumers never see stale anchors.
   */
  async rebuildOne(gameId: string): Promise<ReferenceProfile | null> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { platformReleaseDates: true },
    });
    if (!game || game.isFree) {
      await this.anchors.delete({ gameId });
      return null;
    }

    const anchor = await this.pickAnchor(gameId);
    if (!anchor) {
      await this.anchors.delete({ gameId });
      return null;
    }

    // PC Boxleiter ratio, already normalised to the current review-rate era:
    // the mean of one units/reviews ratio per PC lifecycle point (see
    // `computeReviewsToUnits`). `null` when the game has no PC-scoped signal.
    const reviewsToUnits = await this.computeReviewsToUnits(game, anchor);

    // Independent worldwide anchor (reviews → all-platforms units). Lets a
    // global-only game contribute a real ratio without polluting the PC
    // Boxleiter. See `computeGlobalReviewsToUnits`.
    const globalReviewsToUnits = await this.computeGlobalReviewsToUnits(
      game,
      anchor,
    );

    const pcReleaseDate = platformReleaseDate(game, Platform.PC);

    const curve = pcReleaseDate
      ? await this.computeCurve(gameId, pcReleaseDate)
      : this.emptyCurve();

    const platformShares = await this.computePlatformShares(game, anchor);

    const peakCcuRatio = pcReleaseDate
      ? await this.computePeakCcuRatio(gameId, pcReleaseDate, reviewsToUnits)
      : null;

    const qualityScore = this.computeQuality(
      anchor,
      curve,
      reviewsToUnits,
      globalReviewsToUnits,
    );

    if (!this.isEligible(anchor, curve, reviewsToUnits, globalReviewsToUnits)) {
      await this.anchors.delete({ gameId });
      return null;
    }

    const existing = await this.anchors.findOne({ where: { gameId } });
    const entity = existing ?? this.anchors.create({ gameId });

    entity.curveS1 = curve.s1;
    entity.curveM1 = curve.m1;
    entity.curveM3 = curve.m3;
    entity.curveM6 = curve.m6;
    entity.curveA1 = curve.a1;
    entity.curveA2 = curve.a2;
    entity.reviewsToUnits = reviewsToUnits;
    entity.globalReviewsToUnits = globalReviewsToUnits;
    entity.platformSharePc = platformShares?.pc ?? null;
    entity.platformSharePs = platformShares?.ps ?? null;
    entity.platformShareXbox = platformShares?.xbox ?? null;
    entity.platformShareSwitch = platformShares?.switch ?? null;
    entity.peakCcuRatio = peakCcuRatio;
    // `bigint` columns come back as strings from typeorm; we round to an
    // integer number of units and let the ORM coerce it on save.
    entity.scaleUnits = String(Math.round(anchor.scaleUnits));
    entity.qualityScore = qualityScore;
    entity.observedAt = anchor.observedAt;

    return this.anchors.save(entity);
  }

  /**
   * Drop a game's anchor. Called when a game is soft-deleted: the matcher
   * already excludes deleted games, but the row would otherwise linger
   * (rebuildAll skips deleted games, so the ETL never revisits it).
   */
  async removeForGame(gameId: string): Promise<void> {
    await this.anchors.delete({ gameId });
  }

  /**
   * Recompute anchors for every game with either a trusted milestone or
   * a leak snapshot. Iterates in bounded batches so the pipeline can
   * run inside a serverless invocation.
   */
  async rebuildAll(limit?: number): Promise<{
    processed: number;
    persisted: number;
    dropped: number;
  }> {
    const rows = await this.games.manager
      .createQueryBuilder()
      .select('DISTINCT g.id', 'id')
      .from(Game, 'g')
      .leftJoin(
        Milestone,
        'm',
        'm."gameId" = g.id AND m."rejectedAt" IS NULL AND m."isEngagement" = false AND m."reportedAt" IS NOT NULL',
      )
      .leftJoin(
        SignalSnapshot,
        's',
        `s."gameId" = g.id AND s.metric = 'STEAM_PLAYERS_LEAK'`,
      )
      .where('g."deletedAt" IS NULL')
      .andWhere('g."isFree" = false')
      .andWhere('(m.id IS NOT NULL OR s.id IS NOT NULL)')
      .limit(limit)
      .getRawMany<{ id: string }>();

    let persisted = 0;
    let dropped = 0;
    for (const { id } of rows) {
      const result = await this.rebuildOne(id);
      if (result) persisted += 1;
      else dropped += 1;
    }
    this.logger.log(
      `rebuildAll: processed=${rows.length} persisted=${persisted} dropped=${dropped}`,
    );
    return { processed: rows.length, persisted, dropped };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Pick the observation window's closing point. Trusted, non-engagement
   * milestones win over the leak (they're more recent and provenance-
   * checked); the leak is used only as a fallback for pre-2018 titles
   * that never disclosed a figure. When both are absent we return null,
   * which drops the anchor.
   */
  private async pickAnchor(gameId: string): Promise<AnchorSelection | null> {
    const milestones = await this.milestones
      .createQueryBuilder('m')
      .where('m."gameId" = :gameId', { gameId })
      .andWhere('m."rejectedAt" IS NULL')
      .andWhere('m."isEngagement" = false')
      .andWhere('m."reportedAt" IS NOT NULL')
      .andWhere("m.source <> 'STEAM_LEAK'")
      .orderBy('m."reportedAt"', 'DESC')
      .getMany();

    const leak = await this.signals
      .createQueryBuilder('s')
      .where('s."gameId" = :gameId', { gameId })
      .andWhere('s.metric = :metric', {
        metric: SignalMetric.STEAM_PLAYERS_LEAK,
      })
      .orderBy('s."capturedAt"', 'DESC')
      .getOne();

    // Latest figure per scope. Milestones come newest-first, so the first seen
    // per platform is the most recent — and, since cumulative figures only
    // grow, also the largest known total for that scope.
    const platformFigures: Partial<Record<Platform, PlatformFigure>> = {};
    for (const m of milestones) {
      if (!m.reportedAt) continue;
      if (platformFigures[m.platform]) continue;
      platformFigures[m.platform] = {
        units: Number(m.units),
        observedAt: m.reportedAt,
      };
    }

    // PC lifecycle points for the Boxleiter-ratio mean: every PC-scoped
    // milestone plus the Steam leak (a PC owner count on paid games). Kept as
    // individual dated observations, not collapsed to the latest.
    const pcPoints: PlatformFigure[] = milestones
      .filter((m) => m.platform === Platform.PC && m.reportedAt)
      .map((m) => ({
        units: Number(m.units),
        observedAt: m.reportedAt as Date,
      }));
    if (leak) {
      // Leak counts are unique-players on paid games — a conservative proxy for
      // paid buyers with no further scaling (matches `BackfillSteamLeakMilestones`).
      pcPoints.push({ units: Number(leak.value), observedAt: leak.capturedAt });
    }

    // Full history (all scopes, all dates) for the split's coherent-date anchor.
    const allFigures = milestones
      .filter((m) => m.reportedAt)
      .map((m) => ({
        platform: m.platform,
        units: Number(m.units),
        observedAt: m.reportedAt as Date,
      }));

    // Scale anchor: the latest GLOBAL total when present; else the sum of the
    // latest per-platform milestones; else the leak. Never a mean of the units
    // — cumulative snapshots must be summed / taken at their most recent point.
    const global = platformFigures[Platform.GLOBAL];
    if (global) {
      return {
        observedAt: global.observedAt,
        scaleUnits: global.units,
        hasMilestone: true,
        source:
          milestones.find((m) => m.platform === Platform.GLOBAL)?.source ??
          SalesSource.OFFICIAL,
        platform: Platform.GLOBAL,
        platformFigures,
        allFigures,
        pcPoints,
      };
    }

    const perPlatform = (
      [
        Platform.PC,
        Platform.PLAYSTATION,
        Platform.XBOX,
        Platform.SWITCH,
      ] as const
    )
      .map((p) => platformFigures[p])
      .filter((f): f is PlatformFigure => f !== undefined);
    if (perPlatform.length > 0) {
      const scaleUnits = perPlatform.reduce((sum, f) => sum + f.units, 0);
      const observedAt = perPlatform
        .map((f) => f.observedAt)
        .reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
      return {
        observedAt,
        scaleUnits,
        hasMilestone: true,
        source: milestones[0]?.source ?? SalesSource.OFFICIAL,
        // A multi-platform sum behaves like a worldwide total for the split.
        platform: Platform.GLOBAL,
        platformFigures,
        allFigures,
        pcPoints,
      };
    }

    if (leak) {
      return {
        observedAt: leak.capturedAt,
        scaleUnits: Number(leak.value),
        hasMilestone: false,
        source: 'LEAK',
        // Leak is a Steam/PC player count, not a worldwide total.
        platform: Platform.PC,
        platformFigures,
        allFigures,
        pcPoints,
      };
    }

    return null;
  }

  /**
   * PC Boxleiter ratio (Steam reviews → PC units), already normalised to the
   * current review-rate era. It must reflect PC units only — the estimator
   * applies it to a game's Steam reviews to size PC sales — so it is NEVER a
   * worldwide total divided by Steam reviews (that conflates the platform mix
   * and inflates the ratio for console-heavy titles).
   *
   * Source priority:
   *   1. PC lifecycle points (all PC milestones + the Steam leak): one
   *      era-normalised `units / cumReviews(date)` ratio per point, averaged in
   *      log space so no single measurement dominates.
   *   2. GLOBAL − console: PC units = GLOBAL total minus console units derived
   *      independently of reviews (console milestones, else console ratings),
   *      to avoid the circularity of estimating PC from reviews and then
   *      dividing by reviews.
   *   3. `null` — no trustworthy PC signal; the estimator falls back to its
   *      global PC Boxleiter constant.
   */
  private async computeReviewsToUnits(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<number | null> {
    const pcRatios = await this.pcBoxleiterRatios(game.id, anchor.pcPoints);
    const pcMean = logMeanOfRatios(pcRatios);
    if (pcMean !== null) return pcMean;

    return this.globalMinusConsoleRatio(game, anchor);
  }

  /**
   * Steam-reviews → WORLDWIDE units ratio (era-normalised), the maximal honest
   * signal a "global-only" game carries. One `globalUnits / cumReviews(date)`
   * ratio per GLOBAL milestone date, shifted to the current review-rate era and
   * averaged in log space. This is NOT a PC Boxleiter — it bakes in the platform
   * mix (`≈ reviewsToUnits / pcShare`) — so it is stored as its own feature and
   * never merged into {@link computeReviewsToUnits}. Returns `null` when no
   * GLOBAL figure has contemporaneous review coverage.
   */
  private async computeGlobalReviewsToUnits(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<number | null> {
    const globalPoints = anchor.allFigures.filter(
      (f) => f.platform === Platform.GLOBAL && f.units > 0,
    );
    const ratios: number[] = [];
    for (const point of globalPoints) {
      const cumReviews = await this.cumulativeSignalAt(
        game.id,
        SignalMetric.STEAM_REVIEWS,
        point.observedAt,
      );
      if (cumReviews === null || cumReviews <= 0) continue;
      ratios.push(
        (point.units / cumReviews) * this.reviewRateEraFactor(point.observedAt),
      );
    }
    return logMeanOfRatios(ratios);
  }

  /**
   * One era-normalised PC Boxleiter ratio per dated PC observation. Each ratio
   * is `units / cumReviews(date)` shifted to the current review-rate era, so
   * points measured years apart stay comparable before they are averaged.
   */
  private async pcBoxleiterRatios(
    gameId: string,
    points: PlatformFigure[],
  ): Promise<number[]> {
    const ratios: number[] = [];
    for (const point of points) {
      if (!(point.units > 0)) continue;
      const cumReviews = await this.cumulativeSignalAt(
        gameId,
        SignalMetric.STEAM_REVIEWS,
        point.observedAt,
      );
      if (cumReviews === null || cumReviews <= 0) continue;
      ratios.push(
        (point.units / cumReviews) * this.reviewRateEraFactor(point.observedAt),
      );
    }
    return ratios;
  }

  /**
   * Fallback PC Boxleiter for games with only a GLOBAL total (no PC-scoped
   * signal): `PC = GLOBAL − console`, where console units come from console
   * milestones when available, else from console ratings — never from Steam
   * reviews (that would make the resulting ratio collapse to `kEra`). Returns
   * `null` unless the implied PC share is a plausible minority of the total.
   */
  private async globalMinusConsoleRatio(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<number | null> {
    const global = anchor.platformFigures[Platform.GLOBAL];
    if (!global || !(global.units > 0)) return null;

    const consoleUnits = await this.consoleUnitsFromMilestonesOrRatings(
      game,
      anchor,
      global.observedAt,
    );
    if (consoleUnits === null) return null;

    const pcUnits = global.units - consoleUnits;
    const pcShare = pcUnits / global.units;
    if (!(pcShare > 0) || pcShare >= RESIDUAL_MAX_PC_SHARE) return null;

    const cumReviews = await this.cumulativeSignalAt(
      game.id,
      SignalMetric.STEAM_REVIEWS,
      global.observedAt,
    );
    if (cumReviews === null || cumReviews <= 0) return null;

    return (pcUnits / cumReviews) * this.reviewRateEraFactor(global.observedAt);
  }

  /**
   * Console units at `at`, measured independently of Steam reviews so it can
   * feed the `GLOBAL − console` PC estimate without circularity. Prefers console
   * milestones when every present console platform has one; else derives them
   * from console ratings when every present console has a count; else `null`
   * (we won't guess from a partial signal). Returns `0` for PC-only games.
   */
  private async consoleUnitsFromMilestonesOrRatings(
    game: Game,
    anchor: AnchorSelection,
    at: Date,
  ): Promise<number | null> {
    const present = (game.platforms ?? []).filter((p) =>
      [Platform.PLAYSTATION, Platform.XBOX, Platform.SWITCH].includes(p),
    );
    if (present.length === 0) return 0;

    const figs = anchor.platformFigures;
    if (present.every((p) => figs[p] !== undefined)) {
      return present.reduce(
        (sum, p) => sum + (figs[p] as PlatformFigure).units,
        0,
      );
    }

    const metricByPlat: Record<string, SignalMetric> = {
      [Platform.PLAYSTATION]: SignalMetric.PS_RATINGS,
      [Platform.XBOX]: SignalMetric.XBOX_RATINGS,
      [Platform.SWITCH]: SignalMetric.SWITCH_RATINGS,
    };
    const weightByPlat: Record<string, number> = {
      [Platform.PLAYSTATION]: PLATFORM_UNIT_WEIGHT.ps,
      [Platform.XBOX]: PLATFORM_UNIT_WEIGHT.xbox,
      [Platform.SWITCH]: PLATFORM_UNIT_WEIGHT.switch,
    };
    const ratings = await Promise.all(
      present.map((p) => this.cumulativeSignalAt(game.id, metricByPlat[p], at)),
    );
    if (!ratings.every((r) => r !== null && r > 0)) return null;
    return present.reduce(
      (sum, p, i) => sum + (ratings[i] as number) * weightByPlat[p],
      0,
    );
  }

  /**
   * Multiplicative factor that shifts an observation-era units/reviews ratio to
   * the current review-rate era: `kEra(now) / kEra(observedYear)` (≤ 1 for past
   * observations, since Steam's review rate keeps rising). Years before
   * `ERA_BASE_YEAR` are clamped to it to avoid extrapolating the fit outside its
   * support.
   */
  /**
   * Median units-per-review for a given observation calendar year (the corpus
   * era fit). Doubles as an era-appropriate PC Boxleiter for the residual split:
   * `PC_units@date ≈ cumReviews@date × kEra(year)`.
   */
  private kEra(year: number): number {
    const clamped = Math.max(ERA_BASE_YEAR, year);
    return (
      ERA_AMP * Math.exp(-ERA_SLOPE * (clamped - ERA_BASE_YEAR)) + ERA_FLOOR
    );
  }

  private reviewRateEraFactor(observedAt: Date): number {
    const nowYear = new Date().getUTCFullYear();
    const factor = this.kEra(nowYear) / this.kEra(observedAt.getUTCFullYear());
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  }

  /**
   * Sample cumulative Steam-review counts at each release-relative
   * checkpoint and normalise by `a1`. Returns partial vectors when the
   * game is younger than 730 days: later checkpoints stay `null` and
   * the eligibility gate decides whether the coverage is enough.
   *
   * Snapshots are cumulative (see `IngestionService.backfillReviewsFromHistogram`)
   * so we take the most recent value ≤ each cutoff.
   */
  private async computeCurve(
    gameId: string,
    releaseDate: Date,
  ): Promise<CurveVector> {
    const raw: Partial<Record<CurveKey, number>> = {};
    for (const { key, days } of CURVE_CHECKPOINTS) {
      const cutoff = new Date(releaseDate.getTime() + days * DAY_MS);
      if (cutoff.getTime() > Date.now()) continue;
      const val = await this.cumulativeSignalAt(
        gameId,
        SignalMetric.STEAM_REVIEWS,
        cutoff,
      );
      if (val !== null && val > 0) raw[key] = val;
    }

    const a1 = raw.a1;
    if (!a1 || a1 <= 0) return this.emptyCurve();

    return {
      s1: raw.s1 !== undefined ? raw.s1 / a1 : null,
      m1: raw.m1 !== undefined ? raw.m1 / a1 : null,
      m3: raw.m3 !== undefined ? raw.m3 / a1 : null,
      m6: raw.m6 !== undefined ? raw.m6 / a1 : null,
      a1: 1.0,
      a2: raw.a2 !== undefined ? raw.a2 / a1 : null,
    };
  }

  private emptyCurve(): CurveVector {
    return { s1: null, m1: null, m3: null, m6: null, a1: null, a2: null };
  }

  /**
   * Resolve the game's platform split, in order of trust:
   *   1. Per-platform milestones — real single-platform totals directly (or
   *      combined with a GLOBAL total to derive the residual). Ground truth.
   *   2. Console-residual method — GLOBAL total minus a reviews-based PC
   *      estimate, console split by ratings/priors.
   *   3. Ratings-only proxy.
   *
   * IMPORTANT: this only ever writes `platformShare*`. It must NOT influence
   * `reviewsToUnits` — that ratio is resolved separately and the split never
   * feeds back into a value it depends on.
   */
  private async computePlatformShares(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<PlatformShareVector | null> {
    const fromMilestones = await this.computeSharesFromPlatformMilestones(
      game,
      anchor,
    );
    if (fromMilestones) return fromMilestones;

    const residual = await this.computeResidualShares(game, anchor);
    if (residual) return residual;

    return this.computePlatformSharesFromRatings(game.id, anchor.observedAt);
  }

  /**
   * Split reconstructed from sourced per-platform figures. Milestones for the
   * same game arrive at different dates and platforms, so we anchor on the
   * GLOBAL milestone whose coexisting per-platform breakdown BEST covers it
   * (least of the total left to guess), then hold those shares. Within a chosen
   * anchor, each platform's nearest figure is projected to the anchor date by
   * cross-multiply through its own signal (`units × signal@anchor /
   * signal@figureDate`); platforms with no figure take the residual, split by
   * their reviews/ratings (or a prior). Returns `null` when no per-platform
   * milestone exists (→ caller falls back to the residual/ratings paths).
   */
  private async computeSharesFromPlatformMilestones(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<PlatformShareVector | null> {
    const present = (game.platforms ?? []).filter((p) =>
      [
        Platform.PC,
        Platform.PLAYSTATION,
        Platform.XBOX,
        Platform.SWITCH,
      ].includes(p),
    );
    if (present.length === 0) return null;

    const hasPlatformFigure = anchor.allFigures.some((f) =>
      present.includes(f.platform),
    );
    if (!hasPlatformFigure) return null;

    const globals = anchor.allFigures
      .filter((f) => f.platform === Platform.GLOBAL && f.units > 0)
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());

    // No GLOBAL total: only trust the split when every present platform has a
    // figure; anchor on the most recent of them.
    if (globals.length === 0) {
      const refDate = present
        .map(
          (p) => this.latestFigureAtOrBefore(anchor, p, new Date())?.observedAt,
        )
        .filter((d): d is Date => d !== undefined)
        .reduce<Date | null>(
          (a, b) => (a === null || b.getTime() > a.getTime() ? b : a),
          null,
        );
      if (!refDate) return null;
      const built = await this.buildSplitAtDate(
        game,
        anchor,
        present,
        refDate,
        null,
      );
      return built?.shares ?? null;
    }

    // Pick the GLOBAL anchor whose breakdown explains the most of the total.
    let best: { score: number; shares: PlatformShareVector } | null = null;
    for (const g of globals) {
      const built = await this.buildSplitAtDate(
        game,
        anchor,
        present,
        g.observedAt,
        g.units,
      );
      if (built && (best === null || built.score > best.score)) best = built;
    }
    return best?.shares ?? null;
  }

  /**
   * Build a candidate split anchored at `refDate`. Each present platform is
   * sized from its nearest figure at-or-before `refDate`, projected through its
   * own signal; platforms without a figure absorb the residual (when a GLOBAL
   * total is given). `score` is the fraction of the total explained by real
   * per-platform figures (higher = less guessed) so the caller can pick the
   * best-covered anchor. Returns `null` when no platform figure is usable here.
   */
  private async buildSplitAtDate(
    game: Game,
    anchor: AnchorSelection,
    present: Platform[],
    refDate: Date,
    globalUnits: number | null,
  ): Promise<{ score: number; shares: PlatformShareVector } | null> {
    const units: Partial<Record<Platform, number>> = {};
    for (const p of present) {
      const fig = this.latestFigureAtOrBefore(anchor, p, refDate);
      if (fig)
        units[p] = await this.projectPlatformUnits(game.id, p, fig, refDate);
    }
    const known = present.filter((p) => units[p] !== undefined);
    if (known.length === 0) return null;
    const knownSum = known.reduce((sum, p) => sum + (units[p] ?? 0), 0);
    if (knownSum <= 0) return null;

    const unknown = present.filter((p) => units[p] === undefined);

    // Without a GLOBAL total, we can only trust a split that covers every
    // present platform (nothing bounds the missing ones).
    if (globalUnits === null) {
      if (unknown.length > 0) return null;
      const shares = sharesFromUnits(this.toShareVector(units));
      return shares ? { score: 1, shares } : null;
    }

    if (unknown.length === 0 || knownSum >= globalUnits) {
      const shares = sharesFromUnits(this.toShareVector(units));
      const score =
        knownSum <= globalUnits
          ? knownSum / globalUnits
          : globalUnits / knownSum;
      return shares ? { score, shares } : null;
    }

    const residual = globalUnits - knownSum;
    const rawWeights = await Promise.all(
      unknown.map((p) => this.residualWeightForPlatform(game.id, p, refDate)),
    );
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);
    if (weightSum > 0) {
      unknown.forEach((p, i) => {
        units[p] = residual * (rawWeights[i] / weightSum);
      });
    }
    const shares = sharesFromUnits(this.toShareVector(units));
    return shares ? { score: knownSum / globalUnits, shares } : null;
  }

  /** Most recent figure for `platform` reported at or before `at`. */
  private latestFigureAtOrBefore(
    anchor: AnchorSelection,
    platform: Platform,
    at: Date,
  ): PlatformFigure | undefined {
    let best: PlatformFigure | undefined;
    for (const f of anchor.allFigures) {
      if (f.platform !== platform) continue;
      if (f.observedAt.getTime() > at.getTime()) continue;
      if (!best || f.observedAt.getTime() > best.observedAt.getTime()) {
        best = { units: f.units, observedAt: f.observedAt };
      }
    }
    return best;
  }

  /** Steam/console signal whose growth tracks a platform's cumulative sales. */
  private signalMetricForPlatform(platform: Platform): SignalMetric {
    switch (platform) {
      case Platform.PLAYSTATION:
        return SignalMetric.PS_RATINGS;
      case Platform.XBOX:
        return SignalMetric.XBOX_RATINGS;
      case Platform.SWITCH:
        return SignalMetric.SWITCH_RATINGS;
      default:
        return SignalMetric.STEAM_REVIEWS;
    }
  }

  /**
   * Project a platform's milestone units to `refDate` by cross-multiplying with
   * its own signal (`units × signal@ref / signal@milestoneDate`). Falls back to
   * the raw milestone units when the signal is missing at either date.
   */
  private async projectPlatformUnits(
    gameId: string,
    platform: Platform,
    figure: PlatformFigure,
    refDate: Date,
  ): Promise<number> {
    const metric = this.signalMetricForPlatform(platform);
    const [atRef, atFigure] = await Promise.all([
      this.cumulativeSignalAt(gameId, metric, refDate),
      this.cumulativeSignalAt(gameId, metric, figure.observedAt),
    ]);
    if (atRef !== null && atRef > 0 && atFigure !== null && atFigure > 0) {
      return figure.units * (atRef / atFigure);
    }
    return figure.units;
  }

  /**
   * Relative weight for splitting the residual across platforms without a
   * milestone: a reviews/ratings-derived unit estimate when available, else a
   * fixed console prior (PC falls back to a neutral 1 — it is nearly always
   * anchored by its own signal).
   */
  private async residualWeightForPlatform(
    gameId: string,
    platform: Platform,
    at: Date,
  ): Promise<number> {
    const signal = await this.cumulativeSignalAt(
      gameId,
      this.signalMetricForPlatform(platform),
      at,
    );
    if (platform === Platform.PC) {
      return signal !== null && signal > 0
        ? signal * this.kEra(at.getUTCFullYear())
        : 1;
    }
    const weight =
      platform === Platform.PLAYSTATION
        ? PLATFORM_UNIT_WEIGHT.ps
        : platform === Platform.XBOX
          ? PLATFORM_UNIT_WEIGHT.xbox
          : PLATFORM_UNIT_WEIGHT.switch;
    if (signal !== null && signal > 0) return signal * weight;
    return platform === Platform.PLAYSTATION
      ? CONSOLE_SPLIT_PRIOR.ps
      : platform === Platform.XBOX
        ? CONSOLE_SPLIT_PRIOR.xbox
        : CONSOLE_SPLIT_PRIOR.switch;
  }

  /** Build a full share vector from a partial per-platform units map. */
  private toShareVector(
    units: Partial<Record<Platform, number>>,
  ): PlatformShareVector {
    return {
      pc: units[Platform.PC] ?? 0,
      ps: units[Platform.PLAYSTATION] ?? 0,
      xbox: units[Platform.XBOX] ?? 0,
      switch: units[Platform.SWITCH] ?? 0,
    };
  }

  /**
   * Console-residual split. Returns `null` (→ caller falls back to the ratings
   * proxy) unless the anchor is a GLOBAL total and every guard passes:
   *   - not mobile (a GLOBAL total then includes platforms we don't model);
   *   - publisher not in the off-Steam list (Steam reviews would undercount PC);
   *   - enough Steam reviews at the date to estimate PC;
   *   - the PC estimate is a plausible minority of the global total.
   */
  private async computeResidualShares(
    game: Game,
    anchor: AnchorSelection,
  ): Promise<PlatformShareVector | null> {
    if (anchor.platform !== Platform.GLOBAL || anchor.scaleUnits <= 0) {
      return null;
    }
    const platforms = new Set(game.platforms ?? []);
    if (platforms.has(Platform.MOBILE)) return null;
    const publisher = (game.publisher ?? '').toLowerCase();
    if (OFF_STEAM_PC_PUBLISHERS.some((p) => publisher.includes(p))) return null;

    const cumReviews = await this.cumulativeSignalAt(
      game.id,
      SignalMetric.STEAM_REVIEWS,
      anchor.observedAt,
    );
    if (cumReviews === null || cumReviews < RESIDUAL_MIN_REVIEWS) return null;

    const pcUnits = cumReviews * this.kEra(anchor.observedAt.getUTCFullYear());
    const pcShare = pcUnits / anchor.scaleUnits;
    if (!(pcShare > 0) || pcShare >= RESIDUAL_MAX_PC_SHARE) return null;

    return this.distributeConsoleResidual(
      game,
      anchor.observedAt,
      anchor.scaleUnits,
      pcUnits,
    );
  }

  /**
   * Split a GLOBAL total into shares given a known/estimated PC figure: PC keeps
   * `pcUnits`, and the console residual (`globalUnits − pcUnits`) is divided
   * across the game's present console platforms by ratings (only when EVERY
   * present console has a count — a ratio needs both sides) or by fixed priors
   * (the common case, since Xbox/Switch ratings are near-absent). Returns `null`
   * for PC-only games or when the PC figure is not a minority of the total.
   */
  private async distributeConsoleResidual(
    game: Game,
    at: Date,
    globalUnits: number,
    pcUnits: number,
  ): Promise<PlatformShareVector | null> {
    const platforms = new Set(game.platforms ?? []);
    const consolePlats = (
      [Platform.PLAYSTATION, Platform.XBOX, Platform.SWITCH] as const
    ).filter((p) => platforms.has(p));
    if (consolePlats.length === 0) return null;
    if (!(pcUnits > 0) || pcUnits >= globalUnits) return null;

    const consoleUnits = globalUnits - pcUnits;

    const metricByPlat = {
      [Platform.PLAYSTATION]: SignalMetric.PS_RATINGS,
      [Platform.XBOX]: SignalMetric.XBOX_RATINGS,
      [Platform.SWITCH]: SignalMetric.SWITCH_RATINGS,
    };
    const weightByPlat = {
      [Platform.PLAYSTATION]: PLATFORM_UNIT_WEIGHT.ps,
      [Platform.XBOX]: PLATFORM_UNIT_WEIGHT.xbox,
      [Platform.SWITCH]: PLATFORM_UNIT_WEIGHT.switch,
    };
    const priorByPlat = {
      [Platform.PLAYSTATION]: CONSOLE_SPLIT_PRIOR.ps,
      [Platform.XBOX]: CONSOLE_SPLIT_PRIOR.xbox,
      [Platform.SWITCH]: CONSOLE_SPLIT_PRIOR.switch,
    };

    const ratings = await Promise.all(
      consolePlats.map((p) =>
        this.cumulativeSignalAt(game.id, metricByPlat[p], at),
      ),
    );
    const allRated =
      consolePlats.length > 1 && ratings.every((r) => r !== null && r > 0);

    const rawWeights = consolePlats.map((p, i) =>
      allRated ? (ratings[i] as number) * weightByPlat[p] : priorByPlat[p],
    );
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) return null;

    const shares = { pc: pcUnits, ps: 0, xbox: 0, switch: 0 };
    consolePlats.forEach((p, i) => {
      const units = consoleUnits * (rawWeights[i] / weightSum);
      if (p === Platform.PLAYSTATION) shares.ps = units;
      else if (p === Platform.XBOX) shares.xbox = units;
      else shares.switch = units;
    });

    const total = shares.pc + shares.ps + shares.xbox + shares.switch;
    if (total <= 0) return null;
    this.logger.debug(
      `residual split ${game.name}: pcShare=${(shares.pc / total).toFixed(
        2,
      )} console=${Math.round(consoleUnits)} (${allRated ? 'ratings' : 'prior'})`,
    );
    return sharesFromUnits(shares);
  }

  /**
   * Proxy split by platform. Ratings/reviews counters are turned into
   * unit-equivalents with fixed weights (Boxleiter midpoints) and then
   * normalised into shares that sum to 1.0. Returns `null` when we
   * lack the coverage — i.e. either no PC signal, or no console signal
   * at all, or the total falls below `MIN_PLATFORM_TOTAL_UNITS`.
   *
   * This is the only piece of the vector NOT validated against the
   * leak (which is PC-only). Consumers should treat it as noisier than
   * the curve / reviews→units fields.
   */
  private async computePlatformSharesFromRatings(
    gameId: string,
    at: Date,
  ): Promise<{
    pc: number;
    ps: number;
    xbox: number;
    switch: number;
  } | null> {
    const pcReviews = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.STEAM_REVIEWS,
      at,
    );
    const psRatings = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.PS_RATINGS,
      at,
    );
    const xboxRatings = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.XBOX_RATINGS,
      at,
    );
    const switchRatings = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.SWITCH_RATINGS,
      at,
    );

    const pcUnits = (pcReviews ?? 0) * PLATFORM_UNIT_WEIGHT.pc;
    const psUnits = (psRatings ?? 0) * PLATFORM_UNIT_WEIGHT.ps;
    const xboxUnits = (xboxRatings ?? 0) * PLATFORM_UNIT_WEIGHT.xbox;
    const switchUnits = (switchRatings ?? 0) * PLATFORM_UNIT_WEIGHT.switch;

    const consoleUnits = psUnits + xboxUnits + switchUnits;
    if (pcUnits <= 0 || consoleUnits <= 0) return null;

    const total = pcUnits + consoleUnits;
    if (total < MIN_PLATFORM_TOTAL_UNITS) return null;

    return {
      pc: pcUnits / total,
      ps: psUnits / total,
      xbox: xboxUnits / total,
      switch: switchUnits / total,
    };
  }

  /**
   * Observed "launch peak CCU → week-1 units" ratio, mirroring how
   * `estimateFirstWeekExtrapolationForPc` consumes
   * `GenreProfile.peakCcuToWeekOne*`:
   *
   *   week1Units = launchPeakCCU × ratio          (estimation)
   *   ratio      = week1Units / launchPeakCCU      (this observation)
   *
   * `launchPeakCCU` is the largest `STEAM_CONCURRENT` over the launch month
   * and the following one (see `LAUNCH_CCU_WINDOW_MONTHS`) — wide enough to
   * catch the monthly leak points that a 14-day window misses. `week1Units`
   * is derived from the anchor's own signals — week-1 cumulative reviews
   * scaled by the PC Boxleiter ratio. `reviewsToUnits` arrives normalised to
   * the current review-rate era, so we shift it back to the release era (where
   * the week-1 reviews were counted) before pairing the two. Returns `null`
   * when either side is missing, when the launch peak is not representative of
   * the game's all-time peak, or when the ratio exceeds the physical ceiling;
   * the launcher / Steam-share correction stays in the estimator (applied
   * uniformly on top), matching the hand-set genre-profile values it replaces.
   */
  private async computePeakCcuRatio(
    gameId: string,
    releaseDate: Date,
    reviewsToUnits: number | null,
  ): Promise<number | null> {
    if (reviewsToUnits === null || reviewsToUnits <= 0) return null;

    const windowStart = new Date(
      Date.UTC(releaseDate.getUTCFullYear(), releaseDate.getUTCMonth(), 1),
    );
    const windowEnd = new Date(
      Date.UTC(
        releaseDate.getUTCFullYear(),
        releaseDate.getUTCMonth() + LAUNCH_CCU_WINDOW_MONTHS,
        1,
      ),
    );
    const [launchRow, allTimeRow] = await Promise.all([
      this.signals
        .createQueryBuilder('s')
        .select('MAX(s.value)', 'value')
        .where('s."gameId" = :gameId', { gameId })
        .andWhere('s.metric = :metric', {
          metric: SignalMetric.STEAM_CONCURRENT,
        })
        .andWhere('s."capturedAt" >= :start AND s."capturedAt" < :end', {
          start: windowStart,
          end: windowEnd,
        })
        .getRawOne<{ value: string | null }>(),
      this.signals
        .createQueryBuilder('s')
        .select('MAX(s.value)', 'value')
        .where('s."gameId" = :gameId', { gameId })
        .andWhere('s.metric = :metric', {
          metric: SignalMetric.STEAM_CONCURRENT,
        })
        .getRawOne<{ value: string | null }>(),
    ]);
    const launchPeak = launchRow?.value != null ? Number(launchRow.value) : 0;
    if (!Number.isFinite(launchPeak) || launchPeak <= 0) return null;

    const allTimePeak =
      allTimeRow?.value != null ? Number(allTimeRow.value) : launchPeak;
    if (launchPeak < MIN_LAUNCH_PEAK_ALLTIME_FRAC * allTimePeak) return null;

    const week1Reviews = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.STEAM_REVIEWS,
      new Date(releaseDate.getTime() + 7 * DAY_MS),
    );
    if (week1Reviews === null || week1Reviews <= 0) return null;

    // Shift the current-era PC Boxleiter back to the release era so it pairs
    // with the (release-era) week-1 review count.
    const nowYear = new Date().getUTCFullYear();
    const launchEraRatio =
      reviewsToUnits *
      (this.kEra(releaseDate.getUTCFullYear()) / this.kEra(nowYear));
    const week1Units = week1Reviews * launchEraRatio;
    const ratio = week1Units / launchPeak;
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    if (ratio > MAX_PEAK_CCU_RATIO) return null;
    return ratio;
  }

  /**
   * Composite quality signal in [0, 1] used by the matcher to weight
   * anchors. Blends:
   *   - curve coverage (# of normalised points defined)
   *   - anchor provenance (declared milestone > leak fallback)
   *   - recency (matches decay in `RECENCY_STEPS`)
   */
  private computeQuality(
    anchor: AnchorSelection,
    curve: CurveVector,
    reviewsToUnits: number | null,
    globalReviewsToUnits: number | null,
  ): number {
    const curvePoints = (
      [curve.s1, curve.m1, curve.m3, curve.m6, curve.a1, curve.a2] as Array<
        number | null
      >
    ).filter((v) => v !== null).length;
    const curveScore = curvePoints / CURVE_CHECKPOINTS.length;

    // Both anchor sources are treated as fully reliable: a declared
    // worldwide milestone and the 2018 Steam leak are equally trustworthy
    // for scale — on a paid game a Steam owner is a paying buyer (F2P is
    // excluded upstream), so the leak's owner count is ground truth, not
    // an estimate. Provenance therefore no longer discriminates between
    // the two sources; the leak's age is still handled by `recencyScore`.
    const provenanceScore = 1.0;

    // A measured sales ratio — the PC Boxleiter OR the worldwide ratio — makes
    // the anchor far more informative. Global-only games (only
    // `globalReviewsToUnits`) are credited the same as PC-scoped ones.
    const ratioScore =
      reviewsToUnits !== null || globalReviewsToUnits !== null ? 1.0 : 0.4;

    const ageYears =
      Math.max(0, Date.now() - anchor.observedAt.getTime()) / YEAR_MS;
    const recencyStep = RECENCY_STEPS.find(
      (step) => ageYears <= step.maxAgeYears,
    );
    const recencyScore = recencyStep?.weight ?? 0.5;

    // Weighted mean; weights sum to 1.0 to keep the score in [0, 1].
    return (
      0.35 * curveScore +
      0.25 * provenanceScore +
      0.2 * ratioScore +
      0.2 * recencyScore
    );
  }

  private isEligible(
    anchor: AnchorSelection,
    curve: CurveVector,
    reviewsToUnits: number | null,
    globalReviewsToUnits: number | null,
  ): boolean {
    if (!Number.isFinite(anchor.scaleUnits) || anchor.scaleUnits <= 0) {
      return false;
    }
    const definedCurvePoints = (
      [curve.s1, curve.m1, curve.m3, curve.m6, curve.a1, curve.a2] as Array<
        number | null
      >
    ).filter((v) => v !== null).length;
    // A measured ratio (PC Boxleiter OR worldwide) is enough on its own; a
    // global-only game with `globalReviewsToUnits` is now a usable anchor.
    if (
      reviewsToUnits === null &&
      globalReviewsToUnits === null &&
      definedCurvePoints < MIN_CURVE_POINTS_WITHOUT_RATIO
    ) {
      return false;
    }
    return true;
  }

  /**
   * Latest cumulative value for a signal at or before `cutoff`. Uses a
   * single indexed query (`signal_snapshot` is indexed on
   * `(gameId, metric, capturedAt)`), so batch-scanning many games
   * remains cheap even in a serverless invocation.
   */
  private async cumulativeSignalAt(
    gameId: string,
    metric: SignalMetric,
    cutoff: Date,
  ): Promise<number | null> {
    const row = await this.signals
      .createQueryBuilder('s')
      .select('s.value', 'value')
      .where('s."gameId" = :gameId', { gameId })
      .andWhere('s.metric = :metric', { metric })
      .andWhere('s."capturedAt" <= :cutoff', { cutoff })
      // Reconstructed rows never feed platform-share computation.
      .andWhere('s.synthetic = false')
      .orderBy('s."capturedAt"', 'DESC')
      .limit(1)
      .getRawOne<{ value: string }>();
    return row ? Number(row.value) : null;
  }

  /**
   * Static shape hint the matcher needs — expose the ordered curve
   * checkpoint keys so it can iterate anchors without duplicating the
   * schema.
   */
  static curveKeys(): readonly CurveKey[] {
    return CURVE_CHECKPOINTS.map((c) => c.key);
  }
}

/**
 * Geometric mean (log-10 space) of a set of PC Boxleiter ratios, after dropping
 * high outliers. Log space keeps the mean from being dragged by a single
 * inflated point; the outlier trim removes a lone ratio that sits far above the
 * others (e.g. a leak owner count bundling non-buyers). Returns `null` when no
 * positive ratio survives.
 */
function logMeanOfRatios(ratios: number[]): number | null {
  const positive = ratios.filter((r) => Number.isFinite(r) && r > 0);
  if (positive.length === 0) return null;
  const kept = rejectHighRatioOutliers(
    positive,
    REVIEWS_TO_UNITS_OUTLIER_FACTOR,
  );
  const meanLog = kept.reduce((sum, r) => sum + Math.log10(r), 0) / kept.length;
  return Math.pow(10, meanLog);
}

/**
 * Normalise raw per-platform units into shares summing to 1.0. Returns `null`
 * when the total is non-positive (nothing meaningful to split).
 */
function sharesFromUnits(
  units: PlatformShareVector,
): PlatformShareVector | null {
  const total = units.pc + units.ps + units.xbox + units.switch;
  if (!(total > 0)) return null;
  return {
    pc: units.pc / total,
    ps: units.ps / total,
    xbox: units.xbox / total,
    switch: units.switch / total,
  };
}

/**
 * Drop ratios above `factor` × the median. Mirrors the matcher's outlier guard
 * so calibration and aggregation reject the same shape of inflated ratio. Never
 * trims below three survivors, and is a no-op below four points.
 */
function rejectHighRatioOutliers(ratios: number[], factor: number): number[] {
  if (ratios.length < 4) return ratios;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (!Number.isFinite(median) || median <= 0) return ratios;
  const ceiling = factor * median;
  const kept = ratios.filter((r) => r <= ceiling);
  return kept.length >= 3 ? kept : ratios;
}

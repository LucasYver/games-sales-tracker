import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Game,
  Milestone,
  ReferenceProfile,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
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

interface AnchorSelection {
  observedAt: Date;
  scaleUnits: number;
  hasMilestone: boolean;
  source: SalesSource | 'LEAK';
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
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game || game.isFree) {
      await this.anchors.delete({ gameId });
      return null;
    }

    const anchor = await this.pickAnchor(gameId);
    if (!anchor) {
      await this.anchors.delete({ gameId });
      return null;
    }

    // Raw ratio = units/reviews at the observation date; `reviewsToUnits` is
    // the same value normalised to the current review-rate era (what the
    // estimator applies to current reviews). The launch-window CCU ratio pairs
    // with launch-era reviews, so it keeps the raw (observation-era) ratio.
    const rawReviewsToUnits = await this.computeReviewsToUnits(gameId, anchor);
    const reviewsToUnits =
      rawReviewsToUnits !== null
        ? rawReviewsToUnits * this.reviewRateEraFactor(anchor.observedAt)
        : null;

    const curve = game.releaseDate
      ? await this.computeCurve(gameId, game.releaseDate)
      : this.emptyCurve();

    const platformShares = await this.computePlatformShares(
      gameId,
      anchor.observedAt,
    );

    const peakCcuRatio = game.releaseDate
      ? await this.computePeakCcuRatio(
          gameId,
          game.releaseDate,
          rawReviewsToUnits,
        )
      : null;

    const qualityScore = this.computeQuality(anchor, curve, reviewsToUnits);

    if (!this.isEligible(anchor, curve, reviewsToUnits)) {
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
    const milestone = await this.milestones
      .createQueryBuilder('m')
      .where('m."gameId" = :gameId', { gameId })
      .andWhere('m."rejectedAt" IS NULL')
      .andWhere('m."isEngagement" = false')
      .andWhere('m."reportedAt" IS NOT NULL')
      .andWhere("m.source <> 'STEAM_LEAK'")
      .orderBy('m."reportedAt"', 'DESC')
      .getOne();

    if (milestone?.reportedAt) {
      return {
        observedAt: milestone.reportedAt,
        scaleUnits: Number(milestone.units),
        hasMilestone: true,
        source: milestone.source,
      };
    }

    const leak = await this.signals
      .createQueryBuilder('s')
      .where('s."gameId" = :gameId', { gameId })
      .andWhere('s.metric = :metric', {
        metric: SignalMetric.STEAM_PLAYERS_LEAK,
      })
      .orderBy('s."capturedAt"', 'DESC')
      .getOne();

    if (leak) {
      return {
        observedAt: leak.capturedAt,
        // Leak counts are unique-players on paid games — treated as a
        // conservative proxy for paid buyers with no further scaling
        // (matches how `BackfillSteamLeakMilestones` records them).
        scaleUnits: Number(leak.value),
        hasMilestone: false,
        source: 'LEAK',
      };
    }

    return null;
  }

  /**
   * Raw PC Boxleiter-equivalent: `units / cumulativeReviews` **at the anchor
   * date** (observation-era ratio, before era normalisation). `null` when the
   * game has no Steam review coverage close to the observation window (never
   * worth persisting as a ratio then). Callers apply
   * `reviewRateEraFactor(observedAt)` to shift it to the current review-rate era
   * before storing it as `reviewsToUnits`.
   */
  private async computeReviewsToUnits(
    gameId: string,
    anchor: AnchorSelection,
  ): Promise<number | null> {
    const cumReviews = await this.cumulativeSignalAt(
      gameId,
      SignalMetric.STEAM_REVIEWS,
      anchor.observedAt,
    );
    if (cumReviews === null || cumReviews <= 0) return null;
    if (anchor.scaleUnits <= 0) return null;
    return anchor.scaleUnits / cumReviews;
  }

  /**
   * Multiplicative factor that shifts an observation-era units/reviews ratio to
   * the current review-rate era: `kEra(now) / kEra(observedYear)` (≤ 1 for past
   * observations, since Steam's review rate keeps rising). Years before
   * `ERA_BASE_YEAR` are clamped to it to avoid extrapolating the fit outside its
   * support.
   */
  private reviewRateEraFactor(observedAt: Date): number {
    const kEra = (year: number): number => {
      const clamped = Math.max(ERA_BASE_YEAR, year);
      return (
        ERA_AMP * Math.exp(-ERA_SLOPE * (clamped - ERA_BASE_YEAR)) + ERA_FLOOR
      );
    };
    const nowYear = new Date().getUTCFullYear();
    const factor = kEra(nowYear) / kEra(observedAt.getUTCFullYear());
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
  private async computePlatformShares(
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
   * scaled by its measured `reviewsToUnits`, a within-game shape ratio in
   * which the review-rate era cancels out. Returns `null` when either side
   * is missing, when the launch peak is not representative of the game's
   * all-time peak, or when the ratio exceeds the physical ceiling; the
   * launcher / Steam-share correction stays in the estimator (applied
   * uniformly on top), so we deliberately keep the raw ratio here, matching
   * the hand-set genre-profile values it replaces.
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

    const week1Units = week1Reviews * reviewsToUnits;
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

    const ratioScore = reviewsToUnits !== null ? 1.0 : 0.4;

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
  ): boolean {
    if (!Number.isFinite(anchor.scaleUnits) || anchor.scaleUnits <= 0) {
      return false;
    }
    const definedCurvePoints = (
      [curve.s1, curve.m1, curve.m3, curve.m6, curve.a1, curve.a2] as Array<
        number | null
      >
    ).filter((v) => v !== null).length;
    if (
      reviewsToUnits === null &&
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

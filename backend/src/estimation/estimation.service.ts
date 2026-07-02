import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  EstimationMethod,
  Game,
  Milestone,
  Platform,
  SalesEstimate,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import {
  AGGREGATED_METHOD_CODE,
  EstimationMethodService,
} from './estimation-method.service';
import { type ResolvedGenreProfile } from '../reference-profiles/sales-profile-resolver.service';
import { SalesProfileResolverService } from '../reference-profiles/sales-profile-resolver.service';
import {
  CALIBRATED_MULTIPLIER_SPREAD,
  FIRST_WEEK_BUCKET_LARGE_YEAR1_RATIO,
  FIRST_WEEK_BUCKET_SMALL_YEAR1_RATIO,
  FIRST_WEEK_BUCKET_THRESHOLD,
  FIRST_WEEK_ESTIMATE_MAX_UNITS,
  FIRST_WEEK_ESTIMATE_MIN_UNITS,
  DEFAULT_STEAM_SHARE_PCT,
  FIRST_WEEK_PEAK_CCU_HIGH,
  FIRST_WEEK_PEAK_CCU_LOW,
  FIRST_WEEK_PEAK_CCU_WINDOW_DAYS,
  launcherFactorFromSteamShare,
  launcherMethodTagFromShare,
  type SteamShareRange,
  PC_BOXLEITER_DEFAULT_HIGH,
  PC_BOXLEITER_DEFAULT_LOW,
  PC_BOXLEITER_PLAUSIBLE_MAX,
  PC_BOXLEITER_PLAUSIBLE_MIN,
  PS_BOXLEITER_DEFAULT_HIGH,
  PS_BOXLEITER_DEFAULT_LOW,
  PS_BOXLEITER_PLAUSIBLE_MAX,
  PS_BOXLEITER_PLAUSIBLE_MIN,
  XBOX_BOXLEITER_DEFAULT_HIGH,
  XBOX_BOXLEITER_DEFAULT_LOW,
  XBOX_BOXLEITER_PLAUSIBLE_MAX,
  XBOX_BOXLEITER_PLAUSIBLE_MIN,
  ageInDays,
  firstWeekProjectionMultiplier,
  genreProjectionMultiplier,
} from '../games/sales-modeling.constants';

/**
 * Steam-share range for a game, falling back to the neutral default when
 * the game has no curated publisher record.
 */
function steamShareForGame(game: Game): SteamShareRange {
  return {
    low: game.publisherRecord?.steamSharePctLow ?? DEFAULT_STEAM_SHARE_PCT,
    high: game.publisherRecord?.steamSharePctHigh ?? DEFAULT_STEAM_SHARE_PCT,
  };
}

// Calibration only trusts a milestone when a signal snapshot exists
// within this window of the milestone's reported date — otherwise
// units/signals would mix points from very different times and produce
// a bogus multiplier.
const CALIBRATION_WINDOW_DAYS = 365;

// Minimum estimated share of a platform in the worldwide breakdown
// required to calibrate it from a GLOBAL record (see
// `recalibrateFromGlobal`). Platforms whose proxy share falls below this
// threshold keep their default multiplier instead — splitting a
// worldwide figure over a marginal platform produces volatile, untrust-
// worthy multipliers.
const GLOBAL_SPLIT_MIN_PLATFORM_SHARE = 0.05;

// How aggressively `aggregateMethods` widens the combined band when the
// input methods disagree about the midpoint. 0 = no inflation (pure
// weighted average), 1 = inflate by the full relative spread. Picked
// conservatively at 0.5 until we have multiple active methods to
// observe and tune against.
const AGGREGATION_DISAGREEMENT_ALPHA = 0.5;

/**
 * Knobs to flip estimation into "pure algo" mode. When set,
 * `resolveMultiplier` ignores `Game.calibratedMultiplier*` and falls
 * back to the platform default range, so the produced
 * `EstimateResult`s show what the model would have said with zero
 * declared-figure help. Used by `snapshotReconcile` to populate the
 * `pureEstimatedToday*` columns alongside the regular reconciled
 * headline.
 */
export interface EstimateOptions {
  ignoreCalibration?: boolean;
}

// ───── Breakdown types (diagnostic / read-only) ──────────────────────────

export interface BoxleiterBreakdownEntry {
  type: 'boxleiter';
  platform: Platform;
  method: string;
  signal: { metric: SignalMetric; value: number; capturedAt: string };
  calibratedValue: number | null;
  isCalibrated: boolean;
  // Where the default multiplier band comes from: the data-driven
  // matcher (reviewsToUnits → Boxleiter), the global constant fallback
  // (cold-start, no matched anchors), or a per-game calibrated figure.
  multiplierSource: 'matcher' | 'global' | 'calibrated';
  multiplierLow: number;
  multiplierHigh: number;
  finalLow: number;
  finalHigh: number;
}

export interface FirstWeekBreakdownEntry {
  type: 'first-week';
  method: string;
  launchPeakValue: number;
  launchPeakCapturedAt: string;
  ccuRatioLow: number;
  ccuRatioHigh: number;
  weekOneFinalLow: number;
  weekOneFinalHigh: number;
  ageDays: number;
  projectionMultiplier: number;
  m1: number | null;
  // Whether the CCU→week-1 ratio and the projection curve came from the
  // matcher profile or from the global size-bucket fallback.
  profileSource: 'matcher' | 'global';
  finalLow: number;
  finalHigh: number;
}

/**
 * Console ventilation step: a console platform's band is not measured
 * from a signal but derived from an already-aggregated source platform
 * (PC or PS) scaled by the matcher's platform-share ratio.
 *
 *   targetUnits = sourceUnits × (targetShare / sourceShare)
 */
export interface SplitBreakdownEntry {
  type: 'split';
  platform: Platform;
  method: string;
  sourcePlatform: Platform;
  sourceLow: number;
  sourceHigh: number;
  sourceShare: number;
  targetShare: number;
  ratio: number;
  finalLow: number;
  finalHigh: number;
}

export interface WeightedEntry {
  method: string;
  weight: number;
}

export interface PlatformBreakdownResult {
  platform: Platform;
  entries: (
    | BoxleiterBreakdownEntry
    | FirstWeekBreakdownEntry
    | SplitBreakdownEntry
  )[];
  weightedEntries: WeightedEntry[];
  totalWeight: number;
  weightedLow: number;
  weightedHigh: number;
  disagreement: number;
  inflate: number;
  aggregateLow: number;
  aggregateHigh: number;
}

export interface EstimateBreakdownResult {
  computedAt: string;
  platforms: PlatformBreakdownResult[];
  pureTotal: { low: number; high: number } | null;
  declared: {
    units: number;
    source: string;
    reportedAt: string | null;
  } | null;
}

interface AggregateTrace {
  weightedEntries: WeightedEntry[];
  totalWeight: number;
  weightedLow: number;
  weightedHigh: number;
  disagreement: number;
  inflate: number;
  aggregateLow: number;
  aggregateHigh: number;
}

/**
 * Mutable accumulator threaded (optionally) through the live estimation
 * pipeline. When present, each stage records its intermediate inputs and
 * outputs so an admin breakdown reflects *exactly* what the real
 * calculation did — no parallel re-implementation. When absent (the
 * production path), the pipeline behaves identically with zero overhead.
 */
export interface EstimateTrace {
  boxleiter: BoxleiterBreakdownEntry[];
  firstWeek: FirstWeekBreakdownEntry[];
  split: SplitBreakdownEntry[];
  aggregates: Map<Platform, AggregateTrace>;
}

function createEstimateTrace(): EstimateTrace {
  return { boxleiter: [], firstWeek: [], split: [], aggregates: new Map() };
}

interface PlatformConfig {
  platform: Platform;
  signalMetric: SignalMetric;
  defaultLow: number;
  defaultHigh: number;
  plausibleMin: number;
  plausibleMax: number;
  // How a stored Game row exposes the calibrated multiplier for this
  // platform. The originating source is stored alongside the value via
  // `write` for traceability but is not read back at estimate time —
  // the spread is uniform across sources.
  read: (game: Game) => number | null;
  write: (gameId: string, value: number, source: SalesSource) => Promise<void>;
  methodPrefix: 'boxleiter' | 'ps-ratings-boxleiter' | 'xbox-ratings-boxleiter';
}

export interface EstimateResult {
  platform: Platform;
  estimatedLow: number;
  estimatedHigh: number;
  method: string;
}

@Injectable()
export class EstimationService {
  private readonly logger = new Logger(EstimationService.name);
  private readonly platforms: PlatformConfig[];

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    private readonly methods: EstimationMethodService,
    private readonly salesProfile: SalesProfileResolverService,
  ) {
    this.platforms = [
      {
        platform: Platform.PC,
        signalMetric: SignalMetric.STEAM_REVIEWS,
        defaultLow: PC_BOXLEITER_DEFAULT_LOW,
        defaultHigh: PC_BOXLEITER_DEFAULT_HIGH,
        plausibleMin: PC_BOXLEITER_PLAUSIBLE_MIN,
        plausibleMax: PC_BOXLEITER_PLAUSIBLE_MAX,
        read: (g) => g.calibratedMultiplier,
        write: (id, value, source) =>
          this.games
            .update(id, {
              calibratedMultiplier: value,
              calibrationSourcePc: source,
            })
            .then(() => {}),
        methodPrefix: 'boxleiter',
      },
      {
        platform: Platform.PLAYSTATION,
        signalMetric: SignalMetric.PS_RATINGS,
        defaultLow: PS_BOXLEITER_DEFAULT_LOW,
        defaultHigh: PS_BOXLEITER_DEFAULT_HIGH,
        plausibleMin: PS_BOXLEITER_PLAUSIBLE_MIN,
        plausibleMax: PS_BOXLEITER_PLAUSIBLE_MAX,
        read: (g) => g.calibratedPsMultiplier,
        write: (id, value, source) =>
          this.games
            .update(id, {
              calibratedPsMultiplier: value,
              calibrationSourcePs: source,
            })
            .then(() => {}),
        methodPrefix: 'ps-ratings-boxleiter',
      },
      {
        platform: Platform.XBOX,
        signalMetric: SignalMetric.XBOX_RATINGS,
        defaultLow: XBOX_BOXLEITER_DEFAULT_LOW,
        defaultHigh: XBOX_BOXLEITER_DEFAULT_HIGH,
        plausibleMin: XBOX_BOXLEITER_PLAUSIBLE_MIN,
        plausibleMax: XBOX_BOXLEITER_PLAUSIBLE_MAX,
        read: (g) => g.calibratedXboxMultiplier,
        write: (id, value, source) =>
          this.games
            .update(id, {
              calibratedXboxMultiplier: value,
              calibrationSourceXbox: source,
            })
            .then(() => {}),
        methodPrefix: 'xbox-ratings-boxleiter',
      },
    ];
  }

  /**
   * Estimate sales for every supported platform. For each platform, returns
   * the classical Boxleiter (signal × per-platform multiplier)
   *
   * Platforms with no usable signal are skipped silently; the game is
   * also skipped entirely if free-to-play.
   *
   * `asOf` time-travels every signal lookup to that date (only snapshots
   * with `capturedAt <= asOf` are considered). Used by the historical
   * rebuild pipeline; defaults to now.
   */
  async estimateAllPlatforms(
    gameId: string,
    asOf?: Date,
    opts: EstimateOptions = {},
    trace?: EstimateTrace,
  ): Promise<EstimateResult[]> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { publisherRecord: true },
    });
    if (!game || game.isFree) return [];

    const results: EstimateResult[] = [];
    for (const platform of game.platforms) {
      const cfg = this.platforms.find((p) => p.platform === platform);
      if (!cfg) continue;
      const boxleiter = await this.estimateForPlatform(
        game,
        cfg,
        asOf,
        opts,
        trace,
      );
      if (boxleiter) results.push(boxleiter);
    }

    // Lifecycle method: project today's PC units from the all-time
    // Steam peak CCU and (when captured close to launch) review count,
    // bucketed by launch size. Independent of any calibrated multiplier
    // so it adds signal especially for newer titles.
    const firstWeek = await this.estimateFirstWeekExtrapolationForPc(
      game,
      asOf,
      trace,
    );
    if (firstWeek) results.push(firstWeek);

    return results;
  }

  /**
   * Persist estimates as if we had run `computeAndStore` at `asOf`. Unlike
   * the live flow, we DO NOT recalibrate: the calibration uses the latest
   * declared figure available anyway, which is the same when rebuilding
   * the past with current knowledge. Used by the historical rebuild
   * pipeline (`GamesService.rebuildEstimateHistory`).
   */
  async computeAndStoreAt(
    gameId: string,
    asOf: Date,
  ): Promise<EstimateResult[]> {
    const results = await this.estimateAllPlatforms(gameId, asOf);
    if (results.length === 0) return [];

    await this.persistEstimates(gameId, results, asOf);
    return results;
  }

  /**
   * Persist one `SalesEstimate` row per (platform, method) and then layer
   * an `aggregated` row per platform on top, combining every enabled
   * method for that platform at the same `computedAt`. The aggregate is
   * what `GamesService.reconcile` consumes by default — see
   * `aggregateMethodsForPlatform` for the formula.
   *
   * `asOf` is propagated to every row's `computedAt` so historical
   * rebuilds produce a coherent point-in-time batch (all methods plus
   * the aggregate share the exact same timestamp).
   */
  private async persistEstimates(
    gameId: string,
    results: EstimateResult[],
    asOf?: Date,
  ): Promise<void> {
    const baseRows = results.map((r) => this.toSalesEstimate(gameId, r, asOf));
    await this.estimates.save(baseRows);

    const { aggregates, splits } = await this.aggregateResultsByPlatform(
      gameId,
      results,
    );

    if (splits.length > 0) {
      const splitRows = splits.map((s) =>
        this.toSalesEstimate(gameId, s, asOf),
      );
      await this.estimates.save(splitRows);
    }

    const aggregateMethod = this.methods.requireByCode(AGGREGATED_METHOD_CODE);
    const aggregateRows: SalesEstimate[] = [];
    for (const [platform, aggregate] of aggregates) {
      aggregateRows.push(
        this.buildAggregateRow(
          gameId,
          platform,
          aggregate,
          aggregateMethod.id,
          asOf,
        ),
      );
    }

    if (aggregateRows.length > 0) {
      await this.estimates.save(aggregateRows);
    }
  }

  /**
   * In-memory equivalent of `persistEstimates`' aggregation phase:
   * given a flat list of per-method results, returns the per-platform
   * `aggregated` consensus rows and the genre-console-split rows that
   * the pipeline would normally save. Used by `persistEstimates`
   * itself (so the live flow and the snapshot flow share the same
   * aggregation rules) and by `computePureAggregatesByPlatform` which
   * needs the aggregates without touching the database.
   *
   * Phase ordering (matters — Xbox depends on PS, PS depends on PC):
   *  1. Aggregate PC.
   *  2. Ventilate PC → PlayStation (genre-split).
   *  3. Aggregate PlayStation (boxleiter PS + PC→PS split).
   *  4. Ventilate to Xbox: prefer PS → Xbox when a PS aggregate exists
   *     (PS is the closest console proxy), fall back to PC → Xbox
   *     otherwise.
   *  5. Aggregate Xbox and any remaining platforms.
   */
  private async aggregateResultsByPlatform(
    gameId: string,
    results: EstimateResult[],
    trace?: EstimateTrace,
  ): Promise<{
    aggregates: Map<Platform, EstimateResult>;
    splits: EstimateResult[];
  }> {
    const byPlatform = new Map<Platform, EstimateResult[]>();
    for (const r of results) {
      const bucket = byPlatform.get(r.platform) ?? [];
      bucket.push(r);
      byPlatform.set(r.platform, bucket);
    }

    const aggregates = new Map<Platform, EstimateResult>();
    const splits: EstimateResult[] = [];

    const addSplit = (split: EstimateResult | null): void => {
      if (!split) return;
      splits.push(split);
      const bucket = byPlatform.get(split.platform) ?? [];
      bucket.push(split);
      byPlatform.set(split.platform, bucket);
    };

    // Phase 1 — aggregate PC first so the genre-console-split method
    // (Phase 2) can ventilate from a stable consensus PC band rather
    // than from a single underlying method (boxleiter vs first-week
    // can disagree wildly on day-0 releases).
    const pcResults = byPlatform.get(Platform.PC) ?? [];
    const pcAggregate =
      pcResults.length > 0
        ? this.aggregateMethodsForPlatform(pcResults, trace)
        : null;
    if (pcAggregate) aggregates.set(Platform.PC, pcAggregate);

    // Phase 2 — ventilate PC → PlayStation. Skipped silently when the
    // game's genres don't resolve a profile, when PC isn't aggregated,
    // or when the game isn't released on PS.
    if (pcAggregate) {
      const pcToPs = await this.computeGenreSplit(
        gameId,
        pcAggregate,
        Platform.PC,
        Platform.PLAYSTATION,
        'genre-console-split-from-pc-playstation',
        trace,
      );
      addSplit(pcToPs);
    }

    // Phase 3 — aggregate PlayStation now that any PC→PS split is in
    // its bucket alongside the boxleiter PS estimate.
    const psResults = byPlatform.get(Platform.PLAYSTATION) ?? [];
    const psAggregate =
      psResults.length > 0
        ? this.aggregateMethodsForPlatform(psResults, trace)
        : null;
    if (psAggregate) aggregates.set(Platform.PLAYSTATION, psAggregate);

    // Phase 4 — ventilate to Xbox. Prefer PS → Xbox (PS is the
    // closest console proxy and the Xbox Store rating signal has been
    // retired due to per-locale fragmentation); fall back to PC → Xbox
    // when no PS aggregate is available (PC-and-Xbox-only titles).
    let xboxSplit: EstimateResult | null = null;
    if (psAggregate) {
      xboxSplit = await this.computeGenreSplit(
        gameId,
        psAggregate,
        Platform.PLAYSTATION,
        Platform.XBOX,
        'genre-console-split-from-ps-xbox',
        trace,
      );
    }
    if (!xboxSplit && pcAggregate) {
      xboxSplit = await this.computeGenreSplit(
        gameId,
        pcAggregate,
        Platform.PC,
        Platform.XBOX,
        'genre-console-split-from-pc-xbox',
        trace,
      );
    }
    addSplit(xboxSplit);

    // Phase 5 — aggregate the remaining platforms (XBOX, …). XBOX now
    // sees the genre-split row; any disabled boxleiter Xbox row from
    // a stale signal is filtered out by `aggregateMethodsForPlatform`.
    for (const [platform, perPlatform] of byPlatform) {
      if (platform === Platform.PC || platform === Platform.PLAYSTATION) {
        continue;
      }
      const aggregate = this.aggregateMethodsForPlatform(perPlatform, trace);
      if (aggregate) aggregates.set(platform, aggregate);
    }

    return { aggregates, splits };
  }

  /**
   * Run the full estimation pipeline in "pure algo" mode (no
   * calibrated multipliers, no DB writes) and return only the
   * per-platform `aggregated` consensus rows. The splits and base
   * rows are computed in-memory then discarded — they would just
   * shadow the real (calibrated) rows in the admin view, which is
   * not what we want.
   *
   * Used by `GamesService.snapshotReconcile` to populate the
   * `pureEstimatedTodayLow/High` columns alongside the regular
   * headline.
   */
  async computePureAggregatesByPlatform(
    gameId: string,
    asOf?: Date,
  ): Promise<Map<Platform, EstimateResult>> {
    const results = await this.estimateAllPlatforms(gameId, asOf, {
      ignoreCalibration: true,
    });
    if (results.length === 0) return new Map();

    const { aggregates } = await this.aggregateResultsByPlatform(
      gameId,
      results,
    );
    return aggregates;
  }

  private buildAggregateRow(
    gameId: string,
    platform: Platform,
    aggregate: EstimateResult,
    aggregateMethodId: string,
    asOf?: Date,
  ): SalesEstimate {
    return this.estimates.create({
      gameId,
      platform,
      estimatedLow: aggregate.estimatedLow,
      estimatedHigh: aggregate.estimatedHigh,
      method: aggregate.method,
      methodId: aggregateMethodId,
      ...(asOf ? { computedAt: asOf } : {}),
    });
  }

  /**
   * Ventilate an aggregate from `sourcePlatform` into `targetPlatform`
   * using the game's resolved `GenreProfile`. Returns null when the
   * profile is missing, either share is zero, the source share would
   * divide by zero, or the game isn't released on the target platform
   * (inferring console sales for a PC-only indie would be nonsense).
   *
   *   targetUnits = sourceUnits × (targetShare / sourceShare)
   *
   * The Switch share is intentionally never used as a target: our
   * `Platform` enum doesn't include Switch (no reliable sales signal
   * either way), and folding it elsewhere would double-count nothing.
   *
   * Confidence is inherited as-is from the source aggregate (no extra
   * capping).
   */
  private async computeGenreSplit(
    gameId: string,
    sourceAggregate: EstimateResult,
    sourcePlatform: Platform,
    targetPlatform: Platform,
    methodCode: string,
    trace?: EstimateTrace,
  ): Promise<EstimateResult | null> {
    const game = await this.games.findOne({
      where: { id: gameId },
      select: {
        id: true,
        platforms: true,
        // Fields consumed by the matcher (`SalesProfileResolverService`).
        categories: true,
        genres: true,
        steamTags: true,
        publisherId: true,
        releaseDate: true,
        developer: true,
        franchiseSlug: true,
        isAnnualIteration: true,
        liveService: true,
      },
    });
    if (!game) return null;

    const releasedPlatforms = new Set(game.platforms ?? []);
    if (!releasedPlatforms.has(targetPlatform)) return null;

    const profile = await this.salesProfile.resolveForGame(game);
    if (!profile) return null;

    const sourceShare = this.profileShare(profile, sourcePlatform);
    const targetShare = this.profileShare(profile, targetPlatform);
    if (sourceShare <= 0 || targetShare <= 0) return null;

    const ratio = targetShare / sourceShare;
    const low = Math.round(sourceAggregate.estimatedLow * ratio);
    const high = Math.round(sourceAggregate.estimatedHigh * ratio);
    if (high <= 0 || low > high) return null;

    if (trace) {
      trace.split.push({
        type: 'split',
        platform: targetPlatform,
        method: methodCode,
        sourcePlatform,
        sourceLow: sourceAggregate.estimatedLow,
        sourceHigh: sourceAggregate.estimatedHigh,
        sourceShare,
        targetShare,
        ratio,
        finalLow: low,
        finalHigh: high,
      });
    }

    return {
      platform: targetPlatform,
      estimatedLow: low,
      estimatedHigh: high,
      method: methodCode,
    };
  }

  private profileShare(
    profile: ResolvedGenreProfile,
    platform: Platform,
  ): number {
    switch (platform) {
      case Platform.PC:
        return profile.pcShare;
      case Platform.PLAYSTATION:
        return profile.playstationShare;
      case Platform.XBOX:
        return profile.xboxShare;
      default:
        return 0;
    }
  }

  /**
   * Translate one `EstimateResult` into a `SalesEstimate` entity. Resolves
   * the canonical `methodId` from the method tag (stripping any dynamic
   * `+xxx` modifier suffixes) and keeps the full tag as the legacy
   * `method` string for backward compatibility.
   */
  private toSalesEstimate(
    gameId: string,
    result: EstimateResult,
    asOf?: Date,
  ): SalesEstimate {
    return this.estimates.create({
      gameId,
      platform: result.platform,
      estimatedLow: result.estimatedLow,
      estimatedHigh: result.estimatedHigh,
      method: result.method,
      methodId: this.resolveMethodId(result.method),
      ...(asOf ? { computedAt: asOf } : {}),
    });
  }

  private resolveMethodId(methodTag: string): string {
    const canonical = methodTag.replace(/\+[^+]+/g, '');
    return this.methods.requireByCode(canonical).id;
  }

  /**
   * Combine every method's `[low, high]` for a single platform into one
   * aggregated band. Weights come from `EstimationMethod.defaultWeight`
   * (rows with weight 0 are skipped). The combined spread is widened
   * proportionally to how much the inputs disagree about their midpoint:
   *
   *   weightedLow  = Σ (low_i  × w_i) / Σ w_i
   *   weightedHigh = Σ (high_i × w_i) / Σ w_i
   *   disagreement = (max(mid_i) − min(mid_i)) / weightedMid
   *   aggLow  = weightedLow  × (1 − α × disagreement)
   *   aggHigh = weightedHigh × (1 + α × disagreement)
   *
   * Single-method platforms (today's reality on every platform) collapse
   * to a copy of the input band — disagreement = 0 leaves the spread
   * untouched. Confidence is the **lowest** of the inputs: an aggregate
   * is no more confident than its weakest contributor.
   */
  private aggregateMethodsForPlatform(
    perPlatform: EstimateResult[],
    trace?: EstimateTrace,
  ): EstimateResult | null {
    const eligible = perPlatform
      .map((r) => {
        const method = this.methods.findByCode(
          r.method.replace(/\+[^+]+/g, ''),
        );
        return method ? { result: r, method } : null;
      })
      .filter(
        (
          entry,
        ): entry is { result: EstimateResult; method: EstimationMethod } =>
          entry !== null &&
          entry.method.isEnabled &&
          !entry.method.isAggregate &&
          Number(entry.method.defaultWeight) > 0,
      );
    if (eligible.length === 0) return null;

    // Blend weight is the static method `defaultWeight` only.
    // The aggregate range is driven purely by method weights and the genre-profile ratios.
    const methodWeight = (entry: {
      result: EstimateResult;
      method: EstimationMethod;
    }): number => Number(entry.method.defaultWeight);

    const totalWeight = eligible.reduce((sum, e) => sum + methodWeight(e), 0);
    if (totalWeight <= 0) return null;

    let weightedLow = 0;
    let weightedHigh = 0;
    let minMid = Infinity;
    let maxMid = -Infinity;

    for (const entry of eligible) {
      const { result } = entry;
      const weight = methodWeight(entry);
      weightedLow += result.estimatedLow * weight;
      weightedHigh += result.estimatedHigh * weight;
      const mid = (result.estimatedLow + result.estimatedHigh) / 2;
      if (mid < minMid) minMid = mid;
      if (mid > maxMid) maxMid = mid;
    }
    weightedLow /= totalWeight;
    weightedHigh /= totalWeight;

    const weightedMid = (weightedLow + weightedHigh) / 2;
    const disagreement = weightedMid > 0 ? (maxMid - minMid) / weightedMid : 0;
    const inflate = AGGREGATION_DISAGREEMENT_ALPHA * disagreement;

    const aggLow = Math.max(0, weightedLow * (1 - inflate));
    const aggHigh = weightedHigh * (1 + inflate);

    if (trace) {
      trace.aggregates.set(eligible[0].result.platform, {
        weightedEntries: eligible.map((entry) => ({
          method: entry.result.method,
          weight: Number(entry.method.defaultWeight),
        })),
        totalWeight,
        weightedLow: Math.round(weightedLow),
        weightedHigh: Math.round(weightedHigh),
        disagreement,
        inflate,
        aggregateLow: Math.round(aggLow),
        aggregateHigh: Math.round(aggHigh),
      });
    }

    return {
      platform: eligible[0].result.platform,
      estimatedLow: Math.round(aggLow),
      estimatedHigh: Math.round(aggHigh),
      method: AGGREGATED_METHOD_CODE,
    };
  }

  /**
   * Derive and persist this game's Boxleiter multipliers for every platform
   * from the worldwide declared figure. Milestones are worldwide totals, so
   * the declared units are split proportionally across platforms (using each
   * platform's static-default proxy weight) and each platform's multiplier is
   * derived from its share — see `recalibrateFromGlobal`.
   */
  async recalibrateAll(gameId: string): Promise<void> {
    await this.recalibrateFromGlobal(gameId);
    await this.recalibrateFromPcRegion(gameId);
  }

  // ───── internals ────────────────────────────────────────────────────────

  private async estimateForPlatform(
    game: Game,
    cfg: PlatformConfig,
    asOf?: Date,
    opts: EstimateOptions = {},
    trace?: EstimateTrace,
  ): Promise<EstimateResult | null> {
    const latestSignal = await this.signals.findOne({
      where: {
        gameId: game.id,
        metric: cfg.signalMetric,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { capturedAt: 'DESC' },
    });
    if (!latestSignal || latestSignal.value <= 0) return null;

    const signalValue = latestSignal.value;
    const profile = await this.salesProfile.resolveForGame(game);
    const profileDefaults = this.resolveProfileDefaults(cfg.platform, profile);
    const { low, high, method, isCalibrated } = this.resolveMultiplier(
      game,
      cfg,
      opts,
      profileDefaults,
    );

    // The publisher's Steam share only modulates the *PC* estimation today
    // (the Steam-vs-rest-of-PC fragmentation problem). PS / Xbox keep their
    // native multipliers untouched.
    const steamShare =
      cfg.platform === Platform.PC
        ? steamShareForGame(game)
        : { low: DEFAULT_STEAM_SHARE_PCT, high: DEFAULT_STEAM_SHARE_PCT };

    // Per-game calibration (from a declared OFFICIAL/MEDIA figure) has
    // already absorbed the launcher effect empirically — applying the
    // share scaling on top would double-count it. Only scale when we
    // fall back on the static default multiplier range.
    const reviewsScale =
      !isCalibrated && cfg.platform === Platform.PC
        ? launcherFactorFromSteamShare(steamShare)
        : { low: 1, high: 1 };

    const estimatedLow = signalValue * low * reviewsScale.low;
    const estimatedHigh = signalValue * high * reviewsScale.high;
    let finalMethod = method;

    if (cfg.platform === Platform.PC) {
      const profileTag = launcherMethodTagFromShare(steamShare);
      if (profileTag) finalMethod = `${finalMethod}${profileTag}`;
    }

    if (trace) {
      trace.boxleiter.push({
        type: 'boxleiter',
        platform: cfg.platform,
        method: finalMethod,
        signal: {
          metric: cfg.signalMetric,
          value: signalValue,
          capturedAt: latestSignal.capturedAt.toISOString(),
        },
        calibratedValue: cfg.read(game) ?? null,
        isCalibrated,
        multiplierSource: isCalibrated
          ? 'calibrated'
          : profileDefaults
            ? 'matcher'
            : 'global',
        multiplierLow: low,
        multiplierHigh: high,
        finalLow: Math.round(estimatedLow),
        finalHigh: Math.round(estimatedHigh),
      });
    }

    return {
      platform: cfg.platform,
      estimatedLow: Math.round(estimatedLow),
      estimatedHigh: Math.round(estimatedHigh),
      method: finalMethod,
    };
  }

  /**
   * Lifecycle estimate (PC): derive week-1 units from the all-time
   * Steam peak CCU, then project to "today" via a degressive curve
   *
   * Eligibility:
   *   - Game has a `releaseDate` and is past day 1.
   *   - We have at least one `STEAM_PEAK_CCU` snapshot (ordered by
   *     `value DESC` because the historical-import path writes peaks
   *     with the SteamCharts month of the peak as `capturedAt`).
   *
   * Launcher profile scaling (multi-store / launcher-primary) is applied
   * to the CCU input since the peak is Steam-captured — it shares the
   * same "Steam → total PC" correction as the Boxleiter reviews signal.
   */
  private async estimateFirstWeekExtrapolationForPc(
    game: Game,
    asOf?: Date,
    trace?: EstimateTrace,
  ): Promise<EstimateResult | null> {
    if (!game.releaseDate) return null;

    const referenceDate = asOf ?? new Date();
    const age = ageInDays(game.releaseDate, referenceDate);
    if (age <= 0) return null;

    const steamShare = steamShareForGame(game);
    const ccuScale = launcherFactorFromSteamShare(steamShare);

    // Week-1 peak only: the largest daily CCU captured in the 7 days
    // following release. A later all-time peak (sale, DLC, F2P switch)
    // does not represent the launch and must not drive the week-1
    // baseline. The window is further capped at `asOf` so historical
    // rebuilds never see a future peak. We read the daily STEAM_CONCURRENT
    // series (the SteamDB CSV import lands one peak value per day there),
    // not the all-time STEAM_PEAK_CCU.
    const weekOneEnd = new Date(
      game.releaseDate.getTime() +
        FIRST_WEEK_PEAK_CCU_WINDOW_DAYS * 24 * 3600 * 1000,
    );
    const windowEnd = asOf && asOf < weekOneEnd ? asOf : weekOneEnd;
    if (windowEnd < game.releaseDate) return null;
    const peak = await this.signals.findOne({
      where: {
        gameId: game.id,
        metric: SignalMetric.STEAM_CONCURRENT,
        capturedAt: Between(game.releaseDate, windowEnd),
      },
      order: { value: 'DESC' },
    });
    if (!peak || peak.value <= 0) return null;

    // Genre-aware peak-CCU → week-1 ratio. When the game's genres
    // resolve to a profile we use its empirical range (much lower for
    // high-engagement genres like grand strategy / MMO whose peak CCU
    // is large relative to sales); otherwise the genre-blind global
    // [LOW, HIGH] band is the fallback.
    const genreProfile = await this.salesProfile.resolveForGame(game);
    const ccuRatioLow = genreProfile
      ? genreProfile.peakCcuToWeekOneLow
      : FIRST_WEEK_PEAK_CCU_LOW;
    const ccuRatioHigh = genreProfile
      ? genreProfile.peakCcuToWeekOneHigh
      : FIRST_WEEK_PEAK_CCU_HIGH;

    const weekOneLow = peak.value * ccuRatioLow * ccuScale.low;
    const weekOneHigh = peak.value * ccuRatioHigh * ccuScale.high;

    const weekOneMid = (weekOneLow + weekOneHigh) / 2;

    // Prefer the genre-derived projection curve when the game's IGDB
    // genres resolve to at least one `GenreProfile` (resolved above for
    // the CCU ratio). The curve is built around the profile's empirical
    // `firstWeekToYearOneMultiplier` and tail factors; this is more
    // discriminating than the original size-bucket (×2.68 / ×3.77)
    // heuristic. Games whose genres don't resolve fall back to buckets.
    let projection: number;
    if (genreProfile) {
      projection = genreProjectionMultiplier(
        genreProfile.firstWeekToYearOneMultiplier,
        genreProfile.tailFactorY2,
        genreProfile.tailFactorY5,
        age,
      );
    } else {
      // Legacy size-bucket path. Kept identical to the pre-genre
      // behaviour so existing estimates don't drift for games we
      // haven't tagged yet.
      const year1Ratio =
        weekOneMid > FIRST_WEEK_BUCKET_THRESHOLD
          ? FIRST_WEEK_BUCKET_LARGE_YEAR1_RATIO
          : FIRST_WEEK_BUCKET_SMALL_YEAR1_RATIO;
      void year1Ratio;
      projection = firstWeekProjectionMultiplier(weekOneMid, age);
    }

    const projectedLow = Math.round(weekOneLow * projection);
    const projectedHigh = Math.round(weekOneHigh * projection);

    if (
      projectedHigh < FIRST_WEEK_ESTIMATE_MIN_UNITS ||
      projectedLow > FIRST_WEEK_ESTIMATE_MAX_UNITS ||
      projectedLow > projectedHigh
    ) {
      this.logger.debug(
        `[estimation:first-week] "${game.name}" — out-of-range [${projectedLow}, ${projectedHigh}], skipping`,
      );
      return null;
    }

    const launcherTag = launcherMethodTagFromShare(steamShare);
    const method = `first-week-extrapolation-pc${launcherTag}`;

    if (trace) {
      trace.firstWeek.push({
        type: 'first-week',
        method,
        launchPeakValue: peak.value,
        launchPeakCapturedAt: peak.capturedAt.toISOString(),
        ccuRatioLow,
        ccuRatioHigh,
        weekOneFinalLow: Math.round(weekOneLow),
        weekOneFinalHigh: Math.round(weekOneHigh),
        ageDays: Math.round(age),
        projectionMultiplier: projection,
        m1: genreProfile?.firstWeekToYearOneMultiplier ?? null,
        profileSource: genreProfile ? 'matcher' : 'global',
        finalLow: projectedLow,
        finalHigh: projectedHigh,
      });
    }

    return {
      platform: Platform.PC,
      estimatedLow: projectedLow,
      estimatedHigh: projectedHigh,
      method,
    };
  }

  private resolveProfileDefaults(
    platform: Platform,
    profile: ResolvedGenreProfile | null,
  ): { low: number; high: number } | undefined {
    if (!profile) return undefined;
    switch (platform) {
      case Platform.PC:
        if (
          profile.pcDefaultBoxleiterLow != null &&
          profile.pcDefaultBoxleiterHigh != null
        ) {
          return {
            low: profile.pcDefaultBoxleiterLow,
            high: profile.pcDefaultBoxleiterHigh,
          };
        }
        break;
      case Platform.PLAYSTATION:
        if (
          profile.psDefaultBoxleiterLow != null &&
          profile.psDefaultBoxleiterHigh != null
        ) {
          return {
            low: profile.psDefaultBoxleiterLow,
            high: profile.psDefaultBoxleiterHigh,
          };
        }
        break;
    }
    return undefined;
  }

  private resolveMultiplier(
    game: Game,
    cfg: PlatformConfig,
    opts: EstimateOptions = {},
    profileDefaults?: { low: number; high: number },
  ): { low: number; high: number; method: string; isCalibrated: boolean } {
    const calibrated = opts.ignoreCalibration ? null : cfg.read(game);
    if (calibrated && calibrated > 0) {
      return {
        low: calibrated * (1 - CALIBRATED_MULTIPLIER_SPREAD),
        high: calibrated * (1 + CALIBRATED_MULTIPLIER_SPREAD),
        method: `${cfg.methodPrefix}-calibrated`,
        isCalibrated: true,
      };
    }
    return {
      low: profileDefaults?.low ?? cfg.defaultLow,
      high: profileDefaults?.high ?? cfg.defaultHigh,
      method: `${cfg.methodPrefix}-default`,
      isCalibrated: false,
    };
  }

  /**
   * Calibrate per-platform multipliers from the worldwide declared figure.
   * Milestones are worldwide totals ("X million copies sold across all
   * platforms"), so we split the declared units across platforms and derive
   * a per-platform multiplier from each share.
   *
   * Algorithm:
   *  1. Pick the best record (most recent reportedAt; largest on ties).
   *  2. For each tracked platform, find the signal snapshot closest to
   *     the record's date (within `CALIBRATION_WINDOW_DAYS`).
   *  3. Compute a proxy estimate per platform using the **midpoint of
   *     the static default** multiplier (deliberately NOT the calibrated
   *     value — using the calibrated value would create a feedback loop
   *     that re-derives whatever was already stored).
   *  4. Split the declared units proportionally to each platform's share
   *     of the total proxy estimate.
   *  5. For each platform whose share is at least
   *     `GLOBAL_SPLIT_MIN_PLATFORM_SHARE`, derive
   *     `multiplier = declared_p / signal_p` and persist it (with the
   *     record's source for spread modulation at read time).
   *
   * Example
   *   - PC: 100,000 units
   *   - PS: 50,000 units
   *   - Xbox: 25,000 units
   *   - Global: 175,000 units
   *   - Proxy: 100,000 * 0.5 + 50,000 * 0.3 + 25,000 * 0.2 = 75,000
   *   - Share: 100,000 / 75,000 = 1.33
   *   - Multiplier: 175,000 / 100,000 = 1.75
   */
  private async recalibrateFromGlobal(gameId: string): Promise<void> {
    const candidates = await this.milestones.find({
      where: {
        gameId,
        rejectedAt: IsNull(),
        isEngagement: false,
        // Worldwide totals only. PC-specific milestones (region='PC') are not
        // (yet) consumed by the GLOBAL→platform split — feeding one here would
        // be mistaken for a worldwide figure and split across platforms.
        region: 'GLOBAL',
      },
    });
    if (candidates.length === 0) return;

    candidates.sort((a, b) => {
      const ta = a.reportedAt?.getTime() ?? 0;
      const tb = b.reportedAt?.getTime() ?? 0;
      return tb - ta;
    });
    const best = candidates[0];
    if (best.units <= 0 || !best.reportedAt) return;

    const target = best.reportedAt.getTime();

    // For each platform: find the signal closest to the record's date
    // within the calibration window, and compute a proxy weight from
    // the static default multiplier midpoint.
    type Slot = {
      cfg: PlatformConfig;
      signalValue: number;
      proxy: number;
    };
    const slots: Slot[] = [];
    for (const cfg of this.platforms) {
      const snapshots = await this.signals.find({
        where: { gameId, metric: cfg.signalMetric },
      });
      if (snapshots.length === 0) continue;
      const closest = snapshots.reduce((acc, r) =>
        Math.abs(r.capturedAt.getTime() - target) <
        Math.abs(acc.capturedAt.getTime() - target)
          ? r
          : acc,
      );
      if (
        Math.abs(closest.capturedAt.getTime() - target) >
        CALIBRATION_WINDOW_DAYS * 24 * 3600 * 1000
      ) {
        continue;
      }
      if (closest.value <= 0) continue;

      const defaultMid = (cfg.defaultLow + cfg.defaultHigh) / 2;
      slots.push({
        cfg,
        signalValue: closest.value,
        proxy: closest.value * defaultMid,
      });
    }

    const totalProxy = slots.reduce((sum, s) => sum + s.proxy, 0);
    if (totalProxy <= 0) return;

    for (const slot of slots) {
      const share = slot.proxy / totalProxy;
      if (share < GLOBAL_SPLIT_MIN_PLATFORM_SHARE) continue;

      const allocated = best.units * share;
      const multiplier = allocated / slot.signalValue;
      if (
        multiplier < slot.cfg.plausibleMin ||
        multiplier > slot.cfg.plausibleMax
      ) {
        this.logger.debug(
          `Skipping implausible global-split ${slot.cfg.platform} calibration for ${gameId}: ${multiplier.toFixed(1)}`,
        );
        continue;
      }

      await slot.cfg.write(gameId, multiplier, best.source);
      this.logger.log(
        `[calibration:global-split] ${gameId} ${slot.cfg.platform}: ` +
          `share=${(share * 100).toFixed(1)}% multiplier=${multiplier.toFixed(2)} ` +
          `(from ${best.source} ${best.units.toLocaleString()} units)`,
      );
    }
  }

  /**
   * Calibrate the PC multiplier directly from a `region='PC'` milestone
   * (e.g. `STEAM_LEAK`: 2018 Steam-leak owner counts, treated as paid
   * buyers on Steam). Skipped when a more recent `region='GLOBAL'`
   * milestone exists — that figure would already have set the PC
   * multiplier via `recalibrateFromGlobal` and is presumed more current.
   *
   * Algorithm:
   *  1. Pick the most recent PC milestone (tie-break: largest units).
   *  2. Bail if the latest GLOBAL milestone is more recent (or same date)
   *     so the GLOBAL-split keeps priority.
   *  3. Find the STEAM_REVIEWS signal closest to the PC milestone's
   *     `reportedAt` (within `CALIBRATION_WINDOW_DAYS`).
   *  4. `multiplier = declared_PC / signal_PC`, validated against the PC
   *     plausibility bounds, then persisted on `calibratedMultiplier`.
   *
   * Spread on read stays the standard `CALIBRATED_MULTIPLIER_SPREAD` —
   * STEAM_LEAK has confidenceScore=90 and is treated like an authoritative
   * source.
   */
  private async recalibrateFromPcRegion(gameId: string): Promise<void> {
    const pcCandidates = await this.milestones.find({
      where: {
        gameId,
        rejectedAt: IsNull(),
        isEngagement: false,
        region: 'PC',
      },
    });
    if (pcCandidates.length === 0) return;

    pcCandidates.sort((a, b) => {
      const ta = a.reportedAt?.getTime() ?? 0;
      const tb = b.reportedAt?.getTime() ?? 0;
      if (tb !== ta) return tb - ta;
      return b.units - a.units;
    });
    const best = pcCandidates[0];
    if (best.units <= 0 || !best.reportedAt) return;

    const latestGlobal = await this.milestones.findOne({
      where: {
        gameId,
        rejectedAt: IsNull(),
        isEngagement: false,
        region: 'GLOBAL',
      },
      order: { reportedAt: 'DESC' },
    });
    if (
      latestGlobal?.reportedAt &&
      latestGlobal.reportedAt.getTime() >= best.reportedAt.getTime()
    ) {
      return;
    }

    const cfg = this.platforms.find((p) => p.platform === Platform.PC);
    if (!cfg) return;

    const snapshots = await this.signals.find({
      where: { gameId, metric: cfg.signalMetric },
    });
    if (snapshots.length === 0) return;
    const target = best.reportedAt.getTime();
    const closest = snapshots.reduce((acc, r) =>
      Math.abs(r.capturedAt.getTime() - target) <
      Math.abs(acc.capturedAt.getTime() - target)
        ? r
        : acc,
    );
    if (
      Math.abs(closest.capturedAt.getTime() - target) >
      CALIBRATION_WINDOW_DAYS * 24 * 3600 * 1000
    ) {
      return;
    }
    if (closest.value <= 0) return;

    const multiplier = best.units / closest.value;
    if (multiplier < cfg.plausibleMin || multiplier > cfg.plausibleMax) {
      this.logger.debug(
        `Skipping implausible PC-region calibration for ${gameId}: ${multiplier.toFixed(1)}`,
      );
      return;
    }

    await cfg.write(gameId, multiplier, best.source);
    this.logger.log(
      `[calibration:pc-region] ${gameId} PC: multiplier=${multiplier.toFixed(2)} ` +
        `(from ${best.source} ${best.units.toLocaleString()} units @ ` +
        `${best.reportedAt.toISOString().slice(0, 10)}, signal=${closest.value.toLocaleString()})`,
    );
  }

  // ───── estimate breakdown (diagnostic) ──────────────────────────────────

  /**
   * Step-by-step breakdown of the **pure algo** estimation for a game.
   *
   * Single source of truth: this runs the *real* estimation pipeline
   * (`estimateAllPlatforms` + `aggregateResultsByPlatform`) in pure mode
   * (`ignoreCalibration: true`) with a `trace` collector attached, then
   * assembles the recorded intermediate values. Nothing is re-computed
   * and nothing is persisted, so the numbers shown are guaranteed
   * identical to what the production pipeline produces.
   */
  async computeBreakdown(gameId: string): Promise<EstimateBreakdownResult> {
    const computedAt = new Date().toISOString();

    const trace = createEstimateTrace();
    const results = await this.estimateAllPlatforms(
      gameId,
      undefined,
      { ignoreCalibration: true },
      trace,
    );

    const { aggregates } = await this.aggregateResultsByPlatform(
      gameId,
      results,
      trace,
    );

    const milestones = await this.milestones.find({
      where: {
        gameId,
        rejectedAt: IsNull(),
        isEngagement: false,
        region: 'GLOBAL',
      },
      order: { units: 'DESC' },
    });
    const bestDeclared = milestones.length > 0 ? milestones[0] : null;

    const platformOrder: Platform[] = [];
    const seen = new Set<Platform>();
    const pushPlatform = (p: Platform): void => {
      if (!seen.has(p)) {
        seen.add(p);
        platformOrder.push(p);
      }
    };
    for (const e of trace.boxleiter) pushPlatform(e.platform);
    for (const e of trace.split) pushPlatform(e.platform);
    for (const p of aggregates.keys()) pushPlatform(p);

    const platforms: PlatformBreakdownResult[] = platformOrder.map(
      (platform) => {
        const entries: (
          | BoxleiterBreakdownEntry
          | FirstWeekBreakdownEntry
          | SplitBreakdownEntry
        )[] = [
          ...trace.boxleiter.filter((e) => e.platform === platform),
          ...trace.split.filter((e) => e.platform === platform),
          ...(platform === Platform.PC ? trace.firstWeek : []),
        ];
        const agg = trace.aggregates.get(platform);
        const aggResult = aggregates.get(platform);
        return {
          platform,
          entries,
          weightedEntries: agg?.weightedEntries ?? [],
          totalWeight: agg?.totalWeight ?? 0,
          weightedLow: agg?.weightedLow ?? 0,
          weightedHigh: agg?.weightedHigh ?? 0,
          disagreement: agg?.disagreement ?? 0,
          inflate: agg?.inflate ?? 0,
          aggregateLow: aggResult?.estimatedLow ?? agg?.aggregateLow ?? 0,
          aggregateHigh: aggResult?.estimatedHigh ?? agg?.aggregateHigh ?? 0,
        };
      },
    );

    const pureTotal =
      aggregates.size > 0
        ? {
            low: [...aggregates.values()].reduce(
              (s, a) => s + a.estimatedLow,
              0,
            ),
            high: [...aggregates.values()].reduce(
              (s, a) => s + a.estimatedHigh,
              0,
            ),
          }
        : null;

    return {
      computedAt,
      platforms,
      pureTotal,
      declared: bestDeclared
        ? {
            units: bestDeclared.units,
            source: bestDeclared.source,
            reportedAt: bestDeclared.reportedAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}

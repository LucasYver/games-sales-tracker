import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  ConfidenceLevel,
  EstimationMethod,
  Game,
  LauncherProfile,
  Platform,
  SalesEstimate,
  SalesRecord,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
  SourceType,
} from '../entities';
import {
  AGGREGATED_METHOD_CODE,
  EstimationMethodService,
} from './estimation-method.service';
import {
  GenresService,
  type ResolvedGenreProfile,
} from '../genres/genres.service';
import {
  ACHIEVEMENT_ESTIMATE_MAX_UNITS,
  ACHIEVEMENT_ESTIMATE_MIN_UNITS,
  ACHIEVEMENT_MIN_PLAYERS_TRACKED,
  CALIBRATED_MULTIPLIER_SPREAD,
  CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE,
  EXOPHASE_COVERAGE_PC_HIGH,
  EXOPHASE_COVERAGE_PC_LOW,
  EXOPHASE_COVERAGE_PS_HIGH,
  EXOPHASE_COVERAGE_PS_LOW,
  EXOPHASE_COVERAGE_XBOX_HIGH,
  EXOPHASE_COVERAGE_XBOX_LOW,
  FIRST_WEEK_BUCKET_LARGE_YEAR1_RATIO,
  FIRST_WEEK_BUCKET_SMALL_YEAR1_RATIO,
  FIRST_WEEK_BUCKET_THRESHOLD,
  FIRST_WEEK_ESTIMATE_MAX_UNITS,
  FIRST_WEEK_ESTIMATE_MIN_UNITS,
  FIRST_WEEK_PEAK_CCU_HIGH,
  FIRST_WEEK_PEAK_CCU_LOW,
  FIRST_WEEK_REVIEWS_HIGH,
  FIRST_WEEK_REVIEWS_LOW,
  FIRST_WEEK_REVIEWS_WINDOW_DAYS,
  LAUNCHER_CCU_FACTOR,
  LAUNCHER_CONFIDENCE_CAP,
  LAUNCHER_REVIEWS_FACTOR,
  PC_BOXLEITER_DEFAULT_HIGH,
  PC_BOXLEITER_DEFAULT_LOW,
  PC_BOXLEITER_PLAUSIBLE_MAX,
  PC_BOXLEITER_PLAUSIBLE_MIN,
  PC_CCU_DEFAULT_HIGH,
  PC_CCU_DEFAULT_LOW,
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

const CONFIDENCE_ORDER: ConfidenceLevel[] = [
  ConfidenceLevel.LOW,
  ConfidenceLevel.MEDIUM,
  ConfidenceLevel.HIGH,
];

/**
 * Clamp a confidence level to at most `cap`. Returns `level` unchanged
 * when no cap applies or when it's already below the cap.
 */
function capConfidence(
  level: ConfidenceLevel,
  cap: ConfidenceLevel | null,
): ConfidenceLevel {
  if (!cap) return level;
  const li = CONFIDENCE_ORDER.indexOf(level);
  const ci = CONFIDENCE_ORDER.indexOf(cap);
  return li > ci ? cap : level;
}

const LAUNCHER_PROFILE_METHOD_TAG: Record<LauncherProfile, string> = {
  [LauncherProfile.STEAM_DOMINANT]: '',
  [LauncherProfile.MULTI_STORE]: '+multi-store',
  [LauncherProfile.LAUNCHER_PRIMARY]: '+launcher-primary',
};

const ACHIEVEMENT_COVERAGE: Record<
  Platform.PC | Platform.PLAYSTATION | Platform.XBOX,
  { low: number; high: number }
> = {
  [Platform.PC]: {
    low: EXOPHASE_COVERAGE_PC_LOW,
    high: EXOPHASE_COVERAGE_PC_HIGH,
  },
  [Platform.PLAYSTATION]: {
    low: EXOPHASE_COVERAGE_PS_LOW,
    high: EXOPHASE_COVERAGE_PS_HIGH,
  },
  [Platform.XBOX]: {
    low: EXOPHASE_COVERAGE_XBOX_LOW,
    high: EXOPHASE_COVERAGE_XBOX_HIGH,
  },
};

const RECENT_RELEASE_DAYS = 14;

// Calibration only trusts a declared figure when a signal snapshot exists
// within this window of the figure's reported date — otherwise units/signals
// would mix points from very different times and produce a bogus multiplier.
const CALIBRATION_WINDOW_DAYS = 365;

// Declared sources reliable enough to calibrate against, most reliable
// first. The order matters: when a game has both an OFFICIAL figure and
// a MEDIA one, OFFICIAL wins. MEDIA/ANNOUNCEMENT bring more games into
// the calibrated tier (OFFICIAL alone is rare), but the produced
// multiplier inherits a wider per-source spread (see
// `CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE`) to keep the model honest
// about its lower confidence.
const CALIBRATION_SOURCES = [
  SalesSource.OFFICIAL,
  SalesSource.ANNOUNCEMENT,
  SalesSource.MEDIA,
];

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

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  [ConfidenceLevel.LOW]: 0,
  [ConfidenceLevel.MEDIUM]: 1,
  [ConfidenceLevel.HIGH]: 2,
};

// Multiplier applied on top of a method's `defaultWeight` in the
// aggregate, based on the confidence that method produced for THIS
// game. A method anchored on a reliable declared figure (HIGH, e.g.
// calibrated Boxleiter) should outweigh a rougher lifecycle proxy
// (MEDIUM) even when the latter has a higher static `defaultWeight`.
//
// Key property: when every contributor shares the same confidence the
// factor cancels out in the weighted average, so single-confidence
// platforms (the common case) behave exactly as before — only
// MIXED-confidence aggregates shift. Tunable; the gap between tiers
// controls how strongly we defer to the most trustworthy method.
const AGGREGATION_CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  [ConfidenceLevel.LOW]: 0.3,
  [ConfidenceLevel.MEDIUM]: 0.55,
  [ConfidenceLevel.HIGH]: 1.0,
};

const CONFIDENCE_BY_RANK = [
  ConfidenceLevel.LOW,
  ConfidenceLevel.MEDIUM,
  ConfidenceLevel.HIGH,
];

/**
 * Knobs to switch on alternative estimation paths. Each axis is
 * independent; combining them lets the variant generator enumerate
 * the full cartesian product (calibration × ccu-intersect × genre)
 * for diagnostic display in the admin UI.
 *
 *   - `ignoreCalibration`: forces `resolveMultiplier` to skip
 *     `Game.calibratedMultiplier*` and use the platform default
 *     range. Used both for the "pure algo" snapshot total and as one
 *     axis of the reference-variant matrix.
 *   - `skipCcuIntersection`: PC only. Disables
 *     `applyCcuIntersection` so the row is the pure
 *     reviews-multiplier estimate without the CCU cross-check.
 *   - `ignoreGenreProfile`: forces the first-week extrapolation back
 *     onto the legacy size-bucket curve even when the game's genres
 *     resolve to a profile, AND uses the genre-blind global
 *     peak-CCU → week-1 ratio band.
 *   - `markAsReference`: when true, tags every produced
 *     `EstimateResult` with `isReference = true`. The aggregator
 *     filters those out so reference variants are persisted purely
 *     for side-by-side display, never blended into the consensus.
 */
export interface EstimateOptions {
  ignoreCalibration?: boolean;
  skipCcuIntersection?: boolean;
  ignoreGenreProfile?: boolean;
  markAsReference?: boolean;
}

interface PlatformConfig {
  platform: Platform;
  signalMetric: SignalMetric;
  defaultLow: number;
  defaultHigh: number;
  plausibleMin: number;
  plausibleMax: number;
  // How a stored Game row exposes the calibrated multiplier for this
  // platform — and the source of the record that produced it (so the
  // per-source spread can be applied at read time).
  read: (game: Game) => number | null;
  readSource: (game: Game) => SalesSource | null;
  write: (
    gameId: string,
    value: number,
    source: SalesSource,
  ) => Promise<void>;
  methodPrefix: 'boxleiter' | 'ps-ratings-boxleiter' | 'xbox-ratings-boxleiter';
}

export interface EstimateResult {
  platform: Platform;
  estimatedLow: number;
  estimatedHigh: number;
  confidence: ConfidenceLevel;
  method: string;
  // Set to true for rows produced by the variant generator. Kept
  // optional so the dozens of result-construction sites that don't
  // care don't need to be touched.
  isReference?: boolean;
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
    @InjectRepository(SalesRecord)
    private readonly salesRecords: Repository<SalesRecord>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    private readonly methods: EstimationMethodService,
    private readonly genres: GenresService,
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
        readSource: (g) => g.calibrationSourcePc,
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
        readSource: (g) => g.calibrationSourcePs,
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
        readSource: (g) => g.calibrationSourceXbox,
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
   * up to two parallel estimates:
   *   - the classical Boxleiter (signal × per-platform multiplier)
   * Only the Boxleiter estimate is produced today. The achievement-based
   * path is intentionally **disabled** at the call site (the underlying
   * computation, snapshots scraping and persistence are left intact so
   * we can re-enable it once the coverage constants are calibrated
   * against publisher IR — see `BACKLOG.md`).
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
  ): Promise<EstimateResult[]> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { publisherRecord: true },
    });
    if (!game || game.isFree) return [];

    const results: EstimateResult[] = [];
    for (const cfg of this.platforms) {
      const boxleiter = await this.estimateForPlatform(game, cfg, asOf, opts);
      if (boxleiter) results.push(boxleiter);

      // Achievement-based estimate intentionally disabled. Snapshots
      // keep flowing into `achievement_snapshot` for future use; flip
      // this back on once Exophase coverage constants are calibrated.
      // const achievementBased = await this.estimateFromAchievementsForPlatform(
      //   game,
      //   cfg.platform,
      //   asOf,
      // );
      // if (achievementBased) results.push(achievementBased);
    }

    // Lifecycle method: project today's PC units from the all-time
    // Steam peak CCU and (when captured close to launch) review count,
    // bucketed by launch size. Independent of any calibrated multiplier
    // so it adds signal especially for newer titles.
    const firstWeek = await this.estimateFirstWeekExtrapolationForPc(
      game,
      asOf,
      opts,
    );
    if (firstWeek) results.push(firstWeek);

    return results;
  }

  /**
   * Run `estimateAllPlatforms` for every cell of the variant matrix
   * (calibration × ccu-intersect × genre profile) and tag every cell
   * other than the canonical one with `isReference = true`.
   *
   * The "canonical" cell mirrors today's behaviour — the
   * most-informed combination available for the game:
   *   - calibrated multiplier when one exists;
   *   - CCU intersection when CCU data is available;
   *   - genre profile when the game's genres resolve.
   *
   * Reference cells whose options collapse to the canonical one
   * (e.g. a game with no calibrated multiplier produces the same
   * row for `ignoreCalibration: true` and `false`) are deduplicated
   * by `(platform, method)` so we never persist two physically
   * identical rows. The aggregator filters out reference rows so
   * they never bias the `aggregated` consensus.
   */
  async estimateAllPlatformsWithVariants(
    gameId: string,
    asOf?: Date,
  ): Promise<EstimateResult[]> {
    const canonical = await this.estimateAllPlatforms(gameId, asOf);
    if (canonical.length === 0) return [];

    const dedupKey = (r: EstimateResult): string =>
      `${r.platform}::${r.method}`;
    const seen = new Set<string>(canonical.map(dedupKey));
    const out: EstimateResult[] = [...canonical];

    // Each axis flip we expose to the variant matrix. The empty
    // flip (no option set) is omitted: that's the canonical run we
    // already executed above.
    const referenceOptions: EstimateOptions[] = [
      { ignoreCalibration: true },
      { skipCcuIntersection: true },
      { ignoreCalibration: true, skipCcuIntersection: true },
      { ignoreGenreProfile: true },
      { ignoreCalibration: true, ignoreGenreProfile: true },
      { skipCcuIntersection: true, ignoreGenreProfile: true },
      {
        ignoreCalibration: true,
        skipCcuIntersection: true,
        ignoreGenreProfile: true,
      },
    ];

    for (const variant of referenceOptions) {
      const refs = await this.estimateAllPlatforms(gameId, asOf, {
        ...variant,
        markAsReference: true,
      });
      for (const r of refs) {
        const key = dedupKey(r);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
    }

    return out;
  }

  /**
   * Recalibrate (if possible) all per-platform multipliers, then compute and
   * persist a fresh SalesEstimate row for each platform that has a usable
   * signal — including reference variant rows for diagnostic display.
   * Returns every persisted estimate.
   */
  async computeAndStore(gameId: string): Promise<EstimateResult[]> {
    await this.recalibrateAll(gameId);

    const results = await this.estimateAllPlatformsWithVariants(gameId);
    if (results.length === 0) return [];

    await this.persistEstimates(gameId, results);
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
    const results = await this.estimateAllPlatformsWithVariants(gameId, asOf);
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
   */
  private async aggregateResultsByPlatform(
    gameId: string,
    results: EstimateResult[],
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

    // Phase 1 — aggregate PC first so the genre-console-split method
    // (Phase 2) can ventilate from a stable consensus PC band rather
    // than from a single underlying method (boxleiter vs first-week
    // can disagree wildly on day-0 releases).
    const pcResults = byPlatform.get(Platform.PC) ?? [];
    const pcAggregate =
      pcResults.length > 0
        ? this.aggregateMethodsForPlatform(pcResults)
        : null;
    if (pcAggregate) aggregates.set(Platform.PC, pcAggregate);

    // Phase 2 — ventilate PC → console via the resolved genre profile.
    // Skipped silently for games whose genres don't map to any profile,
    // or when the PC aggregate is missing.
    const splits: EstimateResult[] = [];
    if (pcAggregate) {
      const computedSplits = await this.computeGenreConsoleSplits(
        gameId,
        pcAggregate,
      );
      for (const s of computedSplits) {
        splits.push(s);
        const bucket = byPlatform.get(s.platform) ?? [];
        bucket.push(s);
        byPlatform.set(s.platform, bucket);
      }
    }

    // Phase 3 — aggregate the remaining platforms (PS, XBOX, …). PS
    // and XBOX now see the genre-split row alongside any Boxleiter
    // estimate, which is what the aggregate should consume.
    for (const [platform, perPlatform] of byPlatform) {
      if (platform === Platform.PC) continue;
      const aggregate = this.aggregateMethodsForPlatform(perPlatform);
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

    const { aggregates } = await this.aggregateResultsByPlatform(gameId, results);
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
      confidence: aggregate.confidence,
      method: aggregate.method,
      methodId: aggregateMethodId,
      ...(asOf ? { computedAt: asOf } : {}),
    });
  }

  /**
   * Ventilate a PC aggregate into PlayStation / Xbox estimates using
   * the game's resolved `GenreProfile`. Skipped when no profile
   * resolves or the PC share is zero (defensive — the seed always
   * has it ≥ 0.2).
   *
   *   psUnits   = pcUnits × (playstationShare / pcShare)
   *   xboxUnits = pcUnits × (xboxShare        / pcShare)
   *
   * The Switch share is intentionally dropped on the floor: our
   * `Platform` enum doesn't include Switch (no reliable sales signal
   * either way), and folding it into PS / Xbox would double-count
   * non-existent rows.
   *
   * Confidence is clamped to MEDIUM (the ventilation is a structural
   * model, never as trustworthy as a calibrated console rating
   * signal) and further bounded by the profile's own confidence.
   */
  private async computeGenreConsoleSplits(
    gameId: string,
    pcAggregate: EstimateResult,
  ): Promise<EstimateResult[]> {
    const game = await this.games.findOne({
      where: { id: gameId },
      select: { id: true, genres: true, platforms: true },
    });
    if (!game) return [];

    const profile = await this.genres.resolveProfileForGame(game);
    if (!profile || profile.pcShare <= 0) return [];

    // Only ventilate to platforms the game is actually released on.
    // Inferring console sales for a PC-only title would be nonsense
    // (e.g. Last Epoch resolves to a generic RPG profile but has no
    // PSN / Xbox SKU).
    const releasedPlatforms = new Set(game.platforms ?? []);
    return this.buildConsoleSplitsFromProfile(
      pcAggregate,
      profile,
      releasedPlatforms,
    );
  }

  private buildConsoleSplitsFromProfile(
    pcAggregate: EstimateResult,
    profile: ResolvedGenreProfile,
    releasedPlatforms: Set<Platform>,
  ): EstimateResult[] {
    const baseConfidence = capConfidence(
      capConfidence(pcAggregate.confidence, ConfidenceLevel.MEDIUM),
      profile.confidence,
    );

    const targets: Array<{ platform: Platform; share: number; code: string }> = [
      {
        platform: Platform.PLAYSTATION,
        share: profile.playstationShare,
        code: 'genre-console-split-from-pc-playstation',
      },
      {
        platform: Platform.XBOX,
        share: profile.xboxShare,
        code: 'genre-console-split-from-pc-xbox',
      },
    ];

    const out: EstimateResult[] = [];
    for (const t of targets) {
      if (t.share <= 0) continue;
      if (!releasedPlatforms.has(t.platform)) continue;
      const ratio = t.share / profile.pcShare;
      const low = Math.round(pcAggregate.estimatedLow * ratio);
      const high = Math.round(pcAggregate.estimatedHigh * ratio);
      if (high <= 0 || low > high) continue;
      out.push({
        platform: t.platform,
        estimatedLow: low,
        estimatedHigh: high,
        confidence: baseConfidence,
        method: t.code,
      });
    }
    return out;
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
      confidence: result.confidence,
      method: result.method,
      methodId: this.resolveMethodId(result.method),
      isReference: result.isReference ?? false,
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
  ): EstimateResult | null {
    const eligible = perPlatform
      .filter((r) => !r.isReference)
      .map((r) => {
        const method = this.methods.findByCode(
          r.method.replace(/\+[^+]+/g, ''),
        );
        return method ? { result: r, method } : null;
      })
      .filter(
        (entry): entry is { result: EstimateResult; method: EstimationMethod } =>
          entry !== null &&
          entry.method.isEnabled &&
          !entry.method.isAggregate &&
          Number(entry.method.defaultWeight) > 0,
      );
    if (eligible.length === 0) return null;

    // Effective weight = static method weight × per-game confidence
    // factor, so a HIGH-confidence calibrated method dominates a
    // rougher MEDIUM lifecycle proxy regardless of `defaultWeight`.
    const effectiveWeight = (entry: {
      result: EstimateResult;
      method: EstimationMethod;
    }): number =>
      Number(entry.method.defaultWeight) *
      AGGREGATION_CONFIDENCE_WEIGHT[entry.result.confidence];

    const totalWeight = eligible.reduce((sum, e) => sum + effectiveWeight(e), 0);
    if (totalWeight <= 0) return null;

    let weightedLow = 0;
    let weightedHigh = 0;
    let minMid = Infinity;
    let maxMid = -Infinity;
    let lowestConfidenceRank = Infinity;

    for (const entry of eligible) {
      const { result } = entry;
      const weight = effectiveWeight(entry);
      weightedLow += result.estimatedLow * weight;
      weightedHigh += result.estimatedHigh * weight;
      const mid = (result.estimatedLow + result.estimatedHigh) / 2;
      if (mid < minMid) minMid = mid;
      if (mid > maxMid) maxMid = mid;
      const rank = CONFIDENCE_RANK[result.confidence];
      if (rank < lowestConfidenceRank) lowestConfidenceRank = rank;
    }
    weightedLow /= totalWeight;
    weightedHigh /= totalWeight;

    const weightedMid = (weightedLow + weightedHigh) / 2;
    const disagreement =
      weightedMid > 0 ? (maxMid - minMid) / weightedMid : 0;
    const inflate = AGGREGATION_DISAGREEMENT_ALPHA * disagreement;

    const aggLow = Math.max(0, weightedLow * (1 - inflate));
    const aggHigh = weightedHigh * (1 + inflate);

    return {
      platform: eligible[0].result.platform,
      estimatedLow: Math.round(aggLow),
      estimatedHigh: Math.round(aggHigh),
      confidence:
        CONFIDENCE_BY_RANK[
          Number.isFinite(lowestConfidenceRank) ? lowestConfidenceRank : 0
        ],
      method: AGGREGATED_METHOD_CODE,
    };
  }

  /**
   * Derive and persist this game's Boxleiter multipliers for every platform
   * that has both a reliable declared figure and a contemporaneous signal.
   * Each platform is calibrated independently; failures on one platform never
   * affect the others.
   *
   * Two passes:
   *  1. Per-platform records (`PC` / `PLAYSTATION` / `XBOX`) drive the
   *     primary calibration via `recalibratePlatform`.
   *  2. As a fallback, worldwide (`GLOBAL`) records are split
   *     proportionally across platforms in `recalibrateFromGlobal`. Per-
   *     platform calibration always wins: GLOBAL split only fills
   *     platforms left without a calibrated multiplier after pass 1.
   */
  async recalibrateAll(gameId: string): Promise<void> {
    for (const cfg of this.platforms) {
      await this.recalibratePlatform(gameId, cfg);
    }
    await this.recalibrateFromGlobal(gameId);
  }

  // ───── internals ────────────────────────────────────────────────────────

  private async estimateForPlatform(
    game: Game,
    cfg: PlatformConfig,
    asOf?: Date,
    opts: EstimateOptions = {},
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
    const { low, high, method, isCalibrated } = this.resolveMultiplier(
      game,
      cfg,
      opts,
    );

    // Launcher profile only modulates the *PC* estimation today (the
    // Steam-vs-rest-of-PC fragmentation problem). PS / Xbox keep their
    // native multipliers untouched.
    const launcherProfile =
      cfg.platform === Platform.PC
        ? (game.publisherRecord?.launcherProfile ??
          LauncherProfile.STEAM_DOMINANT)
        : LauncherProfile.STEAM_DOMINANT;

    // Per-game calibration (from a declared OFFICIAL/MEDIA figure) has
    // already absorbed the launcher effect empirically — applying the
    // profile scaling on top would double-count it. Only scale when we
    // fall back on the static default multiplier range.
    const reviewsScale =
      !isCalibrated && cfg.platform === Platform.PC
        ? LAUNCHER_REVIEWS_FACTOR[launcherProfile]
        : { low: 1, high: 1 };

    let estimatedLow = signalValue * low * reviewsScale.low;
    let estimatedHigh = signalValue * high * reviewsScale.high;
    let finalMethod = method;
    let confidenceOverride: ConfidenceLevel | null = null;

    if (cfg.platform === Platform.PC) {
      if (!opts.skipCcuIntersection) {
        const ccu = await this.applyCcuIntersection(
          game.id,
          estimatedLow,
          estimatedHigh,
          launcherProfile,
          asOf,
        );
        if (ccu) {
          estimatedLow = ccu.low;
          estimatedHigh = ccu.high;
          finalMethod = `${method}${ccu.methodSuffix}`;
          confidenceOverride = ccu.confidenceOverride;
        }
      }

      const profileTag = LAUNCHER_PROFILE_METHOD_TAG[launcherProfile];
      if (profileTag) finalMethod = `${finalMethod}${profileTag}`;
    }

    const baseConfidence =
      confidenceOverride ??
      this.resolveConfidence(signalValue, game.releaseDate, cfg);
    const cappedConfidence =
      cfg.platform === Platform.PC
        ? capConfidence(baseConfidence, LAUNCHER_CONFIDENCE_CAP[launcherProfile])
        : baseConfidence;

    return {
      platform: cfg.platform,
      estimatedLow: Math.round(estimatedLow),
      estimatedHigh: Math.round(estimatedHigh),
      confidence: cappedConfidence,
      method: finalMethod,
      ...(opts.markAsReference ? { isReference: true } : {}),
    };
  }

  /**
   * Cross-check the PC reviews-based range against a second, independent
   * estimate derived from the all-time peak concurrent player count
   * (`STEAM_PEAK_CCU` signal). Returns one of three outcomes:
   *
   *  - **No peak yet** (CCU polling just started or app is console-only):
   *    returns null, the reviews-based range is kept untouched.
   *  - **Ranges overlap**: returns the intersection, which is a strictly
   *    tighter range than either signal alone. Method tagged `+ccu-intersect`.
   *  - **Ranges disagree**: returns the reviews-based range unchanged but
   *    downgrades confidence to LOW and tags the method `+ccu-conflict`.
   *    Typical for Game Pass titles (reviews undershoot vs CCU) or live-
   *    service games where review:player ratios diverge from the catalog
   *    norm. Surfaces the model uncertainty rather than picking a winner.
   */
  private async applyCcuIntersection(
    gameId: string,
    reviewsLow: number,
    reviewsHigh: number,
    launcherProfile: LauncherProfile,
    asOf?: Date,
  ): Promise<{
    low: number;
    high: number;
    methodSuffix: string;
    confidenceOverride: ConfidenceLevel | null;
  } | null> {
    // Sort by value DESC (not capturedAt): historical-imported peak rows
    // carry an old `capturedAt` so the *largest* value is the true current
    // all-time peak, not the most recently captured one.
    const peak = await this.signals.findOne({
      where: {
        gameId,
        metric: SignalMetric.STEAM_PEAK_CCU,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { value: 'DESC' },
    });
    if (!peak || peak.value <= 0) return null;

    // Same logic as the reviews multiplier: the CCU range assumes Steam
    // captures all of PC. Scale it up for multi-store / launcher-primary
    // publishers so the two ranges live in the same "total PC" space and
    // their intersection is meaningful.
    const ccuFactor = LAUNCHER_CCU_FACTOR[launcherProfile];
    const ccuLow = peak.value * PC_CCU_DEFAULT_LOW * ccuFactor.low;
    const ccuHigh = peak.value * PC_CCU_DEFAULT_HIGH * ccuFactor.high;

    const lo = Math.max(reviewsLow, ccuLow);
    const hi = Math.min(reviewsHigh, ccuHigh);
    if (lo <= hi) {
      return {
        low: lo,
        high: hi,
        methodSuffix: '+ccu-intersect',
        confidenceOverride: null,
      };
    }

    return {
      low: reviewsLow,
      high: reviewsHigh,
      methodSuffix: '+ccu-conflict',
      confidenceOverride: ConfidenceLevel.LOW,
    };
  }

  /**
   * Lifecycle estimate (PC): derive week-1 units from the all-time
   * Steam peak CCU — and reviews captured close to launch when
   * available — then project to "today" via a degressive curve that
   * bumps year-1 to either 2.68× (large launches, > 100k week-1) or
   * 3.77× (small launches) the week-1 baseline.
   *
   * Eligibility:
   *   - Game has a `releaseDate` and is past day 1.
   *   - We have at least one `STEAM_PEAK_CCU` snapshot (ordered by
   *     `value DESC` because the historical-import path writes peaks
   *     with the SteamCharts month of the peak as `capturedAt`).
   *
   * When a `STEAM_REVIEWS` snapshot was captured within ±
   * `FIRST_WEEK_REVIEWS_WINDOW_DAYS` of `releaseDate + 7 days`, we
   * average its derived week-1 band with the peak-CCU band — using the
   * midpoint average and the widest spread of the two as a
   * defensive-uncertainty floor. The method tag flips from
   * `first-week-extrapolation-pc` to
   * `first-week-extrapolation-pc+reviews-corrected` so admins can tell
   * the two combos apart in the time series.
   *
   * Launcher profile scaling (multi-store / launcher-primary) is
   * applied to both the CCU and reviews inputs since both are Steam-
   * captured — they share the same "Steam → total PC" correction. We
   * skip the scaling for calibrated-equivalent games (none today, but
   * mirrors the Boxleiter behaviour so a future LIFECYCLE calibration
   * would slot in cleanly).
   */
  private async estimateFirstWeekExtrapolationForPc(
    game: Game,
    asOf?: Date,
    opts: EstimateOptions = {},
  ): Promise<EstimateResult | null> {
    if (!game.releaseDate) return null;

    const referenceDate = asOf ?? new Date();
    const age = ageInDays(game.releaseDate, referenceDate);
    if (age <= 0) return null;

    const launcherProfile =
      game.publisherRecord?.launcherProfile ?? LauncherProfile.STEAM_DOMINANT;
    const ccuScale = LAUNCHER_CCU_FACTOR[launcherProfile];
    const reviewsScale = LAUNCHER_REVIEWS_FACTOR[launcherProfile];

    const peak = await this.signals.findOne({
      where: {
        gameId: game.id,
        metric: SignalMetric.STEAM_PEAK_CCU,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { value: 'DESC' },
    });
    if (!peak || peak.value <= 0) return null;

    // Genre-aware peak-CCU → week-1 ratio. When the game's genres
    // resolve to a profile we use its empirical range (much lower for
    // high-engagement genres like grand strategy / MMO whose peak CCU
    // is large relative to sales); otherwise the genre-blind global
    // [LOW, HIGH] band is the fallback. `ignoreGenreProfile` forces
    // the fallback path even when a profile resolves — used by the
    // reference-variant generator to surface the legacy size-bucket
    // estimate side by side with the genre-aware one.
    const genreProfile = opts.ignoreGenreProfile
      ? null
      : await this.genres.resolveProfileForGame(game);
    const ccuRatioLow = genreProfile
      ? genreProfile.peakCcuToWeekOneLow
      : FIRST_WEEK_PEAK_CCU_LOW;
    const ccuRatioHigh = genreProfile
      ? genreProfile.peakCcuToWeekOneHigh
      : FIRST_WEEK_PEAK_CCU_HIGH;

    const weekOneFromCcuLow = peak.value * ccuRatioLow * ccuScale.low;
    const weekOneFromCcuHigh = peak.value * ccuRatioHigh * ccuScale.high;

    const reviewsAtLaunch = await this.findReviewsNearLaunch(
      game.id,
      game.releaseDate,
      asOf,
    );
    let weekOneLow = weekOneFromCcuLow;
    let weekOneHigh = weekOneFromCcuHigh;
    let combinedWithReviews = false;
    if (reviewsAtLaunch && reviewsAtLaunch > 0) {
      const weekOneFromReviewsLow =
        reviewsAtLaunch * FIRST_WEEK_REVIEWS_LOW * reviewsScale.low;
      const weekOneFromReviewsHigh =
        reviewsAtLaunch * FIRST_WEEK_REVIEWS_HIGH * reviewsScale.high;

      const ccuMid = (weekOneFromCcuLow + weekOneFromCcuHigh) / 2;
      const reviewsMid =
        (weekOneFromReviewsLow + weekOneFromReviewsHigh) / 2;
      const combinedMid = (ccuMid + reviewsMid) / 2;

      // Keep the widest spread of the two inputs so the combined
      // uncertainty never narrows past what either signal alone
      // tolerates.
      const ccuHalfSpread = (weekOneFromCcuHigh - weekOneFromCcuLow) / 2;
      const reviewsHalfSpread =
        (weekOneFromReviewsHigh - weekOneFromReviewsLow) / 2;
      const halfSpread = Math.max(ccuHalfSpread, reviewsHalfSpread);

      weekOneLow = Math.max(0, combinedMid - halfSpread);
      weekOneHigh = combinedMid + halfSpread;
      combinedWithReviews = true;
    }

    const weekOneMid = (weekOneLow + weekOneHigh) / 2;

    // Prefer the genre-derived projection curve when the game's IGDB
    // genres resolve to at least one `GenreProfile` (resolved above for
    // the CCU ratio). The curve is built around the profile's empirical
    // `firstWeekToYearOneMultiplier` and tail factors; this is more
    // discriminating than the original size-bucket (×2.68 / ×3.77)
    // heuristic. Games whose genres don't resolve fall back to buckets.
    let projection: number;
    let projectionTag = '';
    if (genreProfile) {
      projection = genreProjectionMultiplier(
        genreProfile.firstWeekToYearOneMultiplier,
        genreProfile.tailFactorY2,
        genreProfile.tailFactorY5,
        age,
      );
      projectionTag = '+genre';
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

    // Confidence floor mirrors the Boxleiter logic: very recent
    // releases get LOW (peak hasn't matured), capped further by the
    // launcher profile. Mid-size launches with both signals are most
    // trustworthy.
    let baseConfidence: ConfidenceLevel;
    if (age < RECENT_RELEASE_DAYS) {
      baseConfidence = ConfidenceLevel.LOW;
    } else if (peak.value >= 50_000 && combinedWithReviews) {
      baseConfidence = ConfidenceLevel.HIGH;
    } else if (peak.value >= 10_000) {
      baseConfidence = ConfidenceLevel.MEDIUM;
    } else {
      baseConfidence = ConfidenceLevel.LOW;
    }
    const cappedConfidence = capConfidence(
      baseConfidence,
      LAUNCHER_CONFIDENCE_CAP[launcherProfile],
    );

    const launcherTag = LAUNCHER_PROFILE_METHOD_TAG[launcherProfile];
    const reviewsTag = combinedWithReviews ? '+reviews-corrected' : '';
    const method = `first-week-extrapolation-pc${projectionTag}${reviewsTag}${launcherTag}`;

    return {
      platform: Platform.PC,
      estimatedLow: projectedLow,
      estimatedHigh: projectedHigh,
      confidence: cappedConfidence,
      method,
      ...(opts.markAsReference ? { isReference: true } : {}),
    };
  }

  /**
   * Find a `STEAM_REVIEWS` snapshot captured within ±
   * `FIRST_WEEK_REVIEWS_WINDOW_DAYS` of `releaseDate + 7 days`. Used
   * by the first-week extrapolation to combine a peak-CCU estimate
   * with an early-reviews estimate when we tracked the game from
   * launch. Returns `null` when no snapshot lands in the window.
   */
  private async findReviewsNearLaunch(
    gameId: string,
    releaseDate: Date,
    asOf?: Date,
  ): Promise<number | null> {
    const snapshots = await this.signals.find({
      where: {
        gameId,
        metric: SignalMetric.STEAM_REVIEWS,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { capturedAt: 'ASC' },
    });
    if (snapshots.length === 0) return null;

    const target = releaseDate.getTime() + 7 * 24 * 3600 * 1000;
    const windowMs = FIRST_WEEK_REVIEWS_WINDOW_DAYS * 24 * 3600 * 1000;

    let best: { value: number; delta: number } | null = null;
    for (const snap of snapshots) {
      const delta = Math.abs(snap.capturedAt.getTime() - target);
      if (delta > windowMs) continue;
      if (snap.value <= 0) continue;
      if (!best || delta < best.delta) {
        best = { value: snap.value, delta };
      }
    }
    return best?.value ?? null;
  }

  /**
   * Achievement-based per-platform estimate from Exophase. The signal we
   * feed in is the number of Exophase users who actually launched the
   * game (sample size × unlock rate of the most common achievement), and
   * we scale it up to the real owner count with a per-platform coverage
   * range from `sales-modeling.constants.ts`. Returns null if no usable
   * snapshot exists for this platform.
   *
   * On PC, when a Steam-official achievement snapshot exists in parallel,
   * we measure Exophase's completionist bias (`pExo / pSteam`) on the
   * most common achievement and divide the Exophase player count by it
   * before scaling. This typically cuts ~15-30 % of overestimation. We
   * tag the method `…-steam-corrected` so the source of the correction is
   * visible in the admin.
   *
   * NOTE: currently dormant — not called from `estimateAllPlatforms`.
   * Kept here so re-enabling it once Exophase coverage constants are
   * calibrated against publisher IR is a one-line change at the call
   * site. AchievementSnapshot rows keep flowing in regardless.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async estimateFromAchievementsForPlatform(
    game: Game,
    platform: Platform,
    asOf?: Date,
  ): Promise<EstimateResult | null> {
    const coverage =
      ACHIEVEMENT_COVERAGE[platform as keyof typeof ACHIEVEMENT_COVERAGE];
    if (!coverage) return null;

    const exophase = await this.latestExophaseCapture(game.id, platform, asOf);
    if (!exophase) return null;

    const { playersTracked, mostCommon } = exophase;
    if (
      playersTracked === null ||
      playersTracked < ACHIEVEMENT_MIN_PLAYERS_TRACKED ||
      mostCommon.percentEarned <= 0
    ) {
      return null;
    }

    let exophasePlayers =
      (playersTracked * mostCommon.percentEarned) / 100;
    let bias: number | null = null;

    if (platform === Platform.PC) {
      const steamMostCommon = await this.latestSteamApiMostCommonPercent(
        game.id,
        asOf,
      );
      if (steamMostCommon && steamMostCommon > 0) {
        bias = mostCommon.percentEarned / steamMostCommon;
        if (bias > 0) exophasePlayers /= bias;
      }
    }

    const low = Math.round(exophasePlayers * coverage.low);
    const high = Math.round(exophasePlayers * coverage.high);

    if (
      low < ACHIEVEMENT_ESTIMATE_MIN_UNITS ||
      high > ACHIEVEMENT_ESTIMATE_MAX_UNITS ||
      low > high
    ) {
      this.logger.debug(
        `[estimation:achievements] "${game.name}" (${platform}) — out-of-range estimate [${low}, ${high}], skipping`,
      );
      return null;
    }

    const platformSlug = platform.toLowerCase();
    const method =
      bias !== null
        ? `achievements-exophase-${platformSlug}-steam-corrected`
        : `achievements-exophase-${platformSlug}`;

    return {
      platform,
      estimatedLow: low,
      estimatedHigh: high,
      // Coverage constants are uncalibrated defaults; will be promoted once
      // publisher IR figures land (see BACKLOG.md).
      confidence: ConfidenceLevel.LOW,
      method,
    };
  }

  /**
   * Latest Exophase capture for (game, platform), reduced to the two
   * numbers the estimator needs: the sample size (`playersTracked`) and
   * the most common achievement (`mostCommon`). All rows of a single
   * capture share the same `capturedAt`, so we identify the last capture
   * by its max timestamp and reduce its rows in memory.
   */
  private async latestExophaseCapture(
    gameId: string,
    platform: Platform,
    asOf?: Date,
  ): Promise<{
    playersTracked: number | null;
    mostCommon: AchievementSnapshot;
  } | null> {
    const rows = await this.achievements.find({
      where: {
        gameId,
        platform,
        source: SourceType.EXOPHASE,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { capturedAt: 'DESC' },
    });
    if (rows.length === 0) return null;

    const latestAt = rows[0].capturedAt.getTime();
    const latest = rows.filter((r) => r.capturedAt.getTime() === latestAt);

    const mostCommon = latest.reduce((max, a) =>
      a.percentEarned > max.percentEarned ? a : max,
    );
    return { playersTracked: mostCommon.playersTracked, mostCommon };
  }

  /**
   * Steam's official API exposes per-achievement unlock percentages over
   * the entire playerbase. We persist them as SourceType.STEAM rows on
   * Platform.PC. Here we return the highest one, which corresponds to the
   * "most common achievement" — used to debias Exophase's completionist
   * sample on PC.
   */
  private async latestSteamApiMostCommonPercent(
    gameId: string,
    asOf?: Date,
  ): Promise<number | null> {
    const rows = await this.achievements.find({
      where: {
        gameId,
        platform: Platform.PC,
        source: SourceType.STEAM,
        ...(asOf ? { capturedAt: LessThanOrEqual(asOf) } : {}),
      },
      order: { capturedAt: 'DESC' },
    });
    if (rows.length === 0) return null;

    const latestAt = rows[0].capturedAt.getTime();
    const latest = rows.filter((r) => r.capturedAt.getTime() === latestAt);
    return latest.reduce(
      (max, a) => Math.max(max, a.percentEarned),
      0,
    );
  }

  private resolveMultiplier(
    game: Game,
    cfg: PlatformConfig,
    opts: EstimateOptions = {},
  ): { low: number; high: number; method: string; isCalibrated: boolean } {
    const calibrated = opts.ignoreCalibration ? null : cfg.read(game);
    if (calibrated && calibrated > 0) {
      const source = cfg.readSource(game);
      // OFFICIAL by default for rows calibrated before the per-source
      // spread feature landed (legacy `calibratedMultiplier` without a
      // stored source).
      const spread =
        CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE[
          source ?? SalesSource.OFFICIAL
        ] ?? CALIBRATED_MULTIPLIER_SPREAD;
      const sourceSlug = (source ?? SalesSource.OFFICIAL).toLowerCase();
      return {
        low: calibrated * (1 - spread),
        high: calibrated * (1 + spread),
        method: `${cfg.methodPrefix}-calibrated-${sourceSlug}`,
        isCalibrated: true,
      };
    }
    return {
      low: cfg.defaultLow,
      high: cfg.defaultHigh,
      method: `${cfg.methodPrefix}-default`,
      isCalibrated: false,
    };
  }

  private async recalibratePlatform(
    gameId: string,
    cfg: PlatformConfig,
  ): Promise<number | null> {
    const candidates = await this.salesRecords.find({
      where: {
        gameId,
        platform: cfg.platform,
        source: In(CALIBRATION_SOURCES),
        rejectedAt: IsNull(),
        isEngagement: false,
      },
    });
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const pa = CALIBRATION_SOURCES.indexOf(a.source);
      const pb = CALIBRATION_SOURCES.indexOf(b.source);
      if (pa !== pb) return pa - pb;
      const ta = a.reportedAt?.getTime() ?? 0;
      const tb = b.reportedAt?.getTime() ?? 0;
      return tb - ta;
    });
    const best = candidates[0];
    if (best.units <= 0 || !best.reportedAt) return null;

    const target = best.reportedAt.getTime();
    const snapshots = await this.signals.find({
      where: { gameId, metric: cfg.signalMetric },
    });
    if (snapshots.length === 0) return null;

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
      return null;
    }
    if (closest.value <= 0) return null;

    const multiplier = best.units / closest.value;
    if (multiplier < cfg.plausibleMin || multiplier > cfg.plausibleMax) {
      this.logger.debug(
        `Skipping implausible ${cfg.platform} calibration for ${gameId}: ${multiplier.toFixed(1)}`,
      );
      return null;
    }

    await cfg.write(gameId, multiplier, best.source);
    return multiplier;
  }

  /**
   * Calibrate per-platform multipliers from a worldwide (`platform =
   * GLOBAL`) declared figure when no per-platform record is available.
   * The vast majority of press/IR announcements are stated worldwide
   * ("X million copies sold across all platforms") rather than broken
   * down per platform, so this fallback unlocks calibration for cases
   * `recalibratePlatform` cannot handle.
   *
   * Algorithm:
   *  1. Pick the best GLOBAL record (priority OFFICIAL > ANNOUNCEMENT >
   *     MEDIA, then most recent reportedAt).
   *  2. For each tracked platform, find the signal snapshot closest to
   *     the record's date (within `CALIBRATION_WINDOW_DAYS`).
   *  3. Compute a proxy estimate per platform using the **midpoint of
   *     the static default** multiplier (deliberately NOT the calibrated
   *     value — using the calibrated value would create a feedback loop
   *     that re-derives whatever was already stored).
   *  4. Split the declared GLOBAL units proportionally to each
   *     platform's share of the total proxy estimate.
   *  5. For each platform NOT already calibrated by `recalibratePlatform`
   *     AND whose share is at least `GLOBAL_SPLIT_MIN_PLATFORM_SHARE`,
   *     derive `multiplier = declared_p / signal_p` and persist it
   *     (with the GLOBAL record's source for spread modulation at read
   *     time).
   *
   * Per-platform calibration always takes precedence: if any platform
   * was already calibrated by a non-GLOBAL record in the same pass,
   * we never overwrite it from the GLOBAL split.
   */
  private async recalibrateFromGlobal(gameId: string): Promise<void> {
    const candidates = await this.salesRecords.find({
      where: {
        gameId,
        platform: Platform.GLOBAL,
        source: In(CALIBRATION_SOURCES),
        rejectedAt: IsNull(),
        isEngagement: false,
      },
    });
    if (candidates.length === 0) return;

    candidates.sort((a, b) => {
      const pa = CALIBRATION_SOURCES.indexOf(a.source);
      const pb = CALIBRATION_SOURCES.indexOf(b.source);
      if (pa !== pb) return pa - pb;
      const ta = a.reportedAt?.getTime() ?? 0;
      const tb = b.reportedAt?.getTime() ?? 0;
      return tb - ta;
    });
    const best = candidates[0];
    if (best.units <= 0 || !best.reportedAt) return;

    // Reload game so we see the calibrations any per-platform
    // recalibratePlatform call may have written earlier in this pass.
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return;

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
      // Per-platform calibration wins — don't overwrite.
      if (slot.cfg.read(game) != null) continue;

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

  private resolveConfidence(
    signalValue: number,
    releaseDate: Date | null,
    cfg: PlatformConfig,
  ): ConfidenceLevel {
    if (releaseDate) {
      const daysSinceRelease =
        (Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRelease >= 0 && daysSinceRelease < RECENT_RELEASE_DAYS) {
        return ConfidenceLevel.LOW;
      }
    }

    // Steam reviews are dense — thresholds 50/500. Console store ratings are
    // sparser by an order of magnitude, so we relax the bands: 10/100 ratings.
    const isSteam = cfg.signalMetric === SignalMetric.STEAM_REVIEWS;
    const lowCutoff = isSteam ? 50 : 10;
    const highCutoff = isSteam ? 500 : 100;

    if (signalValue < lowCutoff) return ConfidenceLevel.LOW;
    if (signalValue < highCutoff) return ConfidenceLevel.MEDIUM;
    return ConfidenceLevel.HIGH;
  }
}

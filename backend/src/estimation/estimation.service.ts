import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  ConfidenceLevel,
  Game,
  Platform,
  SalesEstimate,
  SalesRecord,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
  SourceType,
} from '../entities';
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
} from '../games/sales-modeling.constants';

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
const CALIBRATION_WINDOW_DAYS = 180;

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
  ): Promise<EstimateResult[]> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game || game.isFree) return [];

    const results: EstimateResult[] = [];
    for (const cfg of this.platforms) {
      const boxleiter = await this.estimateForPlatform(game, cfg, asOf);
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
    return results;
  }

  /**
   * Recalibrate (if possible) all per-platform multipliers, then compute and
   * persist a fresh SalesEstimate row for each platform that has a usable
   * signal. Returns every persisted estimate.
   */
  async computeAndStore(gameId: string): Promise<EstimateResult[]> {
    await this.recalibrateAll(gameId);

    const results = await this.estimateAllPlatforms(gameId);
    if (results.length === 0) return [];

    await this.estimates.save(
      results.map((r) =>
        this.estimates.create({
          gameId,
          platform: r.platform,
          estimatedLow: r.estimatedLow,
          estimatedHigh: r.estimatedHigh,
          confidence: r.confidence,
          method: r.method,
        }),
      ),
    );

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

    await this.estimates.save(
      results.map((r) =>
        this.estimates.create({
          gameId,
          platform: r.platform,
          estimatedLow: r.estimatedLow,
          estimatedHigh: r.estimatedHigh,
          confidence: r.confidence,
          method: r.method,
          computedAt: asOf,
        }),
      ),
    );

    return results;
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
    const { low, high, method } = this.resolveMultiplier(game, cfg);

    return {
      platform: cfg.platform,
      estimatedLow: Math.round(signalValue * low),
      estimatedHigh: Math.round(signalValue * high),
      confidence: this.resolveConfidence(signalValue, game.releaseDate, cfg),
      method,
    };
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
  ): { low: number; high: number; method: string } {
    const calibrated = cfg.read(game);
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
      };
    }
    return {
      low: cfg.defaultLow,
      high: cfg.defaultHigh,
      method: `${cfg.methodPrefix}-default`,
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

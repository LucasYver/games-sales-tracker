import { Injectable, Logger } from '@nestjs/common';
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
  CALIBRATED_MULTIPLIER_SPREAD,
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

const RECENT_RELEASE_DAYS = 14;

// Calibration only trusts a declared figure when a signal snapshot exists
// within this window of the figure's reported date — otherwise units/signals
// would mix points from very different times and produce a bogus multiplier.
const CALIBRATION_WINDOW_DAYS = 180;

// Declared sources reliable enough to calibrate against, most reliable first.
const CALIBRATION_SOURCES = [SalesSource.OFFICIAL];

interface PlatformConfig {
  platform: Platform;
  signalMetric: SignalMetric;
  defaultLow: number;
  defaultHigh: number;
  plausibleMin: number;
  plausibleMax: number;
  // How a stored Game row exposes the calibrated multiplier for this platform.
  read: (game: Game) => number | null;
  write: (gameId: string, value: number) => Promise<void>;
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
        write: (id, value) =>
          this.games.update(id, { calibratedMultiplier: value }).then(() => {}),
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
        write: (id, value) =>
          this.games
            .update(id, { calibratedPsMultiplier: value })
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
        write: (id, value) =>
          this.games
            .update(id, { calibratedXboxMultiplier: value })
            .then(() => {}),
        methodPrefix: 'xbox-ratings-boxleiter',
      },
    ];
  }

  /**
   * Estimate sales for every supported platform from each platform's most
   * recent public signal snapshot. Returns one result per platform that has a
   * usable signal; platforms with no signal (or where the game is free-to-play)
   * are silently skipped.
   */
  async estimateAllPlatforms(gameId: string): Promise<EstimateResult[]> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game || game.isFree) return [];

    const results: EstimateResult[] = [];
    for (const cfg of this.platforms) {
      const result = await this.estimateForPlatform(game, cfg);
      if (result) results.push(result);
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
   * Derive and persist this game's Boxleiter multipliers for every platform
   * that has both a reliable declared figure and a contemporaneous signal.
   * Each platform is calibrated independently; failures on one platform never
   * affect the others.
   */
  async recalibrateAll(gameId: string): Promise<void> {
    for (const cfg of this.platforms) {
      await this.recalibratePlatform(gameId, cfg);
    }
  }

  // ───── internals ────────────────────────────────────────────────────────

  private async estimateForPlatform(
    game: Game,
    cfg: PlatformConfig,
  ): Promise<EstimateResult | null> {
    const latestSignal = await this.signals.findOne({
      where: { gameId: game.id, metric: cfg.signalMetric },
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

  private resolveMultiplier(
    game: Game,
    cfg: PlatformConfig,
  ): { low: number; high: number; method: string } {
    const calibrated = cfg.read(game);
    if (calibrated && calibrated > 0) {
      return {
        low: calibrated * (1 - CALIBRATED_MULTIPLIER_SPREAD),
        high: calibrated * (1 + CALIBRATED_MULTIPLIER_SPREAD),
        method: `${cfg.methodPrefix}-calibrated`,
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

    await cfg.write(gameId, multiplier);
    return multiplier;
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

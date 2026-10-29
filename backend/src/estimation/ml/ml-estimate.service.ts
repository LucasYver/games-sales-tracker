import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game, Platform, SignalMetric, SignalSnapshot } from '../../entities';
import { platformReleaseDate } from '../../games/platform-release-date';
import { SalesProfileResolverService } from '../../reference-profiles/sales-profile-resolver.service';
import { ensembleModel, MlPrediction } from './ml-ensemble';
import {
  buildMlFeatures,
  MlSignals,
  mlSignalWindows,
  mlTooEarly,
  neverDownDates,
} from './ml-features';

/** `estimation_method.code` of the worldwide ML estimate rows. */
export const ML_METHOD_CODE = 'ml-ensemble';

/**
 * The ML estimate replaces the displayed figure only inside the zone it was
 * trained and tested on (see ml/README.md): games that publish their sales.
 * 95 % of those figures are above 300k units and come with more than ~1.7k
 * Steam reviews; the few small-Steam games among them are console hits, so
 * outside that zone the model puts small PC games, and console games with no
 * Steam page, near a million or far above.
 */
export const ML_MIN_SITE_UNITS = 300_000;
export const ML_MIN_STEAM_REVIEWS = 1_000;

/** Whether the ML estimate replaces the platform sum (`siteUnits` = its midpoint). */
export function mlEstimateApplies(
  siteUnits: number,
  steamReviews: number | null,
): boolean {
  return (
    siteUnits >= ML_MIN_SITE_UNITS &&
    (steamReviews ?? 0) >= ML_MIN_STEAM_REVIEWS
  );
}

export interface MlEstimate extends MlPrediction {
  /** Steam reviews at the date (input of `mlEstimateApplies`). */
  steamReviews: number | null;
}

// Latest real (non-reconstructed) value of a metric at a date.
const latest = (metric: SignalMetric, at: string): string => `(
  SELECT value FROM signal_snapshot
   WHERE "gameId" = $1 AND metric = '${metric}' AND NOT synthetic
     AND "capturedAt" <= ${at}
   ORDER BY "capturedAt" DESC LIMIT 1)`;

// Highest STEAM_CONCURRENT in a window, reconstructed rows included (same
// read as the first-week PC method).
const peakCcu = (where: string): string => `(
  SELECT MAX(value) FROM signal_snapshot
   WHERE "gameId" = $1 AND metric = '${SignalMetric.STEAM_CONCURRENT}'
     AND ${where})`;

// $1 game, $2 date, $3/$4 reviews 30/90 days after the PC release,
// $5 date − 90 days, $6/$7 launch window.
const SIGNALS_SQL = `
  SELECT r.value AS "reviews",
         r."capturedAt" AS "reviewsAt",
         ${latest(SignalMetric.STEAM_REVIEWS, '$3')} AS "reviews30d",
         ${latest(SignalMetric.STEAM_REVIEWS, '$4')} AS "reviews90d",
         ${latest(SignalMetric.STEAM_REVIEWS, '$5')} AS "reviews90dAgo",
         ${latest(SignalMetric.PS_RATINGS, '$2')} AS "psRatings",
         ${latest(SignalMetric.XBOX_RATINGS, '$2')} AS "xboxRatings",
         ${latest(SignalMetric.STEAM_CONCURRENT, '$2')} AS "ccuNow",
         ${peakCcu('"capturedAt" <= $2')} AS "peakCcu",
         ${peakCcu('"capturedAt" BETWEEN $6 AND $7')} AS "launchPeakCcu",
         ${latest(SignalMetric.STEAM_FOLLOWERS, '$2')} AS "followers"
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (
      SELECT value, "capturedAt" FROM signal_snapshot
       WHERE "gameId" = $1 AND metric = '${SignalMetric.STEAM_REVIEWS}'
         AND NOT synthetic AND "capturedAt" <= $2
       ORDER BY "capturedAt" DESC LIMIT 1
    ) r ON true`;

interface SignalsRow extends Omit<MlSignals, 'reviews'> {
  reviews: number | null;
  reviewsAt: Date | null;
}

/**
 * Worldwide sales estimate from the model chosen in `ml/` (see
 * `ml-ensemble.ts`). It is the figure the site displays where
 * `mlEstimateApplies`; the per-platform methods still give the platform
 * split, and remain the figure everywhere else, including the first
 * `ML_MIN_DAYS_AFTER_RELEASE` days. It never goes down over time (see
 * `estimate`); ml/frozen.py `predict_never_down` is the reference.
 *
 * The matcher runs with the game itself held out, exactly as during training:
 * the model learned from neighbours that never include the game's own
 * published figures, so feeding it a profile built from them would be a
 * different input than the one it was evaluated on.
 */
@Injectable()
export class MlEstimateService {
  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    private readonly salesProfile: SalesProfileResolverService,
  ) {}

  /** Estimate at `asOf` (default: now); null for unknown or free games. */
  async estimate(gameId: string, asOf?: Date): Promise<MlEstimate | null> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { platformReleaseDates: true },
    });
    if (!game || game.isFree) return null;

    const at = asOf ?? new Date();
    const pcReleaseDate = platformReleaseDate(game, Platform.PC);
    if (mlTooEarly(pcReleaseDate, at) || !pcReleaseDate) return null;

    const model = ensembleModel();
    const profile = await this.salesProfile.resolveForGame(game, {
      holdoutGameId: game.id,
    });
    const neighbours = profile && {
      pcBoxleiterLow: profile.pcDefaultBoxleiterLow,
      pcBoxleiterHigh: profile.pcDefaultBoxleiterHigh,
      firstWeekToYearOneMultiplier: profile.firstWeekToYearOneMultiplier,
      pcShare: profile.pcShare,
    };
    const logAt = async (date: Date) => {
      const signals = await this.loadSignals(gameId, date, pcReleaseDate);
      const features = buildMlFeatures(
        {
          asOf: date,
          releaseDate: game.releaseDate,
          pcReleaseDate,
          platforms: game.platforms ?? [],
          categories: game.categories,
          steamTags: game.steamTags,
          dlcCount: game.dlc ? game.dlc.length : null,
          franchiseSlug: game.franchiseSlug,
          liveService: game.liveService,
          isAnnualIteration: game.isAnnualIteration,
          signals,
          neighbours,
        },
        model.tagColumns,
      );
      return {
        reviews: signals.reviews?.value ?? 0,
        log: model.predictLog(features),
      };
    };

    // Cumulative sales never go down: the estimate is the highest one the
    // model gave on the J+3 … grid, counting only past dates where the game
    // already had enough Steam reviews to be in the model's zone.
    const [now, ...past] = await Promise.all(
      [at, ...neverDownDates(pcReleaseDate, at)].map(logAt),
    );
    const log = past.reduce(
      (best, p) =>
        p.reviews >= ML_MIN_STEAM_REVIEWS ? Math.max(best, p.log) : best,
      now.log,
    );
    return { ...model.fromLog(log), steamReviews: now.reviews || null };
  }

  private async loadSignals(
    gameId: string,
    at: Date,
    pcReleaseDate: Date | null,
  ): Promise<MlSignals> {
    const w = mlSignalWindows(at, pcReleaseDate);
    const [row] = await this.signals.manager.query<SignalsRow[]>(SIGNALS_SQL, [
      gameId,
      at,
      w.reviews30dAt,
      w.reviews90dAt,
      w.reviews90dAgoAt,
      w.launchStart,
      w.launchEnd,
    ]);
    const { reviews, reviewsAt, ...rest } = row;
    return {
      ...rest,
      reviews:
        reviews !== null && reviewsAt !== null
          ? { value: reviews, capturedAt: reviewsAt }
          : null,
    };
  }
}

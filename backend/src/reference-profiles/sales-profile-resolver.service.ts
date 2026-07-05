import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Game, Year2Retention } from '../entities';
import { MatcherService, type MatchResult } from './matcher.service';
import {
  PC_BOXLEITER_DEFAULT_HIGH,
  PC_BOXLEITER_DEFAULT_LOW,
  PS_BOXLEITER_DEFAULT_HIGH,
  PS_BOXLEITER_DEFAULT_LOW,
} from '../games/sales-modeling.constants';

/**
 * Numeric platform + lifecycle profile the estimation model consumes.
 * Historically blended from `GenreProfile` rows; now emitted entirely
 * by the data-driven matcher. The name is kept for continuity with the
 * estimation call sites that still import `ResolvedGenreProfile`.
 */
export interface ResolvedGenreProfile {
  matchedSlugs: string[];
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  tailFactorY2: number;
  tailFactorY5: number;
  lifecycleIndex: number;
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
}

/**
 * Environment flag toggling the matcher path. Defaults to **on**: the
 * matcher is the sole source of the estimation profile now that the
 * legacy `GenreProfile` is gone. Set `USE_MATCHER_PROFILE=false` (or
 * `0` / `off`) as an emergency kill switch — the resolver then emits no
 * profile and the estimator falls back to its own global constants.
 */
const FLAG_ENV = 'USE_MATCHER_PROFILE';
const DISABLED_VALUES = new Set(['false', '0', 'off', 'no']);

/**
 * Retention-bucket thresholds on the Y2/Y1 ratio (`curve.a2`). Kept in
 * one place so tuning the boundaries doesn't require touching the
 * matcher itself.
 */
const RETENTION_THRESHOLDS: Array<{
  maxRatio: number;
  bucket: Year2Retention;
}> = [
  { maxRatio: 1.05, bucket: Year2Retention.NEGATIVE },
  { maxRatio: 1.15, bucket: Year2Retention.VERY_LOW },
  { maxRatio: 1.25, bucket: Year2Retention.LOW },
  { maxRatio: 1.4, bucket: Year2Retention.LOW_MEDIUM },
  { maxRatio: 1.6, bucket: Year2Retention.MEDIUM },
  { maxRatio: 1.85, bucket: Year2Retention.MEDIUM_HIGH },
  { maxRatio: 2.2, bucket: Year2Retention.HIGH },
  { maxRatio: Number.POSITIVE_INFINITY, bucket: Year2Retention.VERY_HIGH },
];

/**
 * Spread around the anchor-derived `reviewsToUnits` used to build the
 * PC Boxleiter default range. 0.25 = ±25% (in linear units), which is
 * roughly the inter-anchor spread we observe once similarity-weighted.
 */
const BOXLEITER_SPREAD_FRACTION = 0.25;

/**
 * Spread around the anchor-derived `peakCcuRatio` used to build the
 * peak-CCU → week-1 band. 0.3 = ±30%, roughly the inter-anchor spread
 * of the ratio once similarity-weighted, and comparable to the width
 * of the hand-set genre-profile bands it replaces.
 */
const PEAK_CCU_SPREAD_FRACTION = 0.3;

/**
 * PlayStation-to-PC Boxleiter ratio: how much rarer a PS Store rating
 * is per unit sold than a Steam review. Derived from the midpoints of
 * the global default bands (`PS_BOXLEITER_DEFAULT` vs
 * `PC_BOXLEITER_DEFAULT`) so it stays consistent with the rest of the
 * model if those are retuned. We have no independent per-platform units
 * ground truth (milestone platform was dropped, the leak is PC-only),
 * so the PS default is derived from the *observed* PC reviews→units
 * ratio scaled by this store-density gap — better than a hand-set genre
 * constant because it now tracks the game's real monetisation intensity,
 * while assuming PS intensity moves with PC intensity.
 */
const PS_TO_PC_BOXLEITER_RATIO =
  (PS_BOXLEITER_DEFAULT_LOW + PS_BOXLEITER_DEFAULT_HIGH) /
  (PC_BOXLEITER_DEFAULT_LOW + PC_BOXLEITER_DEFAULT_HIGH);

/**
 * Sole source of the estimation profile: the data-driven matcher.
 * Emits the `ResolvedGenreProfile` shape from the nearest anchors'
 * observed vectors, field by field:
 *
 *   - platform shares  → matcher (default 50/25/15/10 when unobserved)
 *   - m1 / tail Y2/Y5  → matcher curve (neutral defaults when unobserved)
 *   - year2 retention  → matcher curve → retention bucket
 *   - pcBoxleiter defaults → matcher reviewsToUnits ± spread (null →
 *     estimator's global constant)
 *   - psBoxleiter defaults → matcher reviewsToUnits × store-density ratio
 *     ± spread (null → estimator's global constant)
 *   - peakCcuToWeekOne → matcher peakCcuRatio ± spread (global 3–7 default)
 *   - lifecycleIndex → neutral 1.0 (not consumed by the estimation math)
 *
 * The legacy `GenreProfile` has been removed: cold-start games (no close
 * neighbours) now take the matcher's global-mean aggregate rather than a
 * hand-tuned genre bucket. `null` is returned only when the corpus is
 * empty (no anchor at all), or when `USE_MATCHER_PROFILE` is explicitly
 * disabled — in both cases the estimator falls back to its own global
 * constants.
 */
@Injectable()
export class SalesProfileResolverService {
  private readonly logger = new Logger(SalesProfileResolverService.name);
  private readonly matcherEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly matcher: MatcherService,
  ) {
    const raw = this.config.get<string>(FLAG_ENV);
    this.matcherEnabled =
      raw === undefined || !DISABLED_VALUES.has(raw.trim().toLowerCase());
    this.logger.log(
      this.matcherEnabled
        ? `${FLAG_ENV} on → matcher drives the estimation profile.`
        : `${FLAG_ENV} off → no profile emitted (estimator uses global constants).`,
    );
  }

  /** Whether the matcher path is active (exposed for admin monitoring). */
  isMatcherEnabled(): boolean {
    return this.matcherEnabled;
  }

  /**
   * Resolve a game's estimation profile from the matcher. Accepts a
   * narrow `Pick<Game, ...>` so callers loading a partial game (via
   * `select: { ... }`) can drive it without a full entity hydration.
   *
   * `holdoutGameId`: pass the target's own `id` to exclude it from the
   * anchor corpus (only relevant to the validation script — production
   * calls should leave it undefined).
   *
   * Returns `null` when the matcher is disabled or the corpus yields no
   * anchor at all; the estimator then uses its global-constant defaults.
   */
  async resolveForGame(
    game: Pick<
      Game,
      | 'id'
      | 'platforms'
      | 'categories'
      | 'genres'
      | 'steamTags'
      | 'publisherId'
      | 'publisher'
      | 'dlc'
      | 'releaseDate'
      | 'developer'
      | 'franchiseSlug'
      | 'isAnnualIteration'
      | 'liveService'
    >,
    opts: { holdoutGameId?: string } = {},
  ): Promise<ResolvedGenreProfile | null> {
    if (!this.matcherEnabled) return null;

    const match = await this.matcher.findNeighbours(
      {
        platforms: game.platforms ?? [],
        categories: game.categories ?? null,
        genres: game.genres ?? null,
        steamTags: game.steamTags ?? null,
        publisherId: game.publisherId ?? null,
        publisher: game.publisher ?? null,
        dlc: game.dlc ?? null,
        releaseDate: game.releaseDate ?? null,
        developer: game.developer ?? null,
        franchiseSlug: game.franchiseSlug ?? null,
        isAnnualIteration: game.isAnnualIteration ?? false,
        liveService: game.liveService ?? false,
      },
      { holdoutGameId: opts.holdoutGameId, targetGameId: game.id },
    );

    // Empty corpus → nothing to say; let the estimator use its globals.
    if (match.neighboursUsed === 0) return null;

    return overlay(match);
  }

  /**
   * Overlay an ALREADY-computed match into the resolved profile — lets callers
   * that already ran `findNeighbours` (e.g. the admin matcher inspector) reuse
   * it instead of running the matcher a second time.
   */
  resolveFromMatch(match: MatchResult): ResolvedGenreProfile | null {
    if (match.neighboursUsed === 0) return null;
    return overlay(match);
  }
}

/**
 * Produce the `ResolvedGenreProfile` from a matcher result. Extracted
 * from the class so it can be unit-tested without a Nest context.
 */
function overlay(match: MatchResult): ResolvedGenreProfile {
  const shares = match.platformShares;
  const s1 = match.curve.s1;
  const a2 = match.curve.a2;
  const reviewsToUnits = match.reviewsToUnits;

  const m1 = s1 !== null && s1 > 0 ? 1 / s1 : 2.5;
  const tailY2 = a2 ?? 1.25;
  const tailY5 = a2 !== null && a2 !== undefined ? Math.pow(a2, 1.5) : 1.5;
  const retention =
    a2 !== null && a2 !== undefined
      ? retentionFromRatio(a2)
      : Year2Retention.LOW;

  // Boxleiter defaults: null when unobserved so the estimator falls back
  // to its own global PC/PS constants.
  const [pcLow, pcHigh] =
    reviewsToUnits !== null
      ? [
          reviewsToUnits * (1 - BOXLEITER_SPREAD_FRACTION),
          reviewsToUnits * (1 + BOXLEITER_SPREAD_FRACTION),
        ]
      : [null, null];

  const [psLow, psHigh] =
    reviewsToUnits !== null
      ? [
          reviewsToUnits *
            PS_TO_PC_BOXLEITER_RATIO *
            (1 - BOXLEITER_SPREAD_FRACTION),
          reviewsToUnits *
            PS_TO_PC_BOXLEITER_RATIO *
            (1 + BOXLEITER_SPREAD_FRACTION),
        ]
      : [null, null];

  const peakCcuRatio = match.peakCcuRatio;
  const [peakCcuLow, peakCcuHigh] =
    peakCcuRatio !== null && peakCcuRatio > 0
      ? [
          peakCcuRatio * (1 - PEAK_CCU_SPREAD_FRACTION),
          peakCcuRatio * (1 + PEAK_CCU_SPREAD_FRACTION),
        ]
      : [3, 7];

  return {
    matchedSlugs: [`matcher:${match.neighboursUsed}`],
    pcShare: shares?.pc ?? 0.5,
    playstationShare: shares?.ps ?? 0.25,
    xboxShare: shares?.xbox ?? 0.15,
    switchShare: shares?.switch ?? 0.1,
    firstWeekToYearOneMultiplier: m1,
    year2Retention: retention,
    tailFactorY2: tailY2,
    tailFactorY5: tailY5,
    // Cosmetic only — not consumed by the estimation math.
    lifecycleIndex: 1.0,
    peakCcuToWeekOneLow: peakCcuLow,
    peakCcuToWeekOneHigh: peakCcuHigh,
    pcDefaultBoxleiterLow: pcLow,
    pcDefaultBoxleiterHigh: pcHigh,
    psDefaultBoxleiterLow: psLow,
    psDefaultBoxleiterHigh: psHigh,
  };
}

function retentionFromRatio(ratio: number): Year2Retention {
  for (const step of RETENTION_THRESHOLDS) {
    if (ratio <= step.maxRatio) return step.bucket;
  }
  return Year2Retention.VERY_HIGH;
}

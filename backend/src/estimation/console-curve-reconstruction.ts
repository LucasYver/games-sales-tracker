/**
 * Reconstruct a console (PlayStation or Xbox) ratings-over-time curve from a
 * single recent anchor plus the SAME game's dense Steam-review cumulative
 * curve, used as a temporal SHAPE prior.
 *
 * Validated on real held-out console points (2026-11-17, ~920 PS games and
 * ~1,800 Xbox games): when the known point is more than a year after the
 * reconstructed day (the real use case, PS only so far), median error ≈ x1.17
 * and 95% of games within x2, against x1.51 / 74% for a flat line. Xbox history
 * only starts on 2026-09-13, so Xbox is validated over ~2 months only, where the
 * model matches the flat line. See `_tmp-validate-ps-reconstruction.ts`.
 *
 * The model: console ratings and Steam reviews of the same title accumulate
 * with a similar shape once each is expressed as elapsed time since its own
 * launch. So, mapping a console date onto the Steam timeline by preserving
 * elapsed time,
 *
 *     C(t) = anchorValue * steamAligned(t) / steamAligned(anchorDate)
 *
 * where `steamAligned(d)` is the cumulative Steam review count at the Steam
 * date equivalent to console-elapsed `d`. Anchoring the Steam side on the FIRST
 * Steam review (not the IGDB PC release) absorbs "late-to-Steam" titles whose
 * store availability lags their general PC/console launch.
 *
 * Pure and dependency-free. The admin charts call it on the fly; nothing is
 * stored.
 */

export interface DatedValue {
  capturedAt: Date;
  value: number;
}

export interface ConsoleReconstructionInputs {
  /** Latest REAL console ratings snapshot (value must be > 0). */
  anchor: DatedValue;
  /** Launch date on that console; null falls back to calendar alignment. */
  releaseDate: Date | null;
  /** REAL STEAM_REVIEWS snapshots, ascending by capturedAt (cumulative). */
  steamReviews: DatedValue[];
  /**
   * Below this many Steam reviews at the anchor the game has a negligible
   * Steam footprint (console-first titles): the shape is meaningless and we
   * abstain rather than emit a bogus curve.
   */
  steamFloor?: number;
  /**
   * Shape-reliability guardrail (see `shapeRatioFloor` / `maxSteamLagDays`).
   * When the anchor's console/Steam magnitude ratio is very small AND the
   * game's Steam launch is far from its console launch, the Steam curve is a
   * temporally misaligned prior (early-access-on-Steam or late-to-Steam titles
   * like CoD Vanguard) and the reconstruction blows up. Empirically, abstaining
   * on `ratio < 0.1 && |firstSteam - release| > 365d` removes 9/10 of the
   * catastrophic (>4x) held-out errors while only dropping ~8% of points. A
   * game-level cross-validated grid search on 2026-11-17 found no better
   * setting for either console.
   */
  shapeRatioFloor?: number;
  maxSteamLagDays?: number;
}

export type ReconstructionAbstainReason =
  | 'no-anchor'
  | 'no-steam'
  | 'pre-release'
  | 'negligible-steam'
  | 'before-steam-start'
  | 'shape-unreliable';

export type ReconstructionOutcome =
  | { value: number; reason: null }
  | { value: null; reason: ReconstructionAbstainReason };

export const DEFAULT_STEAM_FLOOR = 500;
export const DEFAULT_SHAPE_RATIO_FLOOR = 0.1;
export const DEFAULT_MAX_STEAM_LAG_DAYS = 365;
const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Reconstruct the console rating count at `target`. Returns `{ value: null }`
 * with a reason whenever a guardrail trips (caller should abstain rather than
 * trust a fabricated number).
 */
export function reconstructRatingAt(
  target: Date,
  inputs: ConsoleReconstructionInputs,
): ReconstructionOutcome {
  const { anchor, releaseDate, steamReviews } = inputs;
  const floor = inputs.steamFloor ?? DEFAULT_STEAM_FLOOR;
  const shapeRatioFloor = inputs.shapeRatioFloor ?? DEFAULT_SHAPE_RATIO_FLOOR;
  const maxSteamLagDays = inputs.maxSteamLagDays ?? DEFAULT_MAX_STEAM_LAG_DAYS;

  if (!anchor || anchor.value <= 0) return { value: null, reason: 'no-anchor' };
  if (steamReviews.length === 0) return { value: null, reason: 'no-steam' };

  // First Steam review ≈ the game's Steam launch; anchoring here (rather than
  // the IGDB PC date) handles titles that arrived on Steam much later.
  const steamStart = steamReviews[0].capturedAt;

  if (releaseDate && target.getTime() < releaseDate.getTime()) {
    return { value: null, reason: 'pre-release' };
  }

  // Shape-reliability guardrail. Only computable when we know the launch.
  // Compares the anchor's real console magnitude to the raw (unaligned) Steam
  // count at the anchor date: a tiny ratio means Steam dwarfs the console, and
  // combined with a large Steam↔console launch gap the shape is temporally
  // untrustworthy — abstain.
  if (releaseDate) {
    let rawSteamAtAnchor: number | null = null;
    for (const p of steamReviews) {
      if (p.capturedAt.getTime() <= anchor.capturedAt.getTime()) {
        rawSteamAtAnchor = p.value;
      } else break;
    }
    if (rawSteamAtAnchor !== null && rawSteamAtAnchor > 0) {
      const ratio = anchor.value / rawSteamAtAnchor;
      const lagDays =
        Math.abs(steamStart.getTime() - releaseDate.getTime()) / MS_PER_DAY;
      if (ratio < shapeRatioFloor && lagDays > maxSteamLagDays) {
        return { value: null, reason: 'shape-unreliable' };
      }
    }
  }

  const steamAligned = (d: Date): number | null => {
    const mapped = releaseDate
      ? new Date(steamStart.getTime() + (d.getTime() - releaseDate.getTime()))
      : d;
    // Latest cumulative Steam review count at/at-before the mapped date.
    let found: number | null = null;
    for (const p of steamReviews) {
      if (p.capturedAt.getTime() <= mapped.getTime()) found = p.value;
      else break;
    }
    return found;
  };

  const sAnchor = steamAligned(anchor.capturedAt);
  if (sAnchor === null) return { value: null, reason: 'before-steam-start' };
  if (sAnchor < floor) return { value: null, reason: 'negligible-steam' };

  const sTarget = steamAligned(target);
  if (sTarget === null) return { value: null, reason: 'before-steam-start' };

  return { value: anchor.value * (sTarget / sAnchor), reason: null };
}

/**
 * Build a monthly reconstructed series over `[fromDate, toDate]` (inclusive
 * of both ends when they land on the step). Points that trip a guardrail are
 * skipped. Values are rounded to whole ratings.
 */
export function reconstructCurveMonthly(
  fromDate: Date,
  toDate: Date,
  inputs: ConsoleReconstructionInputs,
): DatedValue[] {
  const out: DatedValue[] = [];
  if (fromDate.getTime() > toDate.getTime()) return out;

  const cursor = new Date(fromDate.getTime());
  // Guard against pathological ranges producing an unbounded loop.
  let guard = 0;
  while (cursor.getTime() <= toDate.getTime() && guard < 1000) {
    const outcome = reconstructRatingAt(cursor, inputs);
    if (outcome.value !== null) {
      out.push({
        capturedAt: new Date(cursor.getTime()),
        value: Math.round(outcome.value),
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    guard += 1;
  }

  // Ensure the final endpoint is represented even if the monthly step skipped
  // over it (keeps the reconstructed line meeting the first real point).
  const lastStep = out[out.length - 1];
  if (!lastStep || lastStep.capturedAt.getTime() !== toDate.getTime()) {
    const endOutcome = reconstructRatingAt(toDate, inputs);
    if (endOutcome.value !== null) {
      out.push({
        capturedAt: new Date(toDate.getTime()),
        value: Math.round(endOutcome.value),
      });
    }
  }

  return out;
}

/**
 * The "day one → first measurement" curve: monthly reconstructed points from
 * the console launch (or the Steam start when the launch is unknown) up to the
 * day before the earliest real snapshot. Only the unobserved early stretch is
 * filled; real points are never replaced. Empty when there is no gap or the
 * model abstains.
 */
export function reconstructUnobservedCurve(
  realRatings: DatedValue[],
  steamReviews: DatedValue[],
  releaseDate: Date | null,
): DatedValue[] {
  if (realRatings.length === 0 || steamReviews.length === 0) return [];
  const anchor = realRatings[realRatings.length - 1];
  if (anchor.value <= 0) return [];

  const fromDate = releaseDate ?? steamReviews[0].capturedAt;
  const toDate = new Date(realRatings[0].capturedAt.getTime() - MS_PER_DAY);
  return reconstructCurveMonthly(fromDate, toDate, {
    anchor,
    releaseDate,
    steamReviews,
  });
}

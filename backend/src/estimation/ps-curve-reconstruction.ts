/**
 * Reconstruct a PlayStation ratings-over-time curve from a single recent
 * anchor plus the SAME game's dense Steam-review cumulative curve, used as a
 * temporal SHAPE prior. Empirically validated on real (non-synthetic) held-out
 * PS points: median error ≈ x1.09, and with the shape-reliability guardrail
 * below ~97% of kept points fall within x2 — see
 * `_tmp-validate-ps-reconstruction.ts`.
 *
 * The model: PS ratings and Steam reviews of the same title accumulate with a
 * similar shape once each is expressed as elapsed-time-since-its-own-launch.
 * So, mapping a PS date onto the Steam timeline by preserving elapsed time,
 *
 *     PS(t) = anchorValue * steamAligned(t) / steamAligned(anchorDate)
 *
 * where `steamAligned(d)` is the cumulative Steam review count at the Steam
 * date equivalent to PS-elapsed `d`. Anchoring the Steam side on the FIRST
 * Steam review (not the IGDB PC release) absorbs "late-to-Steam" titles whose
 * store availability lags their general PC/console launch.
 *
 * Pure and dependency-free so it can be unit-tested and reused by both the
 * calibration path (single value at a milestone date) and the display backfill
 * (a monthly synthetic series).
 */

export interface DatedValue {
  capturedAt: Date;
  value: number;
}

export interface PsReconstructionInputs {
  /** Latest REAL PS_RATINGS snapshot (value must be > 0). */
  anchor: DatedValue;
  /** Per-platform PS launch date; null falls back to calendar alignment. */
  psReleaseDate: Date | null;
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
   * When the anchor's PS/Steam magnitude ratio is very small AND the game's
   * Steam launch is far from its PS launch, the Steam curve is a temporally
   * misaligned prior (early-access-on-Steam or late-to-Steam titles like CoD
   * Vanguard) and the reconstruction blows up. Empirically, abstaining on
   * `ratio < 0.1 && |firstSteam - psRelease| > 365d` removes 9/10 of the
   * catastrophic (>4x) held-out errors while only dropping ~8% of points and
   * lifting the kept set to 97% within 2x — see `_tmp-validate-ps-reconstruction.ts`.
   */
  shapeRatioFloor?: number;
  maxSteamLagDays?: number;
}

export type ReconstructionAbstainReason =
  | 'no-anchor'
  | 'no-steam'
  | 'pre-ps-release'
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
 * Reconstruct the PS rating count at `target`. Returns `{ value: null }` with
 * a reason whenever a guardrail trips (caller should abstain, i.e. keep the
 * existing behaviour rather than trust a fabricated number).
 */
export function reconstructPsRatingAt(
  target: Date,
  inputs: PsReconstructionInputs,
): ReconstructionOutcome {
  const { anchor, psReleaseDate, steamReviews } = inputs;
  const floor = inputs.steamFloor ?? DEFAULT_STEAM_FLOOR;
  const shapeRatioFloor = inputs.shapeRatioFloor ?? DEFAULT_SHAPE_RATIO_FLOOR;
  const maxSteamLagDays = inputs.maxSteamLagDays ?? DEFAULT_MAX_STEAM_LAG_DAYS;

  if (!anchor || anchor.value <= 0) return { value: null, reason: 'no-anchor' };
  if (steamReviews.length === 0) return { value: null, reason: 'no-steam' };

  // First Steam review ≈ the game's Steam launch; anchoring here (rather than
  // the IGDB PC date) handles titles that arrived on Steam much later.
  const steamStart = steamReviews[0].capturedAt;

  if (psReleaseDate && target.getTime() < psReleaseDate.getTime()) {
    return { value: null, reason: 'pre-ps-release' };
  }

  // Shape-reliability guardrail. Only computable when we know the PS launch.
  // Compares the anchor's real PS magnitude to the raw (unaligned) Steam count
  // at the anchor date: a tiny ratio means Steam dwarfs PS, and combined with a
  // large Steam↔PS launch gap the shape is temporally untrustworthy — abstain.
  if (psReleaseDate) {
    let rawSteamAtAnchor: number | null = null;
    for (const p of steamReviews) {
      if (p.capturedAt.getTime() <= anchor.capturedAt.getTime()) {
        rawSteamAtAnchor = p.value;
      } else break;
    }
    if (rawSteamAtAnchor !== null && rawSteamAtAnchor > 0) {
      const ratio = anchor.value / rawSteamAtAnchor;
      const lagDays =
        Math.abs(steamStart.getTime() - psReleaseDate.getTime()) / MS_PER_DAY;
      if (ratio < shapeRatioFloor && lagDays > maxSteamLagDays) {
        return { value: null, reason: 'shape-unreliable' };
      }
    }
  }

  const steamAligned = (d: Date): number | null => {
    const mapped = psReleaseDate
      ? new Date(steamStart.getTime() + (d.getTime() - psReleaseDate.getTime()))
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
 * Build a monthly reconstructed PS series over `[fromDate, toDate]` (inclusive
 * of both ends when they land on the step). Points that trip a guardrail are
 * skipped. Used to materialise the "day one → first real snapshot" curve for
 * display. Values are rounded to whole ratings.
 */
export function reconstructPsCurveMonthly(
  fromDate: Date,
  toDate: Date,
  inputs: PsReconstructionInputs,
): DatedValue[] {
  const out: DatedValue[] = [];
  if (fromDate.getTime() > toDate.getTime()) return out;

  const cursor = new Date(fromDate.getTime());
  // Guard against pathological ranges producing an unbounded loop.
  let guard = 0;
  while (cursor.getTime() <= toDate.getTime() && guard < 1000) {
    const outcome = reconstructPsRatingAt(cursor, inputs);
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
  if (
    !lastStep ||
    lastStep.capturedAt.getTime() !== toDate.getTime()
  ) {
    const endOutcome = reconstructPsRatingAt(toDate, inputs);
    if (endOutcome.value !== null) {
      out.push({
        capturedAt: new Date(toDate.getTime()),
        value: Math.round(endOutcome.value),
      });
    }
  }

  return out;
}

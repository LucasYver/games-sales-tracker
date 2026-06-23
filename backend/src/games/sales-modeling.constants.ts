/**
 * Central registry of every numeric constant used to model game sales over
 * time. Each value is documented with: where it comes from (industry source
 * or assumption), what it controls, and where it is consumed in the codebase.
 *
 * Tweaking any of these values is the supported way to recalibrate the
 * model — keep this file as the single source of truth so the assumptions
 * stay traceable.
 */

import { ConfidenceLevel, LauncherProfile } from '../entities';

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365 * DAY_MS;

// ─── Lifetime sales curve ────────────────────────────────────────────────────
//
// Industry benchmark for the cumulative % of a game's lifetime revenue
// reached at a given age (days from release).
//
// Source: Eastshade Studios "Genre Viability on Steam" (gamedeveloper.com)
// cross-checked with GameDiscoverCo "Steam long tail revenue" newsletters
// (2021, 2024). The curve is the median across thousands of Steam titles —
// some games (live-service, viral hits) go far above; flops decay faster.
//
// Used by `freshnessCap` (games.service.ts) to bound how much sales can have
// grown between a declared figure's date and today.
//   declaredPct = lifetimeSalesPct(ageAtDeclared)
//   todayPct    = lifetimeSalesPct(ageToday)
//   expected    = declared.units * todayPct / declaredPct

export const LIFETIME_SALES_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [7, 0.13], // 13% in the first week
  [90, 0.33], // 33% by the end of Q1
  [365, 0.58], // 58% by Y1
  [730, 0.75], // 75% by Y2
  [1095, 0.87], // 87% by Y3
  [1460, 0.95], // 95% by Y4
  [1825, 1.0], // ~100% by Y5 (post-Y5 growth treated as flat)
];

// ─── Freshness cap ───────────────────────────────────────────────────────────
//
// Used by `freshnessCap` to derive the absolute maximum a "today" figure can
// reach given a dated declared figure.
//
// FRESHNESS_VARIANCE_BUFFER multiplies the *delta* above 1.0 in the expected
// growth ratio. 1.5 means we allow 50% more headroom than the curve's median
// — this covers the ~95th percentile of long-tail outliers reported by
// GameDiscoverCo (median Y1 multiplier 2.6x, top 5% ~9.7x) without becoming
// meaningless. Increase if too many real cases get capped, decrease if the
// model lets unrealistic high-end estimates through.
//
// FRESHNESS_MIN_HEADROOM is a tiny floor so the cap is never *below* the
// declared figure due to floating-point drift on a near-zero growth ratio.

export const FRESHNESS_VARIANCE_BUFFER = 1.5;
export const FRESHNESS_MIN_HEADROOM = 1.01; // declared * 1.01

// Fallback when release date is unknown: flat ~60%/year, capped past 3 years
// (treats older catalog entries the same way `classifyAgreement` does).
export const FALLBACK_ANNUAL_GROWTH = 0.6;
export const FALLBACK_GROWTH_CAP_YEARS = 3;

// ─── Agreement classifier (declared vs estimate) ─────────────────────────────
//
// Used by `classifyAgreement` (games.service.ts) to label how a declared
// figure cross-checks against an independent estimate.
//
// AGREEMENT_OVERSHOOT_RATIO: when the declared figure is above our estimate
// range, "weak" agreement up to this multiple of estimateHigh, "conflict"
// beyond. 1.5 = declared up to 1.5× our high end is "model undershoot"; past
// that the figure or the estimate is likely wrong.
//
// AGREEMENT_GROWTH_PER_YEAR: when the declared figure is below our estimate
// range, we expect growth since then. The same 60%/year as the freshness cap
// fallback: an estimate up to (1 + 0.6 * ageYears)× the declared is plausible
// "weak" growth, up to 2× that is "weak with caution", beyond is "conflict".

export const AGREEMENT_OVERSHOOT_RATIO = 1.5;
export const AGREEMENT_GROWTH_PER_YEAR = FALLBACK_ANNUAL_GROWTH; // shared

// ─── Boxleiter multipliers (signal → units per platform) ────────────────────
//
// For each platform, "units sold ≈ public signal × multiplier". The multiplier
// is platform-specific because the propensity to leave a review/rating varies
// hugely between stores: Steam reviews are dense and well-documented, console
// store ratings are much sparser. Each platform has:
//   - a default range (used when we can't calibrate against a declared figure)
//   - plausible bounds (a calibrated value outside these is treated as a data
//     error and discarded, leaving the default range in place)
//
// Used by EstimationService.estimatePlatformSales and recalibrate.

// PC / Steam — classical Boxleiter range (historic anchor).
// Source: Tyler Glaiel "Boxleiter number", GameDiscoverCo (2023 update).
export const PC_BOXLEITER_DEFAULT_LOW = 25;
export const PC_BOXLEITER_DEFAULT_HIGH = 70;
export const PC_BOXLEITER_PLAUSIBLE_MIN = 5;
export const PC_BOXLEITER_PLAUSIBLE_MAX = 500;

// PlayStation Store — much sparser ratings; ~40-100 units per rating on
// average AAA titles (cross-checking declared SIE IR figures against PSN
// rating snapshots). Wide range to express genuine uncertainty.
export const PS_BOXLEITER_DEFAULT_LOW = 40;
export const PS_BOXLEITER_DEFAULT_HIGH = 100;
export const PS_BOXLEITER_PLAUSIBLE_MIN = 8;
export const PS_BOXLEITER_PLAUSIBLE_MAX = 600;

// Xbox Store — comparable scale to PSN, slightly lower review density on
// average per Microsoft Gaming reports. Same caveat: bootstrap estimate,
// per-game calibration tightens it.
export const XBOX_BOXLEITER_DEFAULT_LOW = 35;
export const XBOX_BOXLEITER_DEFAULT_HIGH = 90;
export const XBOX_BOXLEITER_PLAUSIBLE_MIN = 6;
export const XBOX_BOXLEITER_PLAUSIBLE_MAX = 600;

// ─── Peak CCU multiplier (Steam concurrent players → PC units) ──────────────
//
// A largely independent second signal for PC sales, used alongside the
// reviews-based Boxleiter estimate. The all-time peak concurrent player
// count is polled daily from Steam's `GetNumberOfCurrentPlayers` and
// persisted as `SignalSnapshot(STEAM_PEAK_CCU)`. At estimation time the
// CCU-based range `[peak × LOW, peak × HIGH]` is intersected with the
// reviews-based range to tighten the PC estimate.
//
// Empirical anchor points (peak CCU → eventual lifetime Steam units):
//   PUBG          3.2M peak → ~75M    (~23×)
//   Cyberpunk     1.0M peak → ~30M    (~30×)
//   Elden Ring     953K peak → ~25M    (~26×)
//   Helldivers 2   458K peak → ~12M    (~26×)
//   BG3            875K peak → ~15M    (~17×)
//   Hogwarts Leg.  879K peak → ~15M    (~17×)
//   Palworld       2.1M peak → ~15M+   (~7× short term, climbs with age)
//   Stardew Valley  95K peak → ~30M+   (~315× long tail)
//
// The default range is deliberately wide because the units/peak-CCU ratio
// grows strongly with age (single-player Y1 hits sit around 10-25×, long-
// tail catalog titles climb past 100×). It is meant to be tightened by
// intersecting with the reviews-based range, not used standalone.
//
// PLAUSIBLE_MIN/MAX are reserved for a future per-game calibrated CCU
// multiplier (mirroring the Boxleiter recalibration flow); they are not
// yet read by EstimationService.

export const PC_CCU_DEFAULT_LOW = 8;
export const PC_CCU_DEFAULT_HIGH = 40;
export const PC_CCU_PLAUSIBLE_MIN = 4;
export const PC_CCU_PLAUSIBLE_MAX = 500;

// ─── Launcher profile scaling (Steam → total PC) ────────────────────────────
//
// The Boxleiter reviews multiplier and the peak-CCU multiplier above both
// implicitly assume Steam captures ~100% of the PC market for a game —
// true for most indie titles and many AAA, but not for titles whose
// publisher pushes players to a competing storefront (Epic, GOG) or a
// proprietary launcher (Ubisoft Connect, EA App, Battle.net, Microsoft
// Store). Without correction, Boxleiter on Steam under-shoots total PC
// units by ~2× (multi-store) up to ~5× (launcher-primary) for those games.
//
// The `Publisher.launcherProfile` field (set by heuristic on a curated
// list of big publishers, editable in the admin) drives a per-profile
// scaling of the *default* reviews and CCU ranges. When a game has a
// per-game calibrated multiplier (`calibratedMultiplier`, derived from
// a declared OFFICIAL/MEDIA figure), scaling is intentionally skipped:
// the empirical calibration has already absorbed the launcher effect.
//
// Anchor reasoning:
//   - STEAM_DOMINANT (default for unmatched publishers): no scaling.
//   - MULTI_STORE: Steam ~ 40-70% of PC → range × [1.4, 2.0].
//   - LAUNCHER_PRIMARY: Steam ~ 10-25% of PC → range × [3.5, 7.0].
//
// The fourchette widens proportionally because per-game variance grows
// with launcher fragmentation: confidence is also capped (see
// `LAUNCHER_CONFIDENCE_CAP`) so callers don't mistake a wide launcher-
// primary estimate for a HIGH-confidence one.

export const LAUNCHER_REVIEWS_FACTOR: Record<
  LauncherProfile,
  { low: number; high: number }
> = {
  [LauncherProfile.STEAM_DOMINANT]: { low: 1.0, high: 1.0 },
  [LauncherProfile.MULTI_STORE]: { low: 1.4, high: 2.0 },
  [LauncherProfile.LAUNCHER_PRIMARY]: { low: 3.5, high: 7.0 },
};

export const LAUNCHER_CCU_FACTOR: Record<
  LauncherProfile,
  { low: number; high: number }
> = {
  [LauncherProfile.STEAM_DOMINANT]: { low: 1.0, high: 1.0 },
  [LauncherProfile.MULTI_STORE]: { low: 1.4, high: 2.0 },
  [LauncherProfile.LAUNCHER_PRIMARY]: { low: 3.5, high: 7.0 },
};

// Maximum confidence the estimation engine is allowed to return for a
// PC estimate, based on the publisher's launcher profile. STEAM_DOMINANT
// keeps the natural HIGH/MEDIUM/LOW from signal density; MULTI_STORE caps
// at MEDIUM (Steam-only signals can never be HIGH-confidence on a multi-
// store title); LAUNCHER_PRIMARY caps at LOW (Steam signal is a minority
// proxy by construction).
export const LAUNCHER_CONFIDENCE_CAP: Record<
  LauncherProfile,
  ConfidenceLevel | null
> = {
  [LauncherProfile.STEAM_DOMINANT]: null,
  [LauncherProfile.MULTI_STORE]: ConfidenceLevel.MEDIUM,
  [LauncherProfile.LAUNCHER_PRIMARY]: ConfidenceLevel.LOW,
};

// Tightening factor applied around a calibrated multiplier when computing the
// per-platform Boxleiter range: low = m * (1 - X), high = m * (1 + X).
//
// The spread depends on how trustworthy the declared figure that produced
// the calibration was. An IR press release nails the number to the unit;
// a journalist might round to the nearest million or cite an estimate.
//
// Mapped per `SalesSource` in `CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE`
// below. The legacy `CALIBRATED_MULTIPLIER_SPREAD` constant is kept as
// the OFFICIAL value (= the original ±20 %), so any code still importing
// it gets the strict spread.

import { SalesSource } from '../entities/enums';

export const CALIBRATED_MULTIPLIER_SPREAD = 0.2;

export const CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE: Record<
  SalesSource,
  number
> = {
  // IR / earnings press release — figure is audited, to the unit, dated.
  [SalesSource.OFFICIAL]: 0.2,
  // Publisher tweet, dev blog post — primary source but often rounded.
  [SalesSource.ANNOUNCEMENT]: 0.3,
  // Journalist reporting — secondhand, sometimes their own estimate.
  [SalesSource.MEDIA]: 0.45,
  // Compilation page citing multiple sources — quality varies wildly.
  [SalesSource.WIKIPEDIA]: 0.45,
};

// ─── Achievement-based estimation (Exophase coverage) ───────────────────────
//
// Used by EstimationService to turn an Exophase `most-common achievement`
// player count into a real per-platform owner count. The signal we feed in
// is:
//   signal = exophase.playersTracked × exophase.mostCommonPercent / 100
//          = absolute number of Exophase users who actually launched the
//            game on this platform.
//
// To extrapolate to all platform owners, we multiply by an "Exophase
// coverage" factor: 1 / (fraction of platform owners that show up on
// Exophase). The fraction itself is small (single-digit %), highly
// dependent on the platform's achievement-tracker culture, and biased by
// the fact that Exophase's user base is composed of achievement hunters
// (so they unlock far more achievements than the average owner).
//
// Both effects are folded into a single per-platform multiplier range
// below. These are deliberately wide because they are rough defaults: the
// numbers will be replaced by per-game calibration once publisher IR
// figures land (see BACKLOG.md, "Publisher IR / Earnings parsers"). When
// that happens, follow the same pattern as `calibratedMultiplier` on
// `Game` and use `CALIBRATED_MULTIPLIER_SPREAD` to tighten the range.
//
// The Steam (PC) range is informed by the bias measurement we get for
// free from the Steam official achievement API (~1.15-1.30× on the few
// titles tested). Console ranges are broader because no equivalent
// ground-truth API exists yet.
//
// Used by `EstimationService.estimateFromAchievementsForPlatform`.

export const EXOPHASE_COVERAGE_PC_LOW = 12;
export const EXOPHASE_COVERAGE_PC_HIGH = 30;

export const EXOPHASE_COVERAGE_PS_LOW = 10;
export const EXOPHASE_COVERAGE_PS_HIGH = 28;

export const EXOPHASE_COVERAGE_XBOX_LOW = 8;
export const EXOPHASE_COVERAGE_XBOX_HIGH = 22;

// Hard plausibility band: an Exophase-based estimate outside this range
// (units) is treated as broken (the game probably has too small a sample
// or a parsing glitch) and the row is skipped rather than persisted with
// nonsense numbers.
export const ACHIEVEMENT_ESTIMATE_MIN_UNITS = 1_000;
export const ACHIEVEMENT_ESTIMATE_MAX_UNITS = 500_000_000;

// Minimum sample size below which an Exophase snapshot is too noisy to
// drive an estimate. Mirrors the MIN_PLAYERS_TRACKED guard inside the
// scraper but is enforced again at estimation time in case stale data
// pre-dating the guard slipped into the table.
export const ACHIEVEMENT_MIN_PLAYERS_TRACKED = 500;

// ─── Estimation discrepancy detector ────────────────────────────────────────
//
// When a new SalesRecord arrives, we compare its `units` against the
// midpoint of our most recent estimate that pre-dates the record. If the
// ratio `declaredUnits / midPriorEstimate` falls outside the band below,
// we persist an `EstimationDiscrepancy` row so the miss is surfaced in
// /admin/issues even after the model recalibrates.
//
// 2.0 / 0.5 = "the model was off by 2× in either direction" — clear
// signal without flooding on every minor wobble. Tighten to catch more,
// loosen to focus on the worst cases.
//
// Used by `GamesService.evaluateDiscrepanciesForGame`.

export const DISCREPANCY_RATIO_HIGH = 2.0;
export const DISCREPANCY_RATIO_LOW = 0.5;

// ─── PC dominance guardrail ─────────────────────────────────────────────────
//
// Used by `reconcile` to protect against the Steam-only blind spot: many
// AAA titles are sold overwhelmingly on console (e.g. PS-exclusives, Switch
// first-party), and a Boxleiter PC estimate then misrepresents the game's
// commercial scale. When we have evidence of strong console sales (a
// declared console or GLOBAL figure), we compare it to the Boxleiter PC
// estimate: if PC accounts for less than this share of the combined total,
// the PC estimate is treated as low-confidence and its contribution to
// `estimatedToday` is plafonnée à la valeur déclarée console (no inflated
// extrapolation from a non-representative platform).
//
// 0.2 = PC must represent at least 20% of the cross-checked total to keep
// its confidence intact. Below 20%, PC is "marginal" and is downgraded.

export const PC_DOMINANCE_RATIO_THRESHOLD = 0.2;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Cumulative % of lifetime sales reached at a given age in days from release.
 * Piecewise-linear interpolation over `LIFETIME_SALES_CURVE`. Pre-release
 * (negative age) returns 0; past the last anchor returns 1.0 (post-Y5 growth
 * is negligible enough to treat as flat).
 */
export function lifetimeSalesPct(ageDays: number): number {
  if (ageDays <= 0) return 0;
  const last = LIFETIME_SALES_CURVE[LIFETIME_SALES_CURVE.length - 1];
  if (ageDays >= last[0]) return last[1];
  for (let i = 1; i < LIFETIME_SALES_CURVE.length; i++) {
    const [x1, y1] = LIFETIME_SALES_CURVE[i];
    if (ageDays <= x1) {
      const [x0, y0] = LIFETIME_SALES_CURVE[i - 1];
      const t = (ageDays - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 1.0;
}

export function ageInDays(from: Date, to: Date = new Date()): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

export function ageInYears(from: Date, to: Date = new Date()): number {
  return (to.getTime() - from.getTime()) / YEAR_MS;
}

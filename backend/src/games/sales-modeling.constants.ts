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
export const PC_BOXLEITER_DEFAULT_HIGH = 65;
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
// A largely independent second signal for PC sales. The all-time peak
// concurrent player count is polled daily from Steam's
// `GetNumberOfCurrentPlayers` and persisted as
// `SignalSnapshot(STEAM_PEAK_CCU)`. It feeds the PC first-week lifecycle
// estimate (`estimateFirstWeekExtrapolationForPc`), which derives a week-1
// baseline from the launch-window peak and projects it forward. It is no
// longer intersected with the reviews-based Boxleiter range.
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
// PLAUSIBLE_MIN/MAX are reserved for a future per-game calibrated CCU
// multiplier (mirroring the Boxleiter recalibration flow); they are not
// yet read by EstimationService.

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
// A single uniform spread is applied regardless of the milestone's source:
// the source no longer drives the model's confidence, only the latest
// dated milestone wins per platform. Picked at the middle of the previous
// per-source spread band (±30 %) as a conservative default.

export const CALIBRATED_MULTIPLIER_SPREAD = 0.3;

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
// When a new Milestone arrives, we compare its `units` against the
// midpoint of our most recent estimate that pre-dates the milestone. If
// the ratio `declaredUnits / midPriorEstimate` falls outside the band
// below, we persist an `EstimationDiscrepancy` row so the miss is
// surfaced in /admin/issues even after the model recalibrates.
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

// ─── First-week extrapolation (LIFECYCLE method, PC) ────────────────────────
//
// Independent estimation pathway that bypasses the Boxleiter "signal-to-
// lifetime-units" relationship entirely. Instead, it:
//   1. Estimates **week-1 units** from the all-time Steam peak CCU (and
//      reviews captured close to release when available);
//   2. Multiplies by an empirical year-1/week-1 ratio bucketed on week-1
//      size — empirically observed median of 2.68× for big releases
//      (> 100k week-1) and 3.77× for smaller titles (long-tail effect);
//   3. Projects from week-1 to "today" via a degressive piecewise curve
//      that lands exactly on the bucket multiplier at day 365.
//
// Why a separate method:
//   - It does not require a calibrated multiplier — it produces a
//     useful estimate the day we capture the all-time peak.
//   - The growth shape is degressive (most sales in the first month,
//     long tail flat-ish), which the existing `LIFETIME_SALES_CURVE`
//     overweights — the user's empirical ratios are smaller than what
//     the existing curve implies (`year-1/week-1 ≈ 4.46× from the
//     0.58/0.13 anchors`).
//   - It will be the foundation for the upcoming "PC peak CCU →
//     console units" cross-extrapolation.
//
// Used by `EstimationService.estimateFirstWeekExtrapolationForPc`.

// Peak CCU → first-week sales range. Anchors:
//   Cyberpunk     1.0M peak → ~5-8M week-1   (~5-8×)
//   Helldivers 2  458K peak → ~2-4M week-1   (~4-9×)
//   Elden Ring    953K peak → ~3-5M week-1   (~3-5×)
//   Palworld      2.1M peak → ~5-8M week-1   (~2.5-4×)
// Range stays wide because peak/week-1 varies with how multiplayer-
// driven the game is (single-player shifts vs simultaneous play).
export const FIRST_WEEK_PEAK_CCU_LOW = 3;
export const FIRST_WEEK_PEAK_CCU_HIGH = 7;

// Only peak-CCU snapshots captured within this many days *after* the
// release date count as the launch peak feeding the first-week
// extrapolation. A peak reached later in the game's life (sale, DLC,
// going free-to-play) is not representative of the launch and must not
// drive the baseline. Widened to two weeks so slow-burn / streamer-buzz
// titles whose CCU keeps climbing past day 7 are captured at their real
// launch peak (the method name/tag is unchanged).
export const FIRST_WEEK_PEAK_CCU_WINDOW_DAYS = 14;

// Reviews captured within ± this many days of release-date + 7 are
// treated as a "week-1 review snapshot" and combined with the peak-CCU
// estimate. Wider window than refresh cadence so we can still match a
// snapshot taken a few days off launch week.
export const FIRST_WEEK_REVIEWS_WINDOW_DAYS = 10;

// Reviews-at-T+7 → first-week sales range. Reviewers are heavier
// buyers, so the per-review unit count at launch is higher than the
// mature Boxleiter ratio (25-70×). Anchors are tentative — refine once
// we have more week-1 review snapshots tracked.
export const FIRST_WEEK_REVIEWS_LOW = 20;
export const FIRST_WEEK_REVIEWS_HIGH = 80;

// Above this week-1 sales mid-point (units), a game is "large launch"
// and follows the more front-loaded year-1 ratio (2.68×). Below it,
// "small launch" with the longer tail (3.77×).
export const FIRST_WEEK_BUCKET_THRESHOLD = 100_000;
export const FIRST_WEEK_BUCKET_LARGE_YEAR1_RATIO = 2.68;
export const FIRST_WEEK_BUCKET_SMALL_YEAR1_RATIO = 3.77;

// Degressive curves mapping age-in-days to a multiplier of week-1
// sales. Both land on their bucket's year-1 ratio at day 365 and
// extend through Y5 with a slow tail. Tuned so:
//   - Most additional sales happen between day 7 and day 90.
//   - Past year-1 the slope flattens (mature catalog regime).
//
// Source: derived from the user's empirical median (2.68 / 3.77 at
// year-1) plus a generic degressive shape calibrated to industry
// long-tail data. Tunable as we collect more dated declared figures.
export const FIRST_WEEK_PROJECTION_CURVE_LARGE: ReadonlyArray<
  readonly [number, number]
> = [
  [7, 1.0],
  [30, 1.7],
  [90, 2.1],
  [180, 2.45],
  [365, 2.68],
  [730, 3.0],
  [1825, 3.4],
];

export const FIRST_WEEK_PROJECTION_CURVE_SMALL: ReadonlyArray<
  readonly [number, number]
> = [
  [7, 1.0],
  [30, 2.2],
  [90, 2.85],
  [180, 3.3],
  [365, 3.77],
  [730, 4.5],
  [1825, 5.5],
];

// Hard plausibility band for the first-week extrapolation. An estimate
// outside this range (units) is treated as broken (peak CCU outlier,
// wrong release date, etc.) and the method abstains rather than
// emitting a nonsense row.
export const FIRST_WEEK_ESTIMATE_MIN_UNITS = 5_000;
export const FIRST_WEEK_ESTIMATE_MAX_UNITS = 200_000_000;

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

/**
 * Piecewise-linear interpolation over a monotonic (x, y) curve. Inputs
 * below the first anchor clamp to its `y`; inputs above the last anchor
 * clamp to the last `y` (matches `lifetimeSalesPct` semantics).
 */
function interpolateCurve(
  curve: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  if (curve.length === 0) return 0;
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * Multiplier of week-1 sales reached at a given age in days, picked
 * from the small- or large-launch curve based on `weekOneMid`. Below
 * day 7 it returns < 1 (sales still accruing) by linearly ramping from
 * 0 at day 0 to 1 at day 7.
 */
export function firstWeekProjectionMultiplier(
  weekOneMid: number,
  ageDays: number,
): number {
  if (ageDays <= 0) return 0;
  if (ageDays < 7) return ageDays / 7;
  const curve =
    weekOneMid > FIRST_WEEK_BUCKET_THRESHOLD
      ? FIRST_WEEK_PROJECTION_CURVE_LARGE
      : FIRST_WEEK_PROJECTION_CURVE_SMALL;
  return interpolateCurve(curve, ageDays);
}

// ─── Genre-aware first-week projection ──────────────────────────────────────
//
// When a game's IGDB genres resolve to a `GenreProfile`, we replace
// the size-bucketed projection curve with a dynamic one built around
// the profile's own `firstWeekToYearOneMultiplier` (m1) and tail
// factor pair `(tailY2, tailY5)` (derived from `year2Retention`):
//
//   day 7   → 1.0   (week-1 baseline)
//   day 30  → 1 + 0.425 × (m1 − 1)
//   day 90  → 1 + 0.661 × (m1 − 1)
//   day 180 → 1 + 0.847 × (m1 − 1)
//   day 365 → m1
//   day 730 → m1 × tailY2
//   day 1825→ m1 × tailY5
//
// The intra-year fractions (0.425, 0.661, 0.847) are the average of
// the LARGE and SMALL bucket curves' intra-year shape — they encode
// "how front-loaded is year 1" independently of how big year 1 is.
// Empirically the two bucket shapes are very close, so a single
// blended shape costs little fidelity and avoids a third tunable.
//
// Used by `EstimationService.estimateFirstWeekExtrapolationForPc`
// when `GenresService.resolveProfileForGame` returns a profile.

const GENRE_INTRA_YEAR_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [30, 0.425],
  [90, 0.661],
  [180, 0.847],
];

/**
 * Build the per-game first-week projection curve from a resolved
 * genre profile. The curve hits exactly `m1` at day 365 and
 * `m1 × tailY{2,5}` at the corresponding milestones.
 */
export function buildGenreProjectionCurve(
  m1: number,
  tailY2: number,
  tailY5: number,
): ReadonlyArray<readonly [number, number]> {
  const delta = m1 - 1;
  return [
    [7, 1.0],
    ...GENRE_INTRA_YEAR_SHAPE.map(
      ([day, frac]) => [day, 1 + frac * delta] as const,
    ),
    [365, m1],
    [730, m1 * tailY2],
    [1825, m1 * tailY5],
  ];
}

/**
 * Like `firstWeekProjectionMultiplier` but driven by a genre-derived
 * curve rather than a size bucket. Below day 7 we still linear-ramp
 * from 0 to 1 to keep the very-fresh-release behaviour consistent.
 */
export function genreProjectionMultiplier(
  m1: number,
  tailY2: number,
  tailY5: number,
  ageDays: number,
): number {
  if (ageDays <= 0) return 0;
  if (ageDays < 7) return ageDays / 7;
  return interpolateCurve(buildGenreProjectionCurve(m1, tailY2, tailY5), ageDays);
}
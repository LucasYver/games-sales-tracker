import { playModeFromCategories } from '../../reference-profiles/matcher.service';

/**
 * Feature vector of the ML estimate, computed for one game at one date.
 *
 * Mirror of `FeatureBuilder.row` in `ml/features.py`: the model was trained
 * on those exact values, so every rule below (log1p, defaults, windows,
 * interactions) must stay byte-for-byte the same as the Python side. Pure —
 * the DB lookups live in `MlEstimateService`.
 */

const MS_PER_DAY = 86_400_000;
const LAUNCH_WINDOW_MONTHS = 2;
const EARLY_REVIEWS_DAYS = [30, 90] as const;
const REVIEW_GROWTH_DAYS = 90;
const PC_LATER_DAYS = 30;

// Neutral values when the matcher has no neighbours (same as ml/features.py).
const DEFAULT_REVIEWS_TO_UNITS = 45;
const DEFAULT_M1 = 2.5;
const DEFAULT_PC_SHARE = 0.5;

export interface MlSignals {
  /** Latest real STEAM_REVIEWS at the date, with its capture time. */
  reviews: { value: number; capturedAt: Date } | null;
  /** Latest real STEAM_REVIEWS at min(date, PC release + 30 / 90 days). */
  reviews30d: number | null;
  reviews90d: number | null;
  /** Latest real STEAM_REVIEWS 90 days before the date. */
  reviews90dAgo: number | null;
  psRatings: number | null;
  xboxRatings: number | null;
  /** Latest real STEAM_CONCURRENT at the date. */
  ccuNow: number | null;
  /** Highest STEAM_CONCURRENT up to the date (reconstructed rows included). */
  peakCcu: number | null;
  /** Highest STEAM_CONCURRENT in the launch window (see `mlSignalWindows`). */
  launchPeakCcu: number | null;
  followers: number | null;
}

/** What the matcher learned from the game's neighbours, the game itself held out. */
export interface MlNeighbours {
  pcBoxleiterLow: number | null;
  pcBoxleiterHigh: number | null;
  firstWeekToYearOneMultiplier: number;
  pcShare: number;
}

export interface MlFeatureInput {
  asOf: Date;
  /** Earliest release across platforms (`Game.releaseDate`). */
  releaseDate: Date | null;
  /** PC release, falling back to `releaseDate` (`platformReleaseDate`). */
  pcReleaseDate: Date | null;
  platforms: string[];
  categories: string[] | null;
  steamTags: string[] | null;
  dlcCount: number | null;
  franchiseSlug: string | null;
  liveService: boolean;
  isAnnualIteration: boolean;
  signals: MlSignals;
  /** `null` when the matcher found no neighbour. */
  neighbours: MlNeighbours | null;
}

/** Dates the signal lookups need (null = lookup skipped). */
export interface MlSignalWindows {
  reviews30dAt: Date | null;
  reviews90dAt: Date | null;
  reviews90dAgoAt: Date;
  launchStart: Date | null;
  launchEnd: Date | null;
}

/**
 * No ML estimate before this many days after the PC release: the first days'
 * signals are too partial to mean anything (the site keeps its platform sum).
 */
export const ML_MIN_DAYS_AFTER_RELEASE = 3;

// « Never down » grid, same as `NEVER_DOWN_DAYS` in ml/frozen.py: J+3 … J+365,
// then every 180 days from J+540.
const NEVER_DOWN_DAYS = [3, 7, 14, 30, 60, 90, 180, 270, 365];

export function mlTooEarly(pcReleaseDate: Date | null, at: Date): boolean {
  return (
    pcReleaseDate === null ||
    at.getTime() - pcReleaseDate.getTime() <
      ML_MIN_DAYS_AFTER_RELEASE * MS_PER_DAY
  );
}

/** Past dates whose estimate the one at `at` may not go below. */
export function neverDownDates(pcReleaseDate: Date, at: Date): Date[] {
  const release = pcReleaseDate.getTime();
  const span = Math.floor((at.getTime() - release) / MS_PER_DAY);
  const days = [...NEVER_DOWN_DAYS];
  for (let d = 540; d <= span; d += 180) days.push(d);
  return days
    .map((d) => release + d * MS_PER_DAY)
    .filter((t) => t <= at.getTime())
    .map((t) => new Date(t));
}

export function mlSignalWindows(
  asOf: Date,
  pcReleaseDate: Date | null,
): MlSignalWindows {
  const t = asOf.getTime();
  const release = pcReleaseDate?.getTime() ?? null;
  const [early, late] = EARLY_REVIEWS_DAYS.map((days) =>
    release !== null
      ? new Date(Math.min(t, release + days * MS_PER_DAY))
      : null,
  );
  let launchStart: Date | null = null;
  let launchEnd: Date | null = null;
  if (pcReleaseDate) {
    const y = pcReleaseDate.getUTCFullYear();
    const m = pcReleaseDate.getUTCMonth();
    const start = Date.UTC(y, m, 1);
    const end = Math.min(t, Date.UTC(y, m + LAUNCH_WINDOW_MONTHS, 1));
    if (end > start) {
      launchStart = new Date(start);
      launchEnd = new Date(end);
    }
  }
  return {
    reviews30dAt: early,
    reviews90dAt: late,
    reviews90dAgoAt: new Date(t - REVIEW_GROWTH_DAYS * MS_PER_DAY),
    launchStart,
    launchEnd,
  };
}

/** Python `_log1p`: 0 for a missing or non-positive value. */
function log1p(v: number | null | undefined): number {
  return v != null && v > 0 ? Math.log1p(v) : 0;
}

const flag = (b: boolean): number => (b ? 1 : 0);

/** Python `tag_col`: the column name a Steam tag maps to. */
export function tagColumn(tag: string): string {
  return `tag_${tag.replace(/ /g, '_').replace(/-/g, '_')}`;
}

/** The game's 10 most-voted Steam tags, trimmed and lower-cased. */
function gameTagColumns(steamTags: string[] | null): Set<string> {
  const tags = (steamTags ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10);
  return new Set(tags.map((t) => tagColumn(t.toLowerCase())));
}

export function buildMlFeatures(
  input: MlFeatureInput,
  tagColumns: readonly string[],
): Record<string, number> {
  const s = input.signals;
  const t = input.asOf.getTime();
  const release = input.pcReleaseDate?.getTime() ?? null;
  const firstRelease = input.releaseDate?.getTime() ?? null;
  const reportYear = input.asOf.getUTCFullYear();
  const ageDays =
    release !== null ? Math.max((t - release) / MS_PER_DAY, 0) : 0;
  const pcDelay =
    release !== null && firstRelease !== null
      ? Math.max((release - firstRelease) / MS_PER_DAY, 0)
      : 0;
  const platforms = new Set(input.platforms);
  const mode = playModeFromCategories(input.categories);
  const n = input.neighbours;

  const f: Record<string, number> = {
    // signals at the date
    log_reviews: log1p(s.reviews?.value),
    has_reviews: flag(s.reviews !== null),
    log_reviews_stale_days: s.reviews
      ? log1p((t - s.reviews.capturedAt.getTime()) / MS_PER_DAY)
      : 0,
    log_launch_ccu: log1p(s.launchPeakCcu),
    has_launch_ccu: flag(!!s.launchPeakCcu),
    log_peak_ccu: log1p(s.peakCcu),
    log_ccu_now: log1p(s.ccuNow),
    log_ps_ratings: log1p(s.psRatings),
    has_ps_ratings: flag(s.psRatings !== null),
    log_xbox_ratings: log1p(s.xboxRatings),
    has_xbox_ratings: flag(s.xboxRatings !== null),
    // time
    log_age_days: Math.log1p(ageDays),
    release_year:
      input.pcReleaseDate !== null
        ? input.pcReleaseDate.getUTCFullYear()
        : reportYear,
    report_year: reportYear,
    // the game
    on_ps: flag(platforms.has('PLAYSTATION')),
    on_xbox: flag(platforms.has('XBOX')),
    multiplayer: flag(['MULTI', 'MIXED', 'COOP', 'MMO'].includes(mode)),
    mmo: flag(mode === 'MMO'),
    franchise: flag(input.franchiseSlug !== null),
    live_service: flag(input.liveService),
    annual_iteration: flag(input.isAnnualIteration),
    log_dlc: log1p(input.dlcCount),
    has_dlc_info: flag(input.dlcCount !== null),
    // neighbours (the game itself held out, as in training)
    log_matcher_reviews_to_units:
      n && n.pcBoxleiterLow
        ? Math.log((n.pcBoxleiterLow + (n.pcBoxleiterHigh ?? 0)) / 2)
        : Math.log(DEFAULT_REVIEWS_TO_UNITS),
    log_matcher_m1: Math.log(n ? n.firstWeekToYearOneMultiplier : DEFAULT_M1),
    matcher_pc_share: n ? n.pcShare : DEFAULT_PC_SHARE,
    // review velocity
    log_reviews_30d: log1p(s.reviews30d),
    log_reviews_90d: log1p(s.reviews90d),
    has_early_reviews: flag(s.reviews30d !== null),
    log_reviews_growth_90d:
      s.reviews && s.reviews90dAgo !== null
        ? log1p(s.reviews.value - s.reviews90dAgo)
        : 0,
    has_reviews_growth: flag(s.reviews !== null && s.reviews90dAgo !== null),
    // Steam followers
    log_followers: log1p(s.followers),
    has_followers: flag(s.followers !== null),
    // delayed PC release
    log_pc_delay_days: Math.log1p(pcDelay),
    pc_later: flag(pcDelay > PC_LATER_DAYS),
  };

  const gameTags = gameTagColumns(input.steamTags);
  for (const column of tagColumns) f[column] = flag(gameTags.has(column));

  f.reviews_x_release = f.log_reviews * (f.release_year - 2018);
  f.reviews_x_report = f.log_reviews * (f.report_year - 2022);
  f.launch_x_age = f.log_launch_ccu * f.log_age_days;
  f.reviews_x_age = f.log_reviews * f.log_age_days;
  f.reviews_x_onps = f.log_reviews * f.on_ps;
  return f;
}

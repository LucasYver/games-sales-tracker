import {
  ESTIMATE_PENDING_DAYS,
  daysUntilRelease,
  headlineUnits,
  isUpcoming,
  roundUnits,
  steamCcuIsMeaningful,
  type GameDetail,
  type Platform,
  type PopularGame,
  type RelatedGames,
  type ReviewPoint,
} from './api';

/**
 * Two-game comparison (/compare/a/b). Everything here is plain data built on
 * the server from the two cached game details, so the page adds no backend
 * route and the client gets a few hundred points instead of two full pages.
 */

/** Average month, so "months since launch" lines up across games. */
const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

/** [month, value]: months since launch, or a calendar month index. */
export type MonthPoint = [number, number];

export interface CompareSeries {
  /** Months since launch (launch month = 0) → highest value seen that month. */
  aligned: MonthPoint[];
  /** Calendar month (UTC year × 12 + month) → highest value seen that month. */
  calendar: MonthPoint[];
}

/** Metrics the chart offers. Xbox ratings are only in the table: too short a history. */
export const CHART_METRICS = [
  'reviews',
  'ccu',
  'followers',
  'psRatings',
] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];
export type SeriesKey = ChartMetric | 'xboxRatings';

export type SalesState = 'estimate' | 'free' | 'upcoming' | 'pending' | 'none';

export interface CompareGame {
  slug: string;
  name: string;
  coverUrl: string | null;
  developer: string | null;
  publisher: string | null;
  releaseDate: string | null;
  platforms: Platform[];
  salesState: SalesState;
  sales: { units: number; low: number; high: number; asOf: string | null } | null;
  /** Whole months since launch; null before launch. */
  ageMonths: number | null;
  /** Calendar month index of the launch; null before launch. */
  releaseMonth: number | null;
  steamReviews: number | null;
  peakCcu: { value: number; at: string } | null;
  recentCcu: { value: number; at: string } | null;
  followers: number | null;
  playtimeMinutes: number | null;
  playstation: { count: number; score: number | null } | null;
  xbox: { count: number; score: number | null } | null;
  price: { final: number; currency: string } | null;
  isFree: boolean;
  series: Record<SeriesKey, CompareSeries>;
}

/** A game offered in the picker (suggestion or search hit). */
export type PickerGame = Pick<
  PopularGame,
  'slug' | 'name' | 'coverUrl' | 'releaseDate' | 'isFree' | 'estimatedUnits'
> & { reason?: 'franchise' | 'studio' };

/** Picker suggestions: same franchise first, then same studio, minus `exclude`. */
export function pickerSuggestions(
  related: RelatedGames,
  exclude: string[],
  limit = 5,
): PickerGame[] {
  const seen = new Set(exclude);
  const out: PickerGame[] = [];
  const lists = [
    [related.franchise, 'franchise'],
    [related.studio, 'studio'],
  ] as const;
  for (const [games, reason] of lists) {
    for (const g of games) {
      if (seen.has(g.slug) || out.length >= limit) continue;
      seen.add(g.slug);
      out.push({
        slug: g.slug,
        name: g.name,
        coverUrl: g.coverUrl,
        releaseDate: g.releaseDate,
        isFree: g.isFree,
        estimatedUnits: g.estimatedUnits,
        reason,
      });
    }
  }
  return out;
}

/** One URL per pair: slugs in alphabetical order. */
export function comparePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function compareHref(a: string, b: string): string {
  const [first, second] = comparePair(a, b);
  return `/compare/${first}/${second}`;
}

export function calendarMonth(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** First day of a calendar month index, for date formatting. */
export function monthDate(index: number): Date {
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
}

/** Last value at or before month `m`, or null if the series starts later. */
export function valueAt(points: MonthPoint[], m: number): number | null {
  let value: number | null = null;
  for (const [month, v] of points) {
    if (month > m) break;
    value = v;
  }
  return value;
}

/** Highest value up to month `m`. */
export function maxUpTo(points: MonthPoint[], m: number): number | null {
  let value: number | null = null;
  for (const [month, v] of points) {
    if (month > m) break;
    if (value == null || v > value) value = v;
  }
  return value;
}

function monthly(points: ReviewPoint[], releaseMs: number | null): CompareSeries {
  const aligned = new Map<number, number>();
  const calendar = new Map<number, number>();
  for (const p of points) {
    const t = Date.parse(p.capturedAt);
    if (!Number.isFinite(t) || !(p.value > 0)) continue;
    const c = calendarMonth(t);
    calendar.set(c, Math.max(calendar.get(c) ?? 0, p.value));
    if (releaseMs != null) {
      // Points from before launch (followers, store ratings) fold into the
      // launch month: the figure the game started with.
      const m = Math.max(0, Math.floor((t - releaseMs) / MONTH_MS));
      aligned.set(m, Math.max(aligned.get(m) ?? 0, p.value));
    }
  }
  const sorted = (map: Map<number, number>): MonthPoint[] =>
    [...map.entries()].sort((x, y) => x[0] - y[0]);
  return { aligned: sorted(aligned), calendar: sorted(calendar) };
}

const NO_SERIES: CompareSeries = { aligned: [], calendar: [] };

function salesState(game: GameDetail, units: number | null, now: number): SalesState {
  if (game.isFree) return 'free';
  if (units) return 'estimate';
  if (isUpcoming(game.releaseDate, now)) return 'upcoming';
  const days = game.releaseDate ? daysUntilRelease(game.releaseDate, now) : null;
  if (
    !game.estimateOutOfScope &&
    !game.estimateUnavailable &&
    days != null &&
    -days <= ESTIMATE_PENDING_DAYS
  ) {
    return 'pending';
  }
  return 'none';
}

export function toCompareGame(game: GameDetail, now: number): CompareGame {
  const upcoming = isUpcoming(game.releaseDate, now);
  const releaseMs =
    game.releaseDate && !upcoming ? Date.parse(game.releaseDate) : null;
  const units = game.isFree ? null : headlineUnits(game);
  const ccuShown = steamCcuIsMeaningful(game);
  const lastCcu = game.ccuHistory.at(-1);
  const onPlatform = new Set(game.platforms);
  const store = (
    rating: { reviews: number; score: number | null } | null,
    platform: Platform,
  ) =>
    onPlatform.has(platform) && rating && rating.reviews > 0
      ? { count: rating.reviews, score: rating.score }
      : null;

  return {
    slug: game.slug,
    name: game.name,
    coverUrl: game.coverUrl,
    developer: game.developer,
    publisher: game.publisher,
    releaseDate: game.releaseDate,
    platforms: game.platforms,
    salesState: salesState(game, units, now),
    sales:
      units && game.headline
        ? {
            units,
            low: roundUnits(game.headline.low) ?? game.headline.low,
            high: roundUnits(game.headline.high) ?? game.headline.high,
            asOf: game.estimateSnapshots.at(-1)?.computedAt ?? null,
          }
        : null,
    ageMonths:
      releaseMs != null ? Math.floor((now - releaseMs) / MONTH_MS) : null,
    releaseMonth: releaseMs != null ? calendarMonth(releaseMs) : null,
    steamReviews:
      game.storeRatings.steam?.reviews ?? game.reviewHistory.at(-1)?.value ?? null,
    peakCcu:
      ccuShown && game.peakCcu
        ? { value: game.peakCcu.value, at: game.peakCcu.capturedAt }
        : null,
    recentCcu:
      ccuShown && lastCcu ? { value: lastCcu.value, at: lastCcu.capturedAt } : null,
    followers: game.followersHistory.at(-1)?.value ?? null,
    playtimeMinutes: game.storeRatings.steam?.reviewerMedianPlaytimeMinutes ?? null,
    playstation: store(game.storeRatings.playstation, 'PLAYSTATION'),
    xbox: store(game.storeRatings.xbox, 'XBOX'),
    price:
      !game.isFree && game.currentPrice
        ? { final: game.currentPrice.final, currency: game.currentPrice.currency }
        : null,
    isFree: game.isFree,
    series: {
      reviews: monthly(game.reviewHistory, releaseMs),
      ccu: ccuShown ? monthly(game.ccuHistory, releaseMs) : NO_SERIES,
      followers: monthly(game.followersHistory, releaseMs),
      psRatings: onPlatform.has('PLAYSTATION')
        ? monthly(game.psRatingsHistory, releaseMs)
        : NO_SERIES,
      xboxRatings: onPlatform.has('XBOX')
        ? monthly(game.xboxRatingsHistory, releaseMs)
        : NO_SERIES,
    },
  };
}

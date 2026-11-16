import {
  listingUnits,
  type PopularGame,
  type HubTimeline,
  type TimelineStoreSeries,
} from './api';

/**
 * "Studio over time" section of a studio page. Plain functions over the hub's
 * games and their store histories (`/games/studios/:slug/timeline`): one
 * point per month for Steam reviews, one per week for PlayStation and Xbox
 * ratings, which have only been tracked since 2026 for most games.
 */

export const STORES = ['steam', 'ps', 'xbox'] as const;
export type Store = (typeof STORES)[number];

/** Games drawn on their own; the rest of the studio is one "other games" band. */
export const TOP_GAMES = 8;

/** Mid-tone colours that read on the light and the dark palette. */
export const GAME_COLORS = [
  '#d9a441',
  '#5b8fd9',
  '#e0603f',
  '#4fb3b8',
  '#9a86e0',
  '#d4709a',
  '#6fbf73',
  '#8592a3',
];
export const OTHERS_COLOR = 'var(--chart-3)';
export const STORE_COLORS: Record<Store, string> = {
  steam: 'var(--chart-2)',
  ps: 'var(--source-media)',
  xbox: 'var(--source-official)',
};

const WEEK_MS = 7 * 24 * 3600 * 1000;
const YEAR_MS = 365 * 24 * 3600 * 1000;
/** Above this 30-day growth, an old game's count jumped because of a store re-match. */
const MAX_MONTHLY_GROWTH = 0.25;

export function weekDate(index: number): Date {
  return new Date(index * WEEK_MS);
}

export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function weekIndex(date: Date): number {
  return Math.floor(date.getTime() / WEEK_MS);
}

/** A series with every bucket between its first and last point, gaps interpolated. */
export interface Dense {
  start: number;
  values: number[];
}

export function densify(points: [number, number][]): Dense | null {
  if (points.length === 0) return null;
  const start = points[0][0];
  const values: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, v] = points[i];
    if (i > 0) {
      const [px, pv] = points[i - 1];
      for (let k = px + 1; k < x; k++) {
        values.push(Math.round(pv + ((v - pv) * (k - px)) / (x - px)));
      }
    }
    values.push(v);
  }
  return { start, values };
}

/** Value for a stack: 0 before the series, its last value after it. */
export function stackValue(d: Dense | null, x: number): number {
  if (!d || x < d.start) return 0;
  return d.values[Math.min(x - d.start, d.values.length - 1)];
}

/** Value for a line: only where the series has data. */
export function lineValue(d: Dense | null, x: number): number | null {
  if (!d || x < d.start || x - d.start >= d.values.length) return null;
  return d.values[x - d.start];
}

/**
 * New reviews or ratings in a bucket. A store's first bucket counts only for
 * Steam, whose history starts at launch; a console series starts when
 * tracking did, so its first count is not a gain.
 */
export function gainValue(d: Dense | null, x: number, store: Store): number {
  if (!d) return 0;
  const i = x - d.start;
  if (i < 0 || i >= d.values.length) return 0;
  if (i === 0) return store === 'steam' ? d.values[0] : 0;
  return Math.max(0, d.values[i] - d.values[i - 1]);
}

export interface TimelineGame {
  slug: string;
  name: string;
  releaseDate: string | null;
  /** Month index of the release, null if unknown. */
  releaseMonth: number | null;
  units: number | null;
  /** Today's count per store, 0 when the game has no figure there. */
  counts: Record<Store, number>;
  total: number;
  /** New reviews or ratings over the last 30 days, per store (a drop counts 0). */
  recent: Record<Store, number>;
  series: Record<Store, Dense | null>;
  /** First bucket per store, or null without data. */
  firstBucket: Record<Store, number | null>;
}

export function buildTimelineGames(
  games: PopularGame[],
  timeline: HubTimeline,
): TimelineGame[] {
  const bySlug = new Map(timeline.games.map((g) => [g.slug, g]));
  return games
    .map((game) => {
      const t = bySlug.get(game.slug);
      const of = (s: Store): TimelineStoreSeries | null => t?.[s] ?? null;
      const counts = {} as Record<Store, number>;
      const recent = {} as Record<Store, number>;
      const series = {} as Record<Store, Dense | null>;
      const firstBucket = {} as Record<Store, number | null>;
      for (const s of STORES) {
        const data = of(s);
        counts[s] = data?.latest ?? 0;
        // A drop means the store product was matched again, not lost ratings.
        recent[s] = Math.max(0, data?.gain30 ?? 0);
        series[s] = densify(data?.points ?? []);
        firstBucket[s] = data?.points[0]?.[0] ?? null;
      }
      const release = game.releaseDate ? new Date(game.releaseDate) : null;
      // A game out for a year does not gain a quarter of its count in a
      // month: such a jump is a store product matched again, not new players.
      if (release && Date.now() - release.getTime() > YEAR_MS) {
        for (const s of STORES) {
          const before = counts[s] - recent[s];
          if (before > 0 && recent[s] > before * MAX_MONTHLY_GROWTH) recent[s] = 0;
        }
      }
      return {
        slug: game.slug,
        name: game.name,
        releaseDate: game.releaseDate,
        releaseMonth: release ? monthIndex(release) : null,
        units: listingUnits(game),
        counts,
        total: counts.steam + counts.ps + counts.xbox,
        recent,
        series,
        firstBucket,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export interface StudioTotals {
  counts: Record<Store, number>;
  total: number;
  recent: Record<Store, number>;
  recentTotal: number;
  /** Steam reviews gained over the last 12 months and the count before them. */
  steamYear: { gain: number; before: number };
}

export function studioTotals(games: TimelineGame[]): StudioTotals {
  const counts = { steam: 0, ps: 0, xbox: 0 };
  const recent = { steam: 0, ps: 0, xbox: 0 };
  const nowMonth = monthIndex(new Date());
  let gain = 0;
  let before = 0;
  for (const g of games) {
    for (const s of STORES) {
      counts[s] += g.counts[s];
      recent[s] += g.recent[s];
    }
    if (g.series.steam) {
      const old = stackValue(g.series.steam, nowMonth - 12);
      before += old;
      gain += g.counts.steam - old;
    }
  }
  return {
    counts,
    total: counts.steam + counts.ps + counts.xbox,
    recent,
    recentTotal: recent.steam + recent.ps + recent.xbox,
    steamYear: { gain, before },
  };
}

export function recentTotal(g: TimelineGame): number {
  return g.recent.steam + g.recent.ps + g.recent.xbox;
}

/** Released before 2017: no public estimate (see the estimate-scope-2017 skill). */
export function releasedBefore2017(g: TimelineGame): boolean {
  return g.releaseMonth != null && g.releaseMonth < 2017 * 12;
}

export function timelineHasData(timeline: HubTimeline | null): boolean {
  if (!timeline) return false;
  const withData = timeline.games.filter((g) => g.steam || g.ps || g.xbox);
  return withData.length >= 2;
}

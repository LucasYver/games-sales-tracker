import type { SortOption } from '@/lib/api';

/**
 * The home listing's filters, read from and written to the URL. Shared by
 * the server page (to query the API) and the client filter bar (to edit
 * them), so both read the query string the same way.
 *
 * Lists travel comma-separated (`platform=PLAYSTATION,XBOX`) and match any
 * of their values.
 */
export interface ListingFilters {
  sort: SortOption;
  platforms: string[];
  genres: string[];
  modes: string[];
  yearMin: number | null;
  yearMax: number | null;
  minReviews: number;
  hideFree: boolean;
  exclusive: boolean;
}

export type ListingSearchParams = Partial<
  Record<
    | 'sort'
    | 'platform'
    | 'genre'
    | 'mode'
    | 'yearMin'
    | 'yearMax'
    | 'minReviews'
    | 'hideFree'
    | 'exclusive',
    string
  >
>;

/** Every query key the filter bar owns (reset removes them, plus `page`). */
export const LISTING_FILTER_KEYS = [
  'sort',
  'platform',
  'genre',
  'mode',
  'yearMin',
  'yearMax',
  'minReviews',
  'hideFree',
  'exclusive',
  // Old "new releases" filter, replaced by the "recent" tab.
  'status',
] as const;

export const DEFAULT_SORT: SortOption = 'trending';

/** The tabs above the listing, in order. */
export const LISTING_TABS: SortOption[] = [
  'trending',
  'sales',
  'recent',
  'popular',
];

const SORTS: SortOption[] = [
  'trending',
  'popular',
  'recent',
  'oldest',
  'sales',
];

/** No game in the catalog lists Switch yet, so it is not offered. */
export const LISTING_PLATFORMS = ['PC', 'PLAYSTATION', 'XBOX'] as const;

export const LISTING_MODES = ['SINGLE_PLAYER', 'MULTIPLAYER', 'CO_OP'] as const;

/** Steam review floors behind the "popularity" levels. */
export const POPULARITY_LEVELS = [1000, 10000, 100000] as const;

export const EMPTY_FILTERS: ListingFilters = {
  sort: DEFAULT_SORT,
  platforms: [],
  genres: [],
  modes: [],
  yearMin: null,
  yearMax: null,
  minReviews: 0,
  hideFree: false,
  exclusive: false,
};

function parseList(value: string | undefined, allowed?: readonly string[]) {
  if (!value) return [];
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => !allowed || allowed.includes(v));
  return [...new Set(items)];
}

export function sanitizeYear(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const max = new Date().getFullYear() + 5;
  if (n < 1900 || n > max) return null;
  return Math.trunc(n);
}

export function parseListingFilters(sp: ListingSearchParams): ListingFilters {
  const sort = SORTS.includes(sp.sort as SortOption)
    ? (sp.sort as SortOption)
    : DEFAULT_SORT;
  const platforms = parseList(sp.platform, LISTING_PLATFORMS);
  const minReviewsNum = Number(sp.minReviews);
  return {
    sort,
    platforms,
    genres: parseList(sp.genre),
    modes: parseList(sp.mode, LISTING_MODES),
    yearMin: sanitizeYear(sp.yearMin),
    yearMax: sanitizeYear(sp.yearMax),
    minReviews:
      Number.isFinite(minReviewsNum) && minReviewsNum > 0
        ? Math.trunc(minReviewsNum)
        : 0,
    hideFree: sp.hideFree === '1',
    // Only means something next to a platform.
    exclusive: sp.exclusive === '1' && platforms.length > 0,
  };
}

/** The filters as query values, defaults left out. */
export function listingQuery(f: ListingFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.sort !== DEFAULT_SORT) q.sort = f.sort;
  if (f.platforms.length) q.platform = f.platforms.join(',');
  if (f.genres.length) q.genre = f.genres.join(',');
  if (f.modes.length) q.mode = f.modes.join(',');
  if (f.yearMin != null) q.yearMin = String(f.yearMin);
  if (f.yearMax != null) q.yearMax = String(f.yearMax);
  if (f.minReviews > 0) q.minReviews = String(f.minReviews);
  if (f.hideFree) q.hideFree = '1';
  if (f.exclusive && f.platforms.length) q.exclusive = '1';
  return q;
}

/** Filters that narrow the list (the sort tab is not one). */
export function countActiveFilters(f: ListingFilters): number {
  let n = 0;
  if (f.platforms.length) n++;
  if (f.genres.length) n++;
  if (f.modes.length) n++;
  if (f.yearMin != null || f.yearMax != null) n++;
  if (f.minReviews > 0) n++;
  if (f.hideFree) n++;
  return n;
}

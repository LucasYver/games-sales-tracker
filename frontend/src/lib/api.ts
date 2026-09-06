export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Figures are recomputed once a day, so serving a few minutes old is free
// accuracy-wise and saves a round trip per view. Search stays shortest: it is
// the one place a visitor notices a missing brand-new game.
const LISTING_TTL = 900;
const GAME_TTL = 900;
const GENRES_TTL = 3600;
const SEARCH_TTL = 300;

export type Platform =
  'PC' | 'PLAYSTATION' | 'XBOX' | 'SWITCH' | 'MOBILE' | 'GLOBAL' | 'OTHER';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GameListItem {
  id: string;
  name: string;
  slug: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: Platform[];
}

export type SalesBasis = 'reported' | 'estimate';

/** The single figure the site shows, resolved by the API. */
export interface HeadlineSales {
  low: number;
  high: number;
  basis: SalesBasis;
}

export interface PopularGame extends GameListItem {
  genres: string[];
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
  basis: SalesBasis | null;
}

export interface GenreOption {
  name: string;
  count: number;
}

export type SalesSourceLabel =
  | 'OFFICIAL'
  | 'WIKIPEDIA'
  | 'ANNOUNCEMENT'
  | 'MEDIA'
  | 'STEAM_LEAK'
  | 'ESTIMATE';

export interface TotalSales {
  low: number;
  high: number;
  basis: 'reported' | 'sum';
  sources: SalesSourceLabel[];
  source: SalesSourceLabel | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: string | null;
  confidence: ConfidenceLevel | null;
}

export type Agreement = 'strong' | 'weak' | 'conflict';

export type DisplaySource = SalesSourceLabel | 'ESTIMATE';

export interface PlatformSales {
  platform: Platform;
  low: number;
  high: number;
  source: DisplaySource;
  confidence: ConfidenceLevel | null;
  sourceUrl: string | null;
  agreement: Agreement | null;
}

export interface GameSourceRef {
  id: string;
  source: string;
  externalId: string | null;
  url: string | null;
}

/** A price observation. Amounts are in cents of `currency`. */
export interface PricePoint {
  capturedAt: string;
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
}

/** Our own chart position, computed from weekly review velocity. */
export interface RankInfo {
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  peakPercentile: number;
  weeksTopDecile: number;
  computedAt: string;
}

export interface ReviewPoint {
  capturedAt: string;
  value: number;
}

export interface PublicEstimateSnapshot {
  computedAt: string;
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
}

export interface StoreRatings {
  steam: {
    reviews: number;
    reviewerMedianPlaytimeMinutes: number | null;
  } | null;
  playstation: { reviews: number; score: number | null } | null;
  xbox: { reviews: number; score: number | null } | null;
}

export interface GameDetail {
  id: string;
  name: string;
  slug: string;
  releaseDate: string | null;
  coverUrl: string | null;
  summary: string | null;
  isFree: boolean;
  platforms: Platform[];
  developer: string | null;
  publisher: string | null;
  genres: string[];
  sources: GameSourceRef[];
  salesBreakdown: PlatformSales[];
  totalSales: TotalSales | null;
  headline: HeadlineSales | null;
  estimatedToday: { low: number; high: number } | null;
  estimateSnapshots: PublicEstimateSnapshot[];
  reviewHistory: ReviewPoint[];
  followersHistory: ReviewPoint[];
  psRatingsHistory: ReviewPoint[];
  switchRatingsHistory: ReviewPoint[];
  ccuHistory: ReviewPoint[];
  peakCcu: { value: number; capturedAt: string } | null;
  priceHistory: PricePoint[];
  currentPrice: PricePoint | null;
  lowestPrice: PricePoint | null;
  rank: RankInfo | null;
  storeRatings: StoreRatings;
}

/**
 * One number out of a range. A published figure is shown as-is; a modelled one
 * is the midpoint, rounded so we never imply precision we do not have (nearest
 * 100K above a million, nearest 10K below).
 */
function roundedUnits(
  low: number | null,
  high: number | null,
  basis: SalesBasis | null,
): number | null {
  if (low == null || high == null) return null;
  const mid = (low + high) / 2;
  if (mid <= 0) return null;
  if (basis === 'reported') return Math.round(mid);
  const step = mid >= 1_000_000 ? 100_000 : 10_000;
  return Math.max(step, Math.round(mid / step) * step);
}

/** Listing and search rows. */
export function listingUnits(game: PopularGame): number | null {
  return roundedUnits(game.estimatedLow, game.estimatedHigh, game.basis);
}

/** Game page. Same resolution as the listing — the API decides, not the page. */
export function headlineUnits(game: GameDetail): number | null {
  if (!game.headline) return null;
  return roundedUnits(
    game.headline.low,
    game.headline.high,
    game.headline.basis,
  );
}

export async function searchGames(
  query: string,
  limit = 20,
): Promise<PopularGame[]> {
  const res = await fetch(
    `${API_URL}/games/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { next: { revalidate: SEARCH_TTL } },
  );
  if (!res.ok) return [];
  return res.json();
}

export type SortOption = 'popular' | 'recent' | 'oldest';

export type StatusOption = 'released' | 'new' | 'upcoming';

export interface PaginatedGames {
  items: PopularGame[];
  total: number;
}

export interface RankedGame extends PopularGame {
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  weeksTopDecile: number;
}

export type RankSort = 'top' | 'peak' | 'weeks';

export interface PaginatedRankedGames {
  items: RankedGame[];
  total: number;
}

export async function getRankedGames(params: {
  limit?: number;
  offset?: number;
  sort?: RankSort;
}): Promise<PaginatedRankedGames> {
  const { limit = 50, offset = 0, sort = 'top' } = params;
  const res = await fetch(
    `${API_URL}/games/ranked?limit=${limit}&offset=${offset}&sort=${sort}`,
    { next: { revalidate: LISTING_TTL } },
  );
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

export interface PopularGamesParams {
  limit?: number;
  sort?: SortOption;
  platform?: string;
  offset?: number;
  genre?: string;
  status?: StatusOption;
  yearMin?: number;
  yearMax?: number;
  minReviews?: number;
}

export async function getPopularGames(
  params: PopularGamesParams = {},
): Promise<PaginatedGames> {
  const {
    limit = 24,
    sort = 'popular',
    offset = 0,
    platform,
    genre,
    status,
    yearMin,
    yearMax,
    minReviews,
  } = params;
  const search = new URLSearchParams({
    limit: String(limit),
    sort,
    offset: String(offset),
  });
  if (platform) search.set('platform', platform);
  if (genre) search.set('genre', genre);
  if (status) search.set('status', status);
  if (yearMin != null) search.set('yearMin', String(yearMin));
  if (yearMax != null) search.set('yearMax', String(yearMax));
  if (minReviews != null && minReviews > 0)
    search.set('minReviews', String(minReviews));
  const res = await fetch(`${API_URL}/games/popular?${search}`, {
    next: { revalidate: LISTING_TTL },
  });
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

export async function getGenres(): Promise<GenreOption[]> {
  const res = await fetch(`${API_URL}/games/genres`, {
    next: { revalidate: GENRES_TTL },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getGame(slug: string): Promise<GameDetail | null> {
  const res = await fetch(`${API_URL}/games/${encodeURIComponent(slug)}`, {
    next: { revalidate: GAME_TTL },
  });
  if (!res.ok) return null;
  const game = (await res.json()) as GameDetail;
  // Collections default to empty: a page that renders against an older API
  // build should show fewer sections, never crash.
  return {
    ...game,
    genres: game.genres ?? [],
    platforms: game.platforms ?? [],
    sources: game.sources ?? [],
    salesBreakdown: game.salesBreakdown ?? [],
    estimateSnapshots: game.estimateSnapshots ?? [],
    reviewHistory: game.reviewHistory ?? [],
    followersHistory: game.followersHistory ?? [],
    psRatingsHistory: game.psRatingsHistory ?? [],
    switchRatingsHistory: game.switchRatingsHistory ?? [],
    ccuHistory: game.ccuHistory ?? [],
    priceHistory: game.priceHistory ?? [],
  };
}

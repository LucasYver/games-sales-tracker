export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type Platform =
  | 'PC'
  | 'PLAYSTATION'
  | 'XBOX'
  | 'SWITCH'
  | 'MOBILE'
  | 'GLOBAL'
  | 'OTHER';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GameListItem {
  id: string;
  name: string;
  slug: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: Platform[];
}

export interface PopularGame extends GameListItem {
  genres: string[];
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
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
  steam: { reviews: number } | null;
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
  totalSales: TotalSales | null;
  estimatedToday: { low: number; high: number } | null;
  estimateSnapshots: PublicEstimateSnapshot[];
  reviewHistory: ReviewPoint[];
  storeRatings: StoreRatings;
}

export async function searchGames(query: string): Promise<GameListItem[]> {
  const res = await fetch(
    `${API_URL}/games/search?q=${encodeURIComponent(query)}`,
    { cache: 'no-store' },
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
    cache: 'no-store',
  });
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

export async function getGenres(): Promise<GenreOption[]> {
  const res = await fetch(`${API_URL}/games/genres`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export async function getGame(slug: string): Promise<GameDetail | null> {
  const res = await fetch(`${API_URL}/games/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function refreshGameSources(
  gameId: string,
): Promise<{ found: boolean; articlesIngested: number }> {
  const res = await fetch(`${API_URL}/ingestion/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId }),
  });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  return res.json();
}


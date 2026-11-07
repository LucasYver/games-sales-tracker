export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Figures are recomputed once a day, so serving a few minutes old is free
// accuracy-wise and saves a round trip per view. Search stays shortest: it is
// the one place a visitor notices a missing brand-new game.
// The listing is the same for every visitor and moves slowly: reviews land
// every 4 h and estimates once a day. 3 h keeps it at most one review
// refresh behind while sparing the backend most listing calls.
const LISTING_TTL = 3 * 3600;
const GAME_TTL = 900;
const GENRES_TTL = 3600;
const SEARCH_TTL = 300;
// A studio's list barely moves: one backend call per game per day at most.
const RELATED_TTL = 24 * 3600;

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

/** The single figure the site shows, resolved by the API. */
export interface HeadlineSales {
  low: number;
  high: number;
  /**
   * The figure to display, picked by the API: the ML estimate itself (its
   * range is estimate ÷/× a factor) or the midpoint of the platform sum.
   */
  units: number;
}

export interface PopularGame extends GameListItem {
  genres: string[];
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
  /** Same figure as `HeadlineSales.units`. */
  estimatedUnits: number | null;
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
  | 'PLAYSTATION_LEAK'
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

export interface RegionalPrice {
  country: string;
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
  estimatedTodayUnits: number | null;
}

export interface StoreRatings {
  steam: {
    reviews: number;
    reviewerMedianPlaytimeMinutes: number | null;
  } | null;
  playstation: { reviews: number; score: number | null } | null;
  xbox: { reviews: number; score: number | null } | null;
}

export type PriceStore = 'steam' | 'xbox' | 'playstation';

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
  estimatedToday: HeadlineSales | null;
  /** Released before 2017: the site publishes no estimate for this game. */
  estimateOutOfScope: boolean;
  estimateSnapshots: PublicEstimateSnapshot[];
  reviewHistory: ReviewPoint[];
  followersHistory: ReviewPoint[];
  twitchViewersHistory: ReviewPoint[];
  psRatingsHistory: ReviewPoint[];
  xboxRatingsHistory: ReviewPoint[];
  switchRatingsHistory: ReviewPoint[];
  ccuHistory: ReviewPoint[];
  peakCcu: { value: number; capturedAt: string } | null;
  priceHistory: PricePoint[];
  currentPrice: PricePoint | null;
  lowestPrice: PricePoint | null;
  priceCountry: string;
  priceStore: PriceStore;
  availablePriceStores: PriceStore[];
  regionalPrices: RegionalPrice[];
  rank: RankInfo | null;
  storeRatings: StoreRatings;
  // Recent Steam reviews counted per Steam language code.
  reviewLanguages: Record<string, number> | null;
  blog: { slugByLocale: Partial<Record<string, string>> } | null;
  /** Other editions IGDB lists; the sales on the page cover them all. */
  editions: GameEdition[];
  igdbFacts: IgdbFacts;
  /** Store pages IGDB links beyond the ones in `sources`. */
  otherStores: { epicUrl: string | null; gogUrl: string | null };
}

export type GameType =
  | 'MAIN_GAME'
  | 'DLC'
  | 'EXPANSION'
  | 'BUNDLE'
  | 'STANDALONE_EXPANSION'
  | 'MOD'
  | 'EPISODE'
  | 'SEASON'
  | 'REMAKE'
  | 'REMASTER'
  | 'EXPANDED_GAME'
  | 'PORT'
  | 'FORK'
  | 'PACK'
  | 'UPDATE';

export type GameMode =
  | 'SINGLE_PLAYER'
  | 'MULTIPLAYER'
  | 'CO_OP'
  | 'SPLIT_SCREEN'
  | 'MMO'
  | 'BATTLE_ROYALE';

/** Player-reported completion times from IGDB, in seconds. */
export interface TimeToBeat {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
  /** Reports behind the figures. */
  count: number;
}

/** What IGDB says about the game (see backend `games/igdb-facts.ts`). */
export interface IgdbFacts {
  gameType: GameType | null;
  /** What a remake, remaster, port or expansion comes from. */
  parentGame: { name: string; slug: string | null } | null;
  /** Catalog games that come from this one. */
  derivedGames: { name: string; slug: string; gameType: GameType | null }[];
  gameModes: GameMode[];
  /** Null when too few players reported a time. */
  timeToBeat: TimeToBeat | null;
}

export interface GameEdition {
  name: string;
  versionTitle: string | null;
  releaseDate: string | null;
}

/**
 * The API's figure, rounded so we never imply precision we do not have
 * (nearest 100K above a million, nearest 10K below).
 */
function roundedUnits(units: number | null): number | null {
  if (units == null || units <= 0) return null;
  const step = units >= 1_000_000 ? 100_000 : 10_000;
  return Math.max(step, Math.round(units / step) * step);
}

/** Listing and search rows. */
export function listingUnits(
  game: Pick<PopularGame, 'estimatedUnits'>,
): number | null {
  return roundedUnits(game.estimatedUnits);
}

/** Game page. Same resolution as the listing — the API decides, not the page. */
export function headlineUnits(game: GameDetail): number | null {
  if (!game.headline) return null;
  return roundedUnits(game.headline.units);
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

export type SortOption = 'trending' | 'popular' | 'recent' | 'oldest' | 'sales';

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

/** Cache tag of a public game page's API fetch (every country / store). */
export function gameCacheTag(slug: string): string {
  return `game:${slug}`;
}

export interface RelatedGame extends GameListItem {
  genres: string[];
  isFree: boolean;
  estimatedUnits: number | null;
}

export interface HubLink {
  slug: string;
  name: string;
}

export interface RelatedGames {
  franchise: RelatedGame[];
  studio: RelatedGame[];
  /** Null when the franchise or studio is too small to have a hub page. */
  franchiseHub: HubLink | null;
  studioHub: HubLink | null;
}

export interface GameHub extends HubLink {
  /** Best seller first. */
  games: PopularGame[];
}

async function getHub(path: string): Promise<GameHub | null> {
  const res = await fetch(`${API_URL}/games/${path}`, {
    next: { revalidate: RELATED_TTL },
  });
  return res.ok ? ((await res.json()) as GameHub) : null;
}

export interface HubIndexItem extends HubLink {
  games: number;
}

async function getHubIndex(path: string): Promise<HubIndexItem[]> {
  const res = await fetch(`${API_URL}/games/${path}`, {
    next: { revalidate: RELATED_TTL },
  });
  return res.ok ? ((await res.json()) as HubIndexItem[]) : [];
}

export function getStudios(): Promise<HubIndexItem[]> {
  return getHubIndex('studios');
}

export function getFranchises(): Promise<HubIndexItem[]> {
  return getHubIndex('franchises');
}

export function getStudioHub(slug: string): Promise<GameHub | null> {
  return getHub(`studios/${encodeURIComponent(slug)}`);
}

export function getFranchiseHub(slug: string): Promise<GameHub | null> {
  return getHub(`franchises/${encodeURIComponent(slug)}`);
}

/** Links on a game page: a failure hides the section, never the page. */
export async function getRelatedGames(slug: string): Promise<RelatedGames> {
  const empty: RelatedGames = {
    franchise: [],
    studio: [],
    franchiseHub: null,
    studioHub: null,
  };
  try {
    const res = await fetch(
      `${API_URL}/games/${encodeURIComponent(slug)}/related`,
      { next: { revalidate: RELATED_TTL, tags: [gameCacheTag(slug)] } },
    );
    return res.ok ? ((await res.json()) as RelatedGames) : empty;
  } catch {
    return empty;
  }
}

export async function getGame(
  slug: string,
  country?: string,
  store?: string,
): Promise<GameDetail | null> {
  const search = new URLSearchParams();
  if (country) search.set('country', country);
  if (store) search.set('store', store);
  const qs = search.toString();
  const res = await fetch(
    `${API_URL}/games/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`,
    // The tag lets an admin metadata edit expire this page at once.
    { next: { revalidate: GAME_TTL, tags: [gameCacheTag(slug)] } },
  );
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
    twitchViewersHistory: game.twitchViewersHistory ?? [],
    psRatingsHistory: game.psRatingsHistory ?? [],
    xboxRatingsHistory: game.xboxRatingsHistory ?? [],
    switchRatingsHistory: game.switchRatingsHistory ?? [],
    ccuHistory: game.ccuHistory ?? [],
    priceHistory: game.priceHistory ?? [],
    regionalPrices: game.regionalPrices ?? [],
    availablePriceStores: game.availablePriceStores ?? [],
    priceCountry: game.priceCountry ?? 'us',
    priceStore:
      game.priceStore === 'xbox' || game.priceStore === 'playstation'
        ? game.priceStore
        : 'steam',
    blog: game.blog ?? null,
    editions: game.editions ?? [],
    igdbFacts: {
      gameType: game.igdbFacts?.gameType ?? null,
      parentGame: game.igdbFacts?.parentGame ?? null,
      derivedGames: game.igdbFacts?.derivedGames ?? [],
      gameModes: game.igdbFacts?.gameModes ?? [],
      timeToBeat: game.igdbFacts?.timeToBeat ?? null,
    },
    otherStores: {
      epicUrl: game.otherStores?.epicUrl ?? null,
      gogUrl: game.otherStores?.gogUrl ?? null,
    },
  };
}

/**
 * The slug a game merged into another now lives at (an edition folded into
 * its base game), or null. A failure means no redirect: the page 404s.
 */
export async function getGameRedirect(slug: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/games/${encodeURIComponent(slug)}/redirect`,
      { next: { revalidate: GAME_TTL } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { slug?: string };
    return body.slug ?? null;
  } catch {
    return null;
  }
}

const BLOG_TTL = 3600;

export type BlogPostKind =
  | 'GAME_SALES_FACTS'
  | 'SALES_NEWS'
  | 'LAUNCH_REPORT'
  | 'SALES_RANKING';

export interface PublicBlogListItem {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  kind: BlogPostKind;
  coverUrl: string | null;
  game: { name: string; slug: string; coverUrl: string | null } | null;
}

export interface PublicBlogIndex {
  items: PublicBlogListItem[];
  total: number;
}

/** Line in `bodyMarkdown` where the page renders the sales table. */
export const SALES_TABLE_MARKER = '[[sales-table]]';

export type BlogSourceKind =
  | 'official'
  | 'publisher-press'
  | 'wikipedia'
  | 'press'
  | 'estimate';

export interface BlogFigures {
  sales: {
    date: string | null;
    value: number;
    platform: string;
    sourceKind: BlogSourceKind;
    /** Null for anonymous press reports. */
    sourceName: string | null;
  }[];
  signals: { metric: string; value: number; date: string | null }[];
  /** Rankings only, in rank order. */
  ranking: {
    position: number;
    gameName: string;
    gameSlug: string;
    value: number;
    date: string | null;
    sourceKind: BlogSourceKind;
    sourceName: string | null;
  }[];
  /** News items only: the article the figure comes from. */
  source: { url: string; label: string } | null;
}

export interface PublicBlogPost {
  slug: string;
  locale: 'en' | 'fr';
  kind: BlogPostKind;
  coverUrl: string | null;
  title: string;
  metaDescription: string;
  excerpt: string;
  tldr: string[];
  bodyMarkdown: string;
  faq: { question: string; answer: string }[];
  publishedAt: string | null;
  /** Last change to the public text. */
  updatedAt: string | null;
  /** Date of the newest sourced figure the article uses. */
  figuresAsOf: string | null;
  /** Rendered by the page (sales table + popularity cards); null on older articles. */
  figures: BlogFigures | null;
  game: { name: string; slug: string; coverUrl: string | null } | null;
  alternate: { locale: 'en' | 'fr'; slug: string } | null;
}

export async function getBlogIndex(
  locale: string,
  limit = 20,
  offset = 0,
): Promise<PublicBlogIndex> {
  const res = await fetch(
    `${API_URL}/blog?locale=${encodeURIComponent(locale)}&limit=${limit}&offset=${offset}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

export async function getBlogPost(
  locale: string,
  slug: string,
): Promise<PublicBlogPost | null> {
  const res = await fetch(
    `${API_URL}/blog/${encodeURIComponent(locale)}/${encodeURIComponent(slug)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return null;
  return res.json();
}

export interface BlogSitemapItem {
  locale: string;
  slug: string;
  publishedAt: string | null;
  updatedAt: string | null;
  alternateSlug?: string;
}

export async function getBlogSitemap(): Promise<BlogSitemapItem[]> {
  try {
    const res = await fetch(`${API_URL}/blog/sitemap`, {
      next: { tags: ['blog'], revalidate: BLOG_TTL },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: BlogSitemapItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

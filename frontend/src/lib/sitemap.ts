import { API_URL } from '@/lib/api';
import { hubYears } from '@/lib/hub-years';
import { routing } from '@/i18n/routing';

export interface SitemapGame {
  slug: string;
  lastModified: string | null;
}

export interface SitemapHubs {
  studios: string[];
  publishers: string[];
  franchises: string[];
}

/**
 * URLs per sitemap file. Each URL lists every locale as an hreflang alternate,
 * so it weighs ~0.75 KB at 5 locales: 2,500 URLs stay near 1.9 MB, well under
 * the 4.5 MB a Vercel function may return when ISR regenerates the file. The
 * former single 7.8 MB sitemap stopped refreshing after its build, and 1,000
 * games per file reached 3.75 MB once Arabic was added.
 */
const URLS_PER_SITEMAP = 2500;

/**
 * Pages (a game, a hub) per file. Each page yields one URL per locale, so a
 * new locale shrinks the files' page count instead of growing their size.
 */
export const PAGES_PER_SITEMAP = Math.floor(
  URLS_PER_SITEMAP / routing.locales.length,
);

/**
 * Throws when the API fails or answers with no games, so an ISR regeneration
 * fails and Next keeps serving the last good sitemap. Returning [] here once
 * published an index without game sitemaps and cached 404s for /sitemap/N.xml
 * for an hour, which crawlers report as "page not accessible".
 */
export async function fetchSitemapGames(): Promise<SitemapGame[]> {
  const res = await fetch(`${API_URL}/games/sitemap`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Sitemap games fetch failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: SitemapGame[] };
  if (!data.items?.length) {
    throw new Error('Sitemap games fetch returned no games');
  }
  return data.items;
}

export async function fetchSitemapHubs(): Promise<SitemapHubs> {
  try {
    const res = await fetch(`${API_URL}/games/hubs`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const hubs = await res.json();
      // A backend from before the publisher pages answers without them.
      return { publishers: [], ...hubs };
    }
  } catch {
    // The sitemap keeps its other entries.
  }
  return { studios: [], publishers: [], franchises: [] };
}

/** Hub pages (lists, years, studios, publishers, franchises), locale-free. */
export function hubPaths(hubs: SitemapHubs): string[] {
  return [
    '/studios',
    '/publishers',
    '/franchises',
    ...hubYears().map((year) => `/year/${year}`),
    ...hubs.franchises.map((slug) => `/franchise/${slug}`),
    ...hubs.studios.map((slug) => `/studio/${slug}`),
    ...hubs.publishers.map((slug) => `/publisher/${slug}`),
  ];
}

/** The `page`-th (1-based) slice of PAGES_PER_SITEMAP items. */
export function sitemapPage<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * PAGES_PER_SITEMAP, page * PAGES_PER_SITEMAP);
}

function pageCount(itemCount: number): number {
  return Math.ceil(itemCount / PAGES_PER_SITEMAP);
}

/**
 * Sitemap files under /sitemap/: `0.xml` holds the home, fixed pages, blog and
 * posts; `1.xml`…`n.xml` the games; `hubs-1.xml`… the hub pages. Games keep
 * the bare numbers they always had, so their file URLs do not change kind.
 */
export function sitemapFiles(gameCount: number, hubCount: number): string[] {
  return [
    '0.xml',
    ...Array.from({ length: pageCount(gameCount) }, (_, i) => `${i + 1}.xml`),
    ...Array.from({ length: pageCount(hubCount) }, (_, i) => `hubs-${i + 1}.xml`),
  ];
}

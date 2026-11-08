import { API_URL } from '@/lib/api';

export interface SitemapGame {
  slug: string;
  lastModified: string | null;
}

/**
 * Games per sitemap file. Each game yields one URL per locale, each listing
 * every locale as an hreflang alternate (~0.7 KB per URL at 4 locales), so
 * 1,000 games stay near 3 MB — well under the 4.5 MB a Vercel function may
 * return when ISR regenerates the file. The former single 7.8 MB sitemap
 * stopped refreshing after its build.
 */
export const GAMES_PER_SITEMAP = 1000;

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

export async function fetchSitemapHubs(): Promise<{
  studios: string[];
  publishers: string[];
  franchises: string[];
}> {
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

/** Sitemap ids: 0 holds the home, blog and posts; 1..n hold the games. */
export function sitemapIds(gameCount: number): number[] {
  const gameSitemaps = Math.ceil(gameCount / GAMES_PER_SITEMAP);
  return Array.from({ length: gameSitemaps + 1 }, (_, id) => id);
}

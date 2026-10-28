import { API_URL } from '@/lib/api';

export interface SitemapGame {
  slug: string;
  lastModified: string | null;
}

/**
 * Games per sitemap file. Each game yields one URL per locale with hreflang
 * alternates (~0.5 KB each), so 2,000 games stay near 2 MB — well under the
 * 4.5 MB a Vercel function may return when ISR regenerates the file. The
 * former single 7.8 MB sitemap stopped refreshing after its build.
 */
export const GAMES_PER_SITEMAP = 2000;

export async function fetchSitemapGames(): Promise<SitemapGame[]> {
  try {
    const res = await fetch(`${API_URL}/games/sitemap`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: SitemapGame[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

/** Sitemap ids: 0 holds the home, blog and posts; 1..n hold the games. */
export function sitemapIds(gameCount: number): number[] {
  const gameSitemaps = Math.ceil(gameCount / GAMES_PER_SITEMAP);
  return Array.from({ length: gameSitemaps + 1 }, (_, id) => id);
}

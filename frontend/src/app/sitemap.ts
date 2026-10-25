import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';

interface SitemapGame {
  slug: string;
  lastModified: string | null;
}

async function fetchSitemapGames(): Promise<SitemapGame[]> {
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const games = await fetchSitemapGames();
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [];

  // Home pages — one per locale (page 1 only; no filter/search URLs).
  for (const locale of routing.locales) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((l) => [l, `${SITE_URL}/${l}`]),
          ),
          'x-default': `${SITE_URL}/${routing.defaultLocale}`,
        },
      },
    });
  }

  // Per-game pages, one entry per locale variant.
  for (const game of games) {
    const lastMod = game.lastModified ? new Date(game.lastModified) : now;
    const lastModified = Number.isNaN(lastMod.getTime()) ? now : lastMod;
    for (const locale of routing.locales) {
      entries.push({
        url: `${SITE_URL}/${locale}/game/${game.slug}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: {
            ...Object.fromEntries(
              routing.locales.map((l) => [
                l,
                `${SITE_URL}/${l}/game/${game.slug}`,
              ]),
            ),
            'x-default': `${SITE_URL}/${routing.defaultLocale}/game/${game.slug}`,
          },
        },
      });
    }
  }

  return entries;
}

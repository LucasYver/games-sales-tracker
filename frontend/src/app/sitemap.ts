import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// Slim payload from the API to keep the sitemap quick to build even with
// thousands of tracked games. We don't expose anything that isn't already
// in /games/popular.
interface SitemapGame {
  slug: string;
  releaseDate: string | null;
}

async function fetchAllGames(): Promise<SitemapGame[]> {
  const all: SitemapGame[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    try {
      const res = await fetch(
        `${API_URL}/games/popular?limit=${pageSize}&offset=${offset}&sort=popular`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) break;
      const { items, total } = (await res.json()) as {
        items: SitemapGame[];
        total: number;
      };
      all.push(...items.map((g) => ({ slug: g.slug, releaseDate: g.releaseDate })));
      if (offset + items.length >= total || items.length === 0) break;
    } catch {
      break;
    }
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const games = await fetchAllGames();
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [];

  // Home pages — one per locale.
  for (const locale of routing.locales) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, `${SITE_URL}/${l}`]),
        ),
      },
    });
  }

  // Per-game pages, one entry per locale variant.
  for (const game of games) {
    const lastMod = game.releaseDate ? new Date(game.releaseDate) : now;
    for (const locale of routing.locales) {
      entries.push({
        url: `${SITE_URL}/${locale}/game/${game.slug}`,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((l) => [
              l,
              `${SITE_URL}/${l}/game/${game.slug}`,
            ]),
          ),
        },
      });
    }
  }

  return entries;
}

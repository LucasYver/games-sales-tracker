import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { getBlogSitemap } from '@/lib/api';

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
  const [games, posts] = await Promise.all([
    fetchSitemapGames(),
    getBlogSitemap(),
  ]);
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

  for (const locale of routing.locales) {
    entries.push({
      url: `${SITE_URL}/${locale}/blog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((l) => [l, `${SITE_URL}/${l}/blog`]),
          ),
          'x-default': `${SITE_URL}/${routing.defaultLocale}/blog`,
        },
      },
    });
  }

  // One entry per language version, each listing all versions (hreflang).
  for (const post of posts) {
    const altLocale = post.locale === 'en' ? 'fr' : 'en';
    const own = `${SITE_URL}/${post.locale}/blog/${post.slug}`;
    const alt = post.alternateSlug
      ? `${SITE_URL}/${altLocale}/blog/${post.alternateSlug}`
      : null;
    const defaultUrl =
      post.locale === routing.defaultLocale || !alt ? own : alt;
    const lastMod = new Date(post.updatedAt ?? post.publishedAt ?? '');
    entries.push({
      url: own,
      lastModified: Number.isNaN(lastMod.getTime()) ? now : lastMod,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: {
        languages: {
          [post.locale]: own,
          ...(alt ? { [altLocale]: alt } : {}),
          'x-default': defaultUrl,
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

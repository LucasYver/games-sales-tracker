import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { getBlogSitemap } from '@/lib/api';
import {
  GAMES_PER_SITEMAP,
  fetchSitemapGames,
  sitemapIds,
  type SitemapGame,
} from '@/lib/sitemap';

// Serves /sitemap/{id}.xml, listed by the index at /sitemap.xml. A plain
// route handler rather than app/sitemap.ts + generateSitemaps: Next refuses
// a split metadata sitemap next to a /sitemap.xml route.
export const revalidate = 3600;

export async function generateStaticParams() {
  const games = await fetchSitemapGames();
  return sitemapIds(games.length).map((id) => ({ file: `${id}.xml` }));
}

/** A future date is not a modification time — leave lastmod out instead. */
function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now()) return undefined;
  return at;
}

function latest(values: (string | null | undefined)[]): Date | undefined {
  let max: Date | undefined;
  for (const value of values) {
    const at = parseDate(value);
    if (at && (!max || at > max)) max = at;
  }
  return max;
}

/** hreflang alternates for a path that exists under every locale. */
function localeAlternates(path: string) {
  return {
    languages: {
      ...Object.fromEntries(
        routing.locales.map((l) => [l, `${SITE_URL}/${l}${path}`]),
      ),
      'x-default': `${SITE_URL}/${routing.defaultLocale}${path}`,
    },
  };
}

async function pagesSitemap(
  games: SitemapGame[],
): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogSitemap();
  const entries: MetadataRoute.Sitemap = [];

  // Home pages — one per locale (page 1 only; no filter/search URLs). The
  // listing changes when estimates are recomputed.
  const homeModified = latest(games.map((g) => g.lastModified));
  for (const locale of routing.locales) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      lastModified: homeModified,
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: localeAlternates(''),
    });
  }

  const blogModified = latest(posts.map((p) => p.updatedAt ?? p.publishedAt));
  for (const locale of routing.locales) {
    entries.push({
      url: `${SITE_URL}/${locale}/blog`,
      lastModified: blogModified,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: localeAlternates('/blog'),
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
    entries.push({
      url: own,
      lastModified: parseDate(post.updatedAt ?? post.publishedAt),
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

  return entries;
}

/** Per-game pages, one entry per locale variant. */
function gamesSitemap(games: SitemapGame[]): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const game of games) {
    const lastModified = parseDate(game.lastModified);
    for (const locale of routing.locales) {
      entries.push({
        url: `${SITE_URL}/${locale}/game/${game.slug}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: localeAlternates(`/game/${game.slug}`),
      });
    }
  }
  return entries;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Same urlset shape Next emits for app/sitemap.ts. */
function renderSitemap(entries: MetadataRoute.Sitemap): string {
  const urls = entries.map((entry) => {
    const lines = [`<loc>${escapeXml(entry.url)}</loc>`];
    for (const [lang, href] of Object.entries(
      entry.alternates?.languages ?? {},
    )) {
      if (!href) continue;
      lines.push(
        `<xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(href)}" />`,
      );
    }
    if (entry.lastModified) {
      lines.push(
        `<lastmod>${new Date(entry.lastModified).toISOString()}</lastmod>`,
      );
    }
    if (entry.changeFrequency) {
      lines.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`<priority>${entry.priority}</priority>`);
    }
    return `<url>\n${lines.join('\n')}\n</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

export async function GET(
  _req: Request,
  ctx: RouteContext<'/sitemap/[file]'>,
) {
  const { file } = await ctx.params;
  const match = /^(\d+)\.xml$/.exec(file);
  const games = await fetchSitemapGames();
  const id = match ? Number(match[1]) : -1;
  if (!sitemapIds(games.length).includes(id)) {
    return new Response('Not found', { status: 404 });
  }

  const entries =
    id === 0
      ? await pagesSitemap(games)
      : gamesSitemap(
          games.slice((id - 1) * GAMES_PER_SITEMAP, id * GAMES_PER_SITEMAP),
        );
  return new Response(renderSitemap(entries), {
    headers: { 'Content-Type': 'application/xml' },
  });
}

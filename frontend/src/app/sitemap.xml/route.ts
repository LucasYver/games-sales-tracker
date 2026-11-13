import { SITE_URL } from '@/lib/site-url';
import {
  fetchSitemapGames,
  fetchSitemapHubs,
  hubPaths,
  sitemapFiles,
} from '@/lib/sitemap';

// Sitemap index: robots.txt and Search Console point here, and it lists the
// split sitemaps that app/sitemap/[file]/route.ts serves at /sitemap/{id}.xml.
export const revalidate = 3600;

export async function GET() {
  const [games, hubs] = await Promise.all([
    fetchSitemapGames(),
    fetchSitemapHubs(),
  ]);
  const sitemaps = sitemapFiles(games.length, hubPaths(hubs).length)
    .map((file) => `<sitemap>\n<loc>${SITE_URL}/sitemap/${file}</loc>\n</sitemap>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>
`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

import { SITE_URL } from '@/lib/site-url';
import { fetchSitemapGames, sitemapIds } from '@/lib/sitemap';

// Sitemap index: robots.txt and Search Console point here, and it lists the
// split sitemaps that app/sitemap/[file]/route.ts serves at /sitemap/{id}.xml.
export const revalidate = 3600;

export async function GET() {
  const games = await fetchSitemapGames();
  const sitemaps = sitemapIds(games.length)
    .map((id) => `<sitemap>\n<loc>${SITE_URL}/sitemap/${id}.xml</loc>\n</sitemap>`)
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

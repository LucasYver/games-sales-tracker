import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { routing } from './src/i18n/routing';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Game pages are cached (ISR). A price country or store in the query (`cc`,
// `store`) is a per-visitor choice: serve it from the uncached `live` route
// beside each page, so the cached pages never read the query. The query is
// kept on the rewrite, so the live page still reads it.
const LOCALE = `:locale(${routing.locales.join('|')})`;
const liveGameRewrites = (['', '/price'] as const).flatMap((tab) =>
  (['cc', 'store'] as const).map((key) => ({
    source: `/${LOCALE}/game/:slug${tab}`,
    has: [{ type: 'query' as const, key }],
    destination: `/:locale/game/:slug${tab}/live`,
  })),
);

const nextConfig: NextConfig = {
  async rewrites() {
    return { beforeFiles: liveGameRewrites, afterFiles: [], fallback: [] };
  },
  // Share images read their fonts with readFile (lib/og.tsx); make sure the
  // files ship with those functions.
  outputFileTracingIncludes: {
    '/**/opengraph-image': ['./assets/og-fonts/**/*'],
  },
  images: {
    // Covers are tiny thumbs; Vercel Image Optimization billed a crawl of
    // the whole catalog. Flip `unoptimized` off to resume resizing — the
    // 31-day TTL then applies so bots do not re-transform every 4 hours.
    unoptimized: true,
    minimumCacheTTL: 2678400,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'shared.akamai.steamstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.igdb.com',
        pathname: '/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);

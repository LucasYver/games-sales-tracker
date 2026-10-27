import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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

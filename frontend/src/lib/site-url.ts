const PRODUCTION_SITE_URL = 'https://www.gamesalestracker.tech';
const LOCAL_SITE_URL = 'http://localhost:3000';

/**
 * Public origin for canonicals, Open Graph, robots, and the sitemap.
 * Never uses VERCEL_URL / *.vercel.app (preview hosts are wrong for SEO).
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_SITE_URL;
  return LOCAL_SITE_URL;
}

export const SITE_URL = getSiteUrl();

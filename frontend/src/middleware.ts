import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Exclude admin routes from the locale routing — the back-office is
  // English-only and lives outside the [locale] tree.
  matcher: ['/((?!api|trpc|admin|sitemap.xml|robots.txt|_next|_vercel|.*\\..*).*)'],
};

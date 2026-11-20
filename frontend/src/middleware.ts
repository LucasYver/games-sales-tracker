import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

// The game page's price tab used to be `?tab=price`; it is now its own cached
// path. Old links (shares, search results) move there for good.
const OLD_PRICE_TAB = new RegExp(
  `^/(${routing.locales.join('|')})/game/([^/]+)/?$`,
);

export default function middleware(request: NextRequest) {
  const { nextUrl } = request;
  if (nextUrl.searchParams.get('tab') === 'price') {
    const match = OLD_PRICE_TAB.exec(nextUrl.pathname);
    if (match) {
      const url = nextUrl.clone();
      url.pathname = `/${match[1]}/game/${match[2]}/price`;
      url.searchParams.delete('tab');
      return NextResponse.redirect(url, 308);
    }
  }
  return handleI18nRouting(request);
}

export const config = {
  // Exclude admin routes from the locale routing — the back-office is
  // English-only and lives outside the [locale] tree.
  matcher: ['/((?!api|trpc|admin|sitemap.xml|robots.txt|_next|_vercel|.*\\..*).*)'],
};

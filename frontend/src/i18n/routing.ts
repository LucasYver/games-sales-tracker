import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'es', 'ru'],
  defaultLocale: 'en',
  // Pages declare hreflang in their metadata. The middleware's automatic Link
  // header would also advertise translated blog URLs that do not exist.
  alternateLinks: false,
});

/** Articles are written per language, at one paid AI call each. */
const BLOG_LOCALES: readonly string[] = ['en', 'fr'];

export function hasBlog(locale: string): boolean {
  return BLOG_LOCALES.includes(locale);
}

/** hreflang map for a path (may carry a query) that exists under every locale. */
export function localeLanguages(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
    'x-default': `/${routing.defaultLocale}${path}`,
  };
}

import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'es', 'ru', 'ar', 'zh-CN'],
  defaultLocale: 'en',
  // Pages declare hreflang in their metadata. The middleware's automatic Link
  // header would also advertise translated blog URLs that do not exist.
  alternateLinks: false,
});

/** Locales written right to left: the layout sets `dir="rtl"` for them. */
const RTL_LOCALES: readonly string[] = ['ar'];

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.includes(locale);
}

/** Articles are written per language, at one paid AI call each. */
const BLOG_LOCALES: readonly string[] = ['en', 'fr'];

/** Whether articles are written in this locale (sitemap, hreflang). */
export function hasBlog(locale: string): boolean {
  return BLOG_LOCALES.includes(locale);
}

/**
 * Language the articles are read in under a locale: its own when written,
 * else English. The blog shows in every locale, with the page in the
 * visitor's language around English articles.
 */
export function blogContentLocale(locale: string): string {
  return hasBlog(locale) ? locale : routing.defaultLocale;
}

/** hreflang map for a path (may carry a query) that exists under every locale. */
export function localeLanguages(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
    'x-default': `/${routing.defaultLocale}${path}`,
  };
}

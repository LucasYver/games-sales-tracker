import type { GameDetail } from './api';

/** Our Instant Gaming affiliate code, read by the store from `?igr=`. */
const INSTANT_GAMING_REF = 'gamer-09e480';

// Site locale → store locale. The store has no Russian pages.
const INSTANT_GAMING_LOCALES: Record<string, string> = {
  en: 'en',
  fr: 'fr',
  es: 'es',
};

/**
 * The game's Instant Gaming affiliate URL, or null when the daily sync found
 * no product for it. The stored URL is the English page; the store redirects
 * `/<locale>/<id>-…/` to its page in that language and keeps `igr`.
 */
export function instantGamingUrl(
  game: Pick<GameDetail, 'sources' | 'isFree'>,
  locale: string,
): string | null {
  if (game.isFree) return null;
  const source = game.sources.find((s) => s.source === 'INSTANT_GAMING');
  if (!source?.url) return null;
  const url = new URL(source.url);
  const storeLocale = INSTANT_GAMING_LOCALES[locale] ?? 'en';
  url.pathname = url.pathname.replace(/^\/[a-z]{2}\//, `/${storeLocale}/`);
  url.searchParams.set('igr', INSTANT_GAMING_REF);
  return url.toString();
}

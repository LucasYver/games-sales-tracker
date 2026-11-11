/**
 * Decides which Instant Gaming product, if any, is a catalog game. Pure and
 * dependency-free; `InstantGamingLinksService` feeds it the store's sitemap.
 *
 * A product URL reads `/en/<id>-buy-<title>-<platform>-<store>-<region>/`.
 * The rule: strip the trailing platform, store and region words, and keep the
 * product only when what remains equals the game's name. No fuzzy match: an
 * edition ("-deluxe-edition"), a DLC or a sequel never links. A missed link
 * costs nothing; a link to the wrong game costs the reader's trust.
 */

import { Platform } from '../entities/enums';

export type InstantGamingProduct = {
  id: number;
  /** Everything after `<id>-buy-` in the English URL. */
  slug: string;
};

export type InstantGamingCandidate = InstantGamingProduct & {
  platform: Platform;
  /** Lower is better: Steam key, other PC launchers, Xbox, PlayStation, Switch. */
  rank: number;
};

const PRODUCT_URL =
  /<loc>https:\/\/www\.instant-gaming\.com\/en\/(\d+)-buy-([a-z0-9-]+?)\/<\/loc>/g;

export function parseProductSitemap(xml: string): InstantGamingProduct[] {
  const products: InstantGamingProduct[] = [];
  for (const m of xml.matchAll(PRODUCT_URL)) {
    products.push({ id: Number(m[1]), slug: m[2] });
  }
  return products;
}

// Regions whose keys an EU buyer can activate. Any other region suffix
// ("-united-states", "-latin-america", "-turkey", "-playstation-store-spain")
// is a region-locked key, so the product is dropped.
const OPEN_REGIONS = ['europe', 'eu', 'global', 'worldwide'];
const LOCKED_REGIONS = [
  'united-states',
  'united-kingdom',
  'latin-america',
  'us-and-canada',
  'us-and-ca',
  'north-america',
  'turkey',
  'spain',
  'germany',
  'france',
  'italy',
  'poland',
  'argentina',
  'brazil',
  'india',
  'japan',
  'mexico',
  'uk',
  'us',
  'usa',
  'canada',
  'australia',
  'netherlands',
  'belgium',
  'austria',
  'portugal',
  'switzerland',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'ireland',
  'asia',
  'emea',
  'row',
];
const PLATFORM_WORDS = [
  'pc',
  'mac',
  'linux',
  'game',
  'steam',
  'microsoft-store',
  'windows-10',
  'windows',
  'xbox-one',
  'xbox-series-x-s',
  'xbox-series-x',
  'xbox-series',
  'xbox-360',
  'xbox',
  'playstation-store',
  'playstation-5',
  'playstation-4',
  'ps4',
  'ps5',
  'nintendo-eshop',
  'nintendo-switch-2',
  'nintendo-switch',
  'switch-2',
  'switch',
  'ea-app',
  'origin',
  'ubisoft-connect',
  'uplay',
  'epic-games-store',
  'epic-games',
  'gog-com',
  'gog',
  'battle-net',
  'rockstar-games-launcher',
  'rockstar',
  'standard-edition',
  'standard',
  'cd-key',
  'key',
  'code',
  'digital',
];
// Longest first, so "xbox-series-x-s" goes before "xbox".
const SUFFIX_WORDS = [
  ...PLATFORM_WORDS,
  ...OPEN_REGIONS,
  ...LOCKED_REGIONS,
].sort((a, b) => b.length - a.length);

/** The product's title part: its slug without the trailing store words. */
export function productTitle(slug: string): string {
  let s = slug;
  for (let changed = true; changed; ) {
    changed = false;
    for (const word of SUFFIX_WORDS) {
      if (s.endsWith(`-${word}`)) {
        s = s.slice(0, -word.length - 1);
        changed = true;
        break;
      }
    }
  }
  return s;
}

/**
 * The game's name in the store's slug alphabet: "Five Nights at Freddy's"
 * → "five-nights-at-freddy-s", "XCOM® 2" → "xcom-2", "Röki" → "roki".
 */
export function titleKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Platform and preference of a product from its store words, or null. */
function classify(
  storeWords: string,
): { platform: Platform; rank: number } | null {
  const words = new Set(storeWords.split('-'));
  if (words.has('steam')) return { platform: Platform.PC, rank: 0 };
  if (/playstation|ps4|ps5/.test(storeWords))
    return { platform: Platform.PLAYSTATION, rank: 3 };
  if (/nintendo|switch/.test(storeWords))
    return { platform: Platform.SWITCH, rank: 4 };
  if (words.has('xbox')) return { platform: Platform.XBOX, rank: 2 };
  if (storeWords.includes('microsoft-store'))
    return words.has('pc') || words.has('windows')
      ? { platform: Platform.PC, rank: 1 }
      : { platform: Platform.XBOX, rank: 2 };
  if (
    words.has('pc') ||
    words.has('mac') ||
    /ea-app|origin|ubisoft|uplay|epic-games|gog|battle-net|rockstar/.test(
      storeWords,
    )
  )
    return { platform: Platform.PC, rank: 1 };
  return null;
}

function isRegionLocked(storeWords: string): boolean {
  const padded = `-${storeWords}-`;
  return LOCKED_REGIONS.some((r) => padded.includes(`-${r}-`));
}

export type ProductIndex = {
  /** Products by title key, region-locked ones already dropped. */
  byTitle: Map<string, InstantGamingCandidate[]>;
  /**
   * Years the store appends to tell same-name games apart:
   * "resident-evil-4" → {2005, 2023} from "resident-evil-4-2005-…".
   */
  years: Map<string, Set<number>>;
};

export function indexProducts(products: InstantGamingProduct[]): ProductIndex {
  const byTitle = new Map<string, InstantGamingCandidate[]>();
  const years = new Map<string, Set<number>>();
  for (const product of products) {
    const title = productTitle(product.slug);
    if (!title || title === product.slug) continue;
    const storeWords = product.slug.slice(title.length + 1);
    if (isRegionLocked(storeWords)) continue;
    const kind = classify(storeWords);
    if (!kind) continue;
    const list = byTitle.get(title) ?? [];
    list.push({ ...product, ...kind });
    byTitle.set(title, list);
    const year = /^(.+)-((?:19|20)\d\d)$/.exec(title);
    if (year) {
      const set = years.get(year[1]) ?? new Set<number>();
      set.add(Number(year[2]));
      years.set(year[1], set);
    }
  }
  return { byTitle, years };
}

/**
 * The product to link for a game, or null.
 *
 * When the store appends a year to a title ("resident-evil-4-2023"), the
 * game's release year picks the listing. When it does for other years only,
 * the plain listing may be the other game, so there is no link. Otherwise two
 * catalog games with the same name (an original and its remake) get no link.
 *
 * The product must exist on one of the game's platforms; among those, a
 * Steam key wins, then the oldest product id (the base listing).
 */
export function pickProduct(
  game: { name: string; platforms: Platform[]; releaseYear: number | null },
  index: ProductIndex,
  nameCounts: Map<string, number>,
): InstantGamingCandidate | null {
  const key = titleKey(game.name);
  if (!key) return null;
  let listings: InstantGamingCandidate[] | undefined;
  const years = index.years.get(key);
  if (years) {
    if (game.releaseYear == null || !years.has(game.releaseYear)) return null;
    listings = index.byTitle.get(`${key}-${game.releaseYear}`);
  } else {
    if ((nameCounts.get(key) ?? 0) > 1) return null;
    listings = index.byTitle.get(key);
  }
  const platforms = new Set(game.platforms);
  const candidates = (listings ?? []).filter(
    (c) => platforms.size === 0 || platforms.has(c.platform),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    c.rank < best.rank || (c.rank === best.rank && c.id < best.id) ? c : best,
  );
}

export function productUrl(product: InstantGamingProduct): string {
  return `https://www.instant-gaming.com/en/${product.id}-buy-${product.slug}/`;
}

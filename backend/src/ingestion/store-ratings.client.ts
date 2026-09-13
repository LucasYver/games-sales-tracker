import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Platform, SignalMetric } from '../entities';
import { XboxCatalogClient } from './xbox-catalog.client';

export interface StoreRating {
  platform: Platform;
  metric: SignalMetric;
  ratingCount: number;
  averageRating: number | null;
  sourceUrl: string;
}

export interface KnownStoreUrls {
  playstationUrl?: string;
  xboxUrl?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// The Xbox Store search returns product ids in relevance order but never
// their titles, so the correct SKU can only be confirmed by opening the
// product page. Cap how many candidates we probe before giving up to keep
// a no-match (e.g. a PlayStation exclusive) bounded.
const XBOX_MAX_CANDIDATES = 5;

@Injectable()
export class StoreRatingsClient {
  private readonly logger = new Logger(StoreRatingsClient.name);

  constructor(private readonly xboxCatalog: XboxCatalogClient) {}

  /**
   * Collect the number of user ratings for a game on console stores. The
   * count is later turned into a per-platform sales proxy (a console
   * Boxleiter). Each store is best-effort: a failure or a no-match yields
   * nothing rather than throwing.
   *
   * PlayStation uses the concept page, which aggregates every SKU/region
   * into a single global count. Xbox.com pages are per-market, but the
   * Display Catalog `UsageData` AllTime RatingCount is worldwide — we
   * resolve the product id (search or a stored URL) then read that JSON.
   */
  async getRatings(
    name: string,
    known: KnownStoreUrls = {},
  ): Promise<StoreRating[]> {
    const [ps, xbox] = await Promise.all([
      this.getPlaystation(name, known.playstationUrl),
      this.getXbox(name, known.xboxUrl),
    ]);
    return [ps, xbox].filter((r): r is StoreRating => r !== null);
  }

  private async getPlaystation(
    name: string,
    knownUrl?: string,
  ): Promise<StoreRating | null> {
    try {
      if (knownUrl) {
        const cached = await this.playstationRatingFromUrl(name, knownUrl);
        if (cached) return cached;
      }
      // Resolve the parent concept rather than a single SKU. PSN exposes
      // a per-SKU `totalRatingsCount` on every product page (PS4 vs PS5,
      // Standard vs Deluxe vs Ultimate, currency add-ons like "FC Points"),
      // each with its own — usually tiny — count. The concept page
      // aggregates the whole catalog and matches the canonical headline
      // PSN displays (e.g. 159k for EA SPORTS FC 24).
      //
      // Two resolution paths, tried in order:
      //  1. Portal page `playstation.com/en-us/games/{slug}` — much
      //     more precise than the store search (which can return zero
      //     concepts for the queried title, e.g. Crusader Kings III
      //     surfaces 4 unrelated concepts and never its real one).
      //     The slug derives deterministically from the game name with
      //     PSN-specific rules (apostrophes stripped without a dash,
      //     `&` → `and`).
      //  2. Store search fallback for games whose portal URL doesn't
      //     resolve (older titles, redirects, hub pages). The trailing
      //     `extractPsTitle` + `titleMatches` check on the concept page
      //     is the safety net: a wrong concept page won't match the
      //     queried name and we'll bail with null rather than persist
      //     bogus ratings.
      const conceptId =
        (await this.resolvePsConceptIdFromPortal(name)) ??
        (await this.resolvePsConceptIdFromSearch(name));
      if (!conceptId) return null;

      const url = `https://store.playstation.com/en-us/concept/${conceptId}`;
      return this.playstationRatingFromUrl(name, url);
    } catch (error) {
      this.logger.warn(`PlayStation lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  private async playstationRatingFromUrl(
    name: string,
    url: string,
  ): Promise<StoreRating | null> {
    const page = await this.fetchOptional(url);
    if (!page) return null;

    const title = this.extractPsTitle(page);
    if (!title || !this.titleMatches(name, title)) return null;

    const rating = this.extractPsStarRating(page);
    if (!rating || rating.ratingCount <= 0) return null;

    return {
      platform: Platform.PLAYSTATION,
      metric: SignalMetric.PS_RATINGS,
      ratingCount: rating.ratingCount,
      averageRating: rating.averageRating,
      sourceUrl: url.split('?')[0],
    };
  }

  /**
   * Xbox Store lookup. Search still goes through xbox.com (no titles in the
   * HTML bucket). Ratings come from Display Catalog AllTime — worldwide,
   * not the en-US page. We batch the top candidates in one catalog call
   * and keep a rating only when the catalog title confirms the match.
   */
  private async getXbox(
    name: string,
    knownUrl?: string,
  ): Promise<StoreRating | null> {
    try {
      if (knownUrl) {
        const cached = await this.xboxRatingFromUrl(name, knownUrl);
        if (cached) return cached;
      }

      const productIds = await this.resolveXboxProductIds(name);
      if (productIds.length === 0) return null;

      const catalog = await this.xboxCatalog.getProducts(
        productIds.slice(0, XBOX_MAX_CANDIDATES),
        'US',
      );

      let firstPrefixMatch: StoreRating | null = null;
      for (const productId of productIds.slice(0, XBOX_MAX_CANDIDATES)) {
        const product = catalog.get(productId.toUpperCase());
        if (!product?.title || !product.rating) continue;
        if (!this.titleMatches(name, product.title)) continue;

        const url = `https://www.xbox.com/en-US/games/store/x/${product.productId}`;
        const result = this.xboxRatingResult(url, product.rating);
        if (this.isExactTitleMatch(name, product.title)) return result;
        if (!firstPrefixMatch) firstPrefixMatch = result;
      }
      return firstPrefixMatch;
    } catch (error) {
      this.logger.warn(`Xbox lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  /**
   * Resolve candidate product ids from the Xbox Store search. A bare `:`
   * between words makes the search return zero results (e.g.
   * "NieR:Automata"), so on an empty first pass we retry with a
   * punctuation-stripped query before giving up.
   */
  private async resolveXboxProductIds(name: string): Promise<string[]> {
    const ids = await this.searchXboxProductIds(name);
    if (ids.length > 0) return ids;

    const simplified = this.simplifyXboxQuery(name);
    if (simplified && simplified !== name) {
      return this.searchXboxProductIds(simplified);
    }
    return [];
  }

  private async searchXboxProductIds(query: string): Promise<string[]> {
    const search = await this.fetchOptional(
      `https://www.xbox.com/en-US/Search/Results?q=${encodeURIComponent(query)}`,
    );
    if (!search) return [];

    // The "games" bucket lists product ids in relevance order.
    const bucket = search.match(
      /"SEARCH_GAMES_SEARCHQUERY=[^"]*":\{"type":2,"data":\{"products":\[(.*?)\]/,
    );
    if (!bucket) return [];

    return [...bucket[1].matchAll(/"productId":"([A-Z0-9]{12})"/g)].map(
      (m) => m[1],
    );
  }

  private async xboxRatingFromUrl(
    name: string,
    url: string,
  ): Promise<StoreRating | null> {
    const productId = this.xboxCatalog.xboxProductIdFromUrl(url);
    if (!productId) return null;
    const catalog = await this.xboxCatalog.getProducts([productId], 'US');
    const product = catalog.get(productId);
    if (!product?.title || !product.rating) return null;
    if (!this.titleMatches(name, product.title)) return null;
    return this.xboxRatingResult(url.split('?')[0], product.rating);
  }

  private xboxRatingResult(
    url: string,
    rating: { ratingCount: number; averageRating: number | null },
  ): StoreRating {
    return {
      platform: Platform.XBOX,
      metric: SignalMetric.XBOX_RATINGS,
      ratingCount: rating.ratingCount,
      averageRating: rating.averageRating,
      sourceUrl: url,
    };
  }

  private simplifyXboxQuery(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Try the playstation.com portal page for the game. The slug is
   * derived from the name with PSN-specific rules — empirically:
   *   - apostrophes stripped without a separator (assassins-creed)
   *   - `&` → `and` (ratchet-and-clank-rift-apart)
   *   - `:` and other punctuation simply dropped
   *
   * Returns the embedded `conceptId` when present, or null on a 404 /
   * hub page that lists multiple games without exposing a single
   * concept (e.g. some franchise umbrella pages).
   */
  private async resolvePsConceptIdFromPortal(
    name: string,
  ): Promise<string | null> {
    const slug = this.psnPortalSlug(name);
    if (!slug) return null;
    const page = await this.fetchOptional(
      `https://www.playstation.com/en-us/games/${slug}/`,
    );
    if (!page) return null;
    return this.extractPsConceptId(page);
  }

  /**
   * Fallback resolver via the store search. PSN's search page is a SPA
   * shell that no longer inlines `/concept/...` links reliably (and
   * sometimes returns wrong concepts entirely — see Crusader Kings
   * III), but it still server-renders `/product/...` tiles. We fetch
   * the first SKU and read its parent `conceptId` from the embedded
   * telemetry payload. The caller validates the resulting concept's
   * title before persisting anything.
   */
  private async resolvePsConceptIdFromSearch(
    name: string,
  ): Promise<string | null> {
    const search = await this.fetchOptional(
      `https://store.playstation.com/en-us/search/${encodeURIComponent(name)}`,
    );
    if (!search) return null;

    const productLink = search.match(/\/product\/[A-Z0-9_-]+/);
    if (!productLink) return null;

    const productUrl = `https://store.playstation.com/en-us${productLink[0]}`;
    const productPage = await this.fetchOptional(productUrl);
    if (!productPage) return null;

    return this.extractPsConceptId(productPage);
  }

  private psnPortalSlug(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B'`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Extract a non-empty `conceptId` from a product page. The id is
   * embedded inside an HTML-encoded JSX telemetry blob (so it shows up
   * as `conceptId&quot;:&quot;10007176&quot;` and, double-escaped,
   * `conceptId\u0026quot;:\u0026quot;10007176\u0026quot;`). We decode
   * both layers, then pick the first non-empty `conceptId` occurrence —
   * some entries are blank placeholders for promotional cross-sell
   * tiles and must be skipped.
   */
  private extractPsConceptId(html: string): string | null {
    const decoded = html.replace(/\\u0026quot;/g, '"').replace(/&quot;/g, '"');
    for (const m of decoded.matchAll(/"conceptId":"(\d+)"/g)) {
      if (m[1]) return m[1];
    }
    return null;
  }

  /**
   * Extract the canonical star rating block from a concept page. PSN
   * periodically reorders the JSON fields (today
   * `averageRatingForDisplay` sits between `averageRating` and
   * `totalRatingsCount`, and `ratingsDistribution` adds nested objects
   * in between), so we walk the brace-balanced block as a whole and
   * pull both numbers independently. The first `"starRating":{...}` on
   * a concept page is the `defaultProduct`'s rating, which aggregates
   * the catalog — exactly what we want.
   */
  private extractPsStarRating(
    html: string,
  ): { averageRating: number; ratingCount: number } | null {
    // Anchor on the __typename to skip an unrelated `"starRating":{...}`
    // entry the page also emits as part of its JS bundle manifest
    // (`"starRating":{"js":[...]}`) — that one has no rating data.
    const marker = '"starRating":';
    const dataMarker = `${marker}{"__typename":"StarRating"`;
    const start = html.indexOf(dataMarker);
    if (start < 0) return null;
    const block = this.readBalancedObject(html, start + marker.length);
    if (!block) return null;
    const avg = block.match(/"averageRating":([\d.]+)/);
    const count = block.match(/"totalRatingsCount":(\d+)/);
    if (!avg || !count) return null;
    return {
      averageRating: Number(avg[1]),
      ratingCount: Number(count[1]),
    };
  }

  private readBalancedObject(html: string, openIndex: number): string | null {
    if (html[openIndex] !== '{') return null;
    let depth = 0;
    for (let i = openIndex; i < html.length; i++) {
      const ch = html[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return html.slice(openIndex, i + 1);
      }
    }
    return null;
  }

  private extractPsTitle(page: string): string | null {
    const match = page.match(/<title>([^<]+)<\/title>/);
    if (!match) return null;
    return this.decodeHtmlEntities(match[1])
      .replace(/\b(PS4 & PS5|PS4|PS5)\b/g, '')
      .replace(/[™®]/g, '')
      .trim();
  }

  // PSN encodes apostrophes and other punctuation as numeric HTML entities in
  // the <title> (e.g. `Assassin&#x27;s Creed`). Left undecoded, the literal
  // `x27` leaks into the normalized title and breaks the `titleMatches` prefix
  // check, dropping valid ratings for any title with an apostrophe.
  private decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&nbsp;': ' ',
    };
    return value
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&[a-zA-Z]+;/g, (entity) => named[entity] ?? entity);
  }

  // Accept when one normalized title is a prefix of the other (store titles
  // carry edition/platform suffixes), with a minimum overlap to avoid noise.
  private titleMatches(query: string, found: string): boolean {
    const q = this.normalize(query);
    const f = this.normalize(found);
    if (!q || !f) return false;
    const shorter = q.length < f.length ? q : f;
    return shorter.length >= 4 && (f.startsWith(q) || q.startsWith(f));
  }

  private isExactTitleMatch(query: string, found: string): boolean {
    const q = this.normalize(query);
    const f = this.normalize(found);
    return q.length > 0 && q === f;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async fetch(url: string): Promise<string | null> {
    const { data } = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' },
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text',
    });
    return data;
  }

  /**
   * Variant of `fetch` that swallows `404 Not Found` (and any other
   * client error short of a network failure) by returning null. Used
   * for resolution probes — portal slug guesses, store search misses —
   * where a "page doesn't exist" is the expected negative path and
   * must NOT abort the outer fallback chain.
   */
  private async fetchOptional(url: string): Promise<string | null> {
    try {
      return await this.fetch(url);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status && status >= 400 && status < 500) return null;
      }
      throw error;
    }
  }
}

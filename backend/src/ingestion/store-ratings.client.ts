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

export interface StoreLookupResult {
  ratings: StoreRating[];
  playstationConceptUrl: string | null;
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

// Chihiro tumbler search still returns product ids when the storefront
// HTML search page is a client-only SPA shell. Cap probes the same way.
const PS_MAX_CANDIDATES = 5;

const CHIHIRO_SEARCH_URL =
  'https://store.playstation.com/store/api/chihiro/00_09_000/tumbler/US/en/999';

@Injectable()
export class StoreRatingsClient {
  private readonly logger = new Logger(StoreRatingsClient.name);

  constructor(private readonly xboxCatalog: XboxCatalogClient) {}

  /**
   * Collect console store lookups. Xbox remains best-effort (no-match →
   * omitted). PlayStation always reports whether a concept page was
   * confirmed so the caller can persist the URL without ratings and
   * fail the cron when the concept is missing.
   */
  async getRatings(
    name: string,
    known: KnownStoreUrls = {},
  ): Promise<StoreLookupResult> {
    const [ps, xbox] = await Promise.all([
      this.getPlaystation(name, known.playstationUrl),
      this.getXbox(name, known.xboxUrl),
    ]);
    const ratings: StoreRating[] = [];
    if (ps?.rating) ratings.push(ps.rating);
    if (xbox) ratings.push(xbox);
    return {
      ratings,
      playstationConceptUrl: ps?.sourceUrl ?? null,
    };
  }

  private async getPlaystation(
    name: string,
    knownUrl?: string,
  ): Promise<{ sourceUrl: string; rating: StoreRating | null } | null> {
    try {
      if (knownUrl) {
        const cached = await this.playstationFromUrl(name, knownUrl);
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
      //  1. Portal page `playstation.com/en-us/games/{slug}` — precise
      //     when the slug matches (apostrophes stripped, `&` → `and`,
      //     thousand-separators collapsed, common roman numerals → digits).
      //  2. Chihiro tumbler search → product page → parent conceptId.
      //     The HTML `/search/...` page is a client-only SPA shell and no
      //     longer inlines `/product/...` links, so we cannot scrape it.
      //     Title match on the concept page is the safety net against a
      //     wrong Chihiro hit.
      const portalId = await this.resolvePsConceptIdFromPortal(name);
      if (portalId) {
        const fromPortal = await this.playstationFromUrl(
          name,
          this.psConceptUrl(portalId),
        );
        if (fromPortal) return fromPortal;
      }

      for (const conceptId of await this.resolvePsConceptIdsFromSearch(name)) {
        const result = await this.playstationFromUrl(
          name,
          this.psConceptUrl(conceptId),
        );
        if (result) return result;
      }
      return null;
    } catch (error) {
      this.logger.warn(`PlayStation lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  private psConceptUrl(conceptId: string): string {
    return `https://store.playstation.com/en-us/concept/${conceptId}`;
  }

  private async playstationFromUrl(
    name: string,
    url: string,
  ): Promise<{ sourceUrl: string; rating: StoreRating | null } | null> {
    const page = await this.fetchOptional(url);
    if (!page) return null;

    const title = this.extractPsTitle(page);
    if (!title || !this.titleMatches(name, title)) return null;

    const sourceUrl = url.split('?')[0];
    const rating = this.extractPsStarRating(page);
    if (!rating || rating.ratingCount <= 0) {
      return { sourceUrl, rating: null };
    }

    return {
      sourceUrl,
      rating: {
        platform: Platform.PLAYSTATION,
        metric: SignalMetric.PS_RATINGS,
        ratingCount: rating.ratingCount,
        averageRating: rating.averageRating,
        sourceUrl,
      },
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
    for (const slug of this.psnPortalSlugs(name)) {
      const page = await this.fetchOptional(
        `https://www.playstation.com/en-us/games/${slug}/`,
      );
      if (!page) continue;
      const conceptId = this.extractPsConceptId(page);
      if (conceptId) return conceptId;
    }
    return null;
  }

  /**
   * Fallback resolver via Chihiro tumbler search. Returns candidate
   * concept ids in relevance order; the caller title-checks each one.
   * Query variants matter: Chihiro returns zero hits for bare `:` or
   * thousands-separators (`Clair Obscur: Expedition 33`,
   * `Warhammer 40,000: …`), so we also try a punctuation-stripped form
   * and the subtitle after `:`.
   */
  private async resolvePsConceptIdsFromSearch(
    name: string,
  ): Promise<string[]> {
    const productIds = await this.searchPsProductIds(name);
    const conceptIds: string[] = [];
    const seen = new Set<string>();
    for (const productId of productIds.slice(0, PS_MAX_CANDIDATES)) {
      const productPage = await this.fetchOptional(
        `https://store.playstation.com/en-us/product/${productId}`,
      );
      if (!productPage) continue;
      const conceptId = this.extractPsConceptId(productPage);
      if (!conceptId || seen.has(conceptId)) continue;
      seen.add(conceptId);
      conceptIds.push(conceptId);
    }
    return conceptIds;
  }

  private async searchPsProductIds(name: string): Promise<string[]> {
    const seen = new Set<string>();
    const matched: string[] = [];
    // Keep the first non-empty raw tumbler list as a last resort when no
    // variant produced a title-plausible hit (over-strict normalize edge
    // cases). Prefer continuing across query variants before using it —
    // e.g. "Warhammer 40000 …" ranks unrelated 40k titles, while the
    // subtitle "Space Marine 2" hits the right SKU.
    let rawFallback: string[] = [];
    for (const query of this.psSearchQueries(name)) {
      const batch = await this.chihiroSearchProductIds(query, name);
      for (const id of batch.matched) {
        if (seen.has(id)) continue;
        seen.add(id);
        matched.push(id);
      }
      if (rawFallback.length === 0 && batch.raw.length > 0) {
        rawFallback = batch.raw;
      }
      if (matched.length > 0) break;
    }
    return matched.length > 0 ? matched : rawFallback;
  }

  private psSearchQueries(name: string): string[] {
    const queries: string[] = [];
    const add = (raw: string) => {
      const q = raw.replace(/\s+/g, ' ').trim();
      if (q.length >= 2 && !queries.includes(q)) queries.push(q);
    };
    add(name);
    add(this.simplifyPsQuery(name));
    const colonParts = name.split(':').map((p) => p.trim()).filter(Boolean);
    if (colonParts.length > 1) {
      add(colonParts[0]);
      add(this.simplifyPsQuery(colonParts[0]));
      add(colonParts[colonParts.length - 1]);
      add(this.simplifyPsQuery(colonParts[colonParts.length - 1]));
    }
    return queries;
  }

  private simplifyPsQuery(name: string): string {
    let value = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[Δδ]/g, 'delta');
    // Collapse 40,000 → 40000 (Chihiro treats the comma as a hard miss).
    while (/(\d),(\d{3})\b/.test(value)) {
      value = value.replace(/(\d),(\d{3})\b/g, '$1$2');
    }
    return value
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async chihiroSearchProductIds(
    query: string,
    gameName: string,
  ): Promise<{ matched: string[]; raw: string[] }> {
    try {
      const { data } = await axios.get<{
        links?: Array<{ id?: string; name?: string; container_type?: string }>;
      }>(`${CHIHIRO_SEARCH_URL}/${encodeURIComponent(query)}`, {
        params: { suggested_size: 10, offset: 0 },
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 20000,
      });
      const matched: string[] = [];
      const raw: string[] = [];
      for (const link of data.links ?? []) {
        if (!link.id || link.container_type !== 'product') continue;
        raw.push(link.id);
        // Edition suffixes still pass via prefix titleMatches.
        if (!link.name || this.titleMatches(gameName, link.name)) {
          matched.push(link.id);
        }
      }
      return { matched, raw };
    } catch (error) {
      this.logger.warn(`Chihiro search failed for "${query}": ${error}`);
      return { matched: [], raw: [] };
    }
  }

  /**
   * Candidate portal slugs. PSN is inconsistent on sequel numerals
   * (`hades-2` vs occasionally `…-ii`) and on greek letters (`delta`),
   * so we try a small set rather than a single guess.
   */
  private psnPortalSlugs(name: string): string[] {
    const base = this.psnPortalSlugBase(name);
    if (!base) return [];
    const withDigits = base
      .replace(/\bviii\b/g, '8')
      .replace(/\bvii\b/g, '7')
      .replace(/\bvi\b/g, '6')
      .replace(/\biv\b/g, '4')
      .replace(/\biii\b/g, '3')
      .replace(/\bii\b/g, '2')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const asRoman = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return [...new Set([withDigits, asRoman].filter(Boolean))];
  }

  private psnPortalSlugBase(name: string): string {
    let value = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[Δδ]/g, ' delta ')
      .replace(/[™®]/g, '');
    while (/(\d),(\d{3})\b/.test(value)) {
      value = value.replace(/(\d),(\d{3})\b/g, '$1$2');
    }
    return value
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B'`]/g, '')
      .replace(/&/g, ' and ');
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

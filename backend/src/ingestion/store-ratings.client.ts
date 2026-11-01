import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Platform, SignalMetric } from '../entities';
import {
  storeProductMatchesGame,
  romanNumeralsToDigits,
  storeTitleBaseNames,
  storeTitleRelation,
  type StoreTitleRelation,
} from './store-title-match';
import {
  XboxCatalogClient,
  type XboxCatalogProduct,
} from './xbox-catalog.client';

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
  /**
   * The stored concept page loaded fine but is another game. Everything
   * captured from it (ratings, prices) belongs to that other game.
   */
  playstationUrlRejected: boolean;
  /** Same for the stored Xbox product. */
  xboxUrlRejected: boolean;
}

/** Catalog dates a store release can be compared with (first, PlayStation). */
export type GameReleaseDates = Array<Date | null | undefined>;

type PsPageOutcome =
  | { kind: 'match'; sourceUrl: string; rating: StoreRating | null }
  | { kind: 'mismatch' }
  | { kind: 'unavailable' };

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
// Bounds the requests a game with no store product costs on each daily pass.
const XBOX_MAX_SEARCH_QUERIES = 4;

// Chihiro tumbler search still returns product ids when the storefront
// HTML search page is a client-only SPA shell. Cap probes the same way.
const PS_MAX_CANDIDATES = 5;

// Bounds the requests a game with no store page costs on each daily pass.
const PS_MAX_SEARCH_QUERIES = 6;
const PS_MAX_PORTAL_SLUGS = 4;

// Rendered in place of a game title when the store has no real page.
const PS_GENERIC_TITLE = 'PlayStation';

const STORE_RELATION_RANK: Record<StoreTitleRelation, number> = {
  exact: 0,
  edition: 1,
  subtitle: 2,
  none: 3,
};

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
    releaseDates: GameReleaseDates = [],
  ): Promise<StoreLookupResult> {
    const [ps, xbox] = await Promise.all([
      this.getPlaystation(name, known.playstationUrl, releaseDates),
      this.getXbox(name, known.xboxUrl, releaseDates),
    ]);
    const ratings: StoreRating[] = [];
    if (ps.match?.rating) ratings.push(ps.match.rating);
    if (xbox.rating) ratings.push(xbox.rating);
    return {
      ratings,
      playstationConceptUrl: ps.match?.sourceUrl ?? null,
      playstationUrlRejected: ps.urlRejected,
      xboxUrlRejected: xbox.urlRejected,
    };
  }

  private async getPlaystation(
    name: string,
    knownUrl: string | undefined,
    releaseDates: GameReleaseDates,
  ): Promise<{
    match: { sourceUrl: string; rating: StoreRating | null } | null;
    urlRejected: boolean;
  }> {
    let urlRejected = false;
    try {
      if (knownUrl) {
        const cached = await this.playstationFromUrl(
          name,
          knownUrl,
          releaseDates,
        );
        if (cached.kind === 'match') return { match: cached, urlRejected };
        urlRejected = cached.kind === 'mismatch';
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
      //
      // Each concept page must pass `storeProductMatchesGame`, whichever path
      // found it: both paths can land on another game.
      const portalId = await this.resolvePsConceptIdFromPortal(name);
      if (portalId) {
        const fromPortal = await this.playstationFromUrl(
          name,
          this.psConceptUrl(portalId),
          releaseDates,
        );
        if (fromPortal.kind === 'match') {
          return { match: fromPortal, urlRejected };
        }
      }

      for (const conceptId of await this.resolvePsConceptIdsFromSearch(name)) {
        const result = await this.playstationFromUrl(
          name,
          this.psConceptUrl(conceptId),
          releaseDates,
        );
        if (result.kind === 'match') return { match: result, urlRejected };
      }
      return { match: null, urlRejected };
    } catch (error) {
      this.logger.warn(`PlayStation lookup failed for "${name}": ${error}`);
      return { match: null, urlRejected };
    }
  }

  private psConceptUrl(conceptId: string): string {
    return `https://store.playstation.com/en-us/concept/${conceptId}`;
  }

  private async playstationFromUrl(
    name: string,
    url: string,
    releaseDates: GameReleaseDates,
  ): Promise<PsPageOutcome> {
    const page = await this.fetchOptional(url);
    if (!page) return { kind: 'unavailable' };

    const title = this.extractPsTitle(page);
    if (!title || title === PS_GENERIC_TITLE) return { kind: 'unavailable' };
    const productName = this.extractPsProductName(page);
    const storeRelease = this.extractPsReleaseDate(page, url);
    const matches = [title, productName].some(
      (storeTitle) =>
        storeTitle &&
        storeProductMatchesGame(name, storeTitle, storeRelease, releaseDates),
    );
    if (!matches) {
      // A mismatch deletes data, so it takes two independent names: a change
      // in the page's <title> format alone must not read as "another game".
      return productName ? { kind: 'mismatch' } : { kind: 'unavailable' };
    }

    const sourceUrl = url.split('?')[0];
    const rating = this.extractPsStarRating(page);
    if (!rating || rating.ratingCount <= 0) {
      return { kind: 'match', sourceUrl, rating: null };
    }

    return {
      kind: 'match',
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
   * and keep a rating only when `storeProductMatchesGame` confirms the match.
   */
  private async getXbox(
    name: string,
    knownUrl: string | undefined,
    releaseDates: GameReleaseDates,
  ): Promise<{ rating: StoreRating | null; urlRejected: boolean }> {
    let urlRejected = false;
    try {
      if (knownUrl) {
        const productId = this.xboxCatalog.xboxProductIdFromUrl(knownUrl);
        if (productId) {
          const catalog = await this.xboxCatalog.getProducts([productId], 'US');
          const product = catalog.get(productId);
          if (product?.title) {
            if (this.xboxProductMatches(name, product, releaseDates)) {
              if (product.rating) {
                return {
                  rating: this.xboxRatingResult(
                    knownUrl.split('?')[0],
                    product.rating,
                  ),
                  urlRejected,
                };
              }
            } else {
              urlRejected = true;
            }
          }
        }
      }

      let subtitleMatch: StoreRating | null = null;
      for (const query of this.xboxSearchQueries(name)) {
        const productIds = await this.searchXboxProductIds(query);
        if (productIds.length === 0) continue;
        const candidates = productIds.slice(0, XBOX_MAX_CANDIDATES);
        const catalog = await this.xboxCatalog.getProducts(candidates, 'US');

        let best: { rank: number; rating: StoreRating } | null = null;
        for (const productId of candidates) {
          const product = catalog.get(productId.toUpperCase());
          if (!product?.title || !product.rating) continue;
          if (!this.xboxProductMatches(name, product, releaseDates)) continue;
          const rank =
            STORE_RELATION_RANK[storeTitleRelation(name, product.title)];
          if (best && best.rank <= rank) continue;
          best = {
            rank,
            rating: this.xboxRatingResult(
              `https://www.xbox.com/en-US/games/store/x/${product.productId}`,
              product.rating,
            ),
          };
        }
        if (best && best.rank < STORE_RELATION_RANK.subtitle) {
          return { rating: best.rating, urlRejected };
        }
        // A subtitle hit may be a spin-off, so keep looking for a closer title.
        if (best && !subtitleMatch) subtitleMatch = best.rating;
      }
      return { rating: subtitleMatch, urlRejected };
    } catch (error) {
      this.logger.warn(`Xbox lookup failed for "${name}": ${error}`);
      return { rating: null, urlRejected };
    }
  }

  private xboxProductMatches(
    name: string,
    product: XboxCatalogProduct,
    releaseDates: GameReleaseDates,
  ): boolean {
    return (
      !!product.title &&
      storeProductMatchesGame(
        name,
        product.title,
        product.releaseDate,
        releaseDates,
      )
    );
  }

  /**
   * A bare `:` between words makes the search return zero results (e.g.
   * "NieR:Automata"), so punctuation-stripped forms follow the plain name.
   */
  private xboxSearchQueries(name: string): string[] {
    const queries: string[] = [];
    const add = (raw: string) => {
      const q = raw.replace(/\s+/g, ' ').trim();
      if (q.length >= 2 && !queries.includes(q)) queries.push(q);
    };
    add(name);
    for (const base of storeTitleBaseNames(name)) {
      add(this.simplifyXboxQuery(base));
      add(romanNumeralsToDigits(this.simplifyXboxQuery(base)));
    }
    return queries.slice(0, XBOX_MAX_SEARCH_QUERIES);
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
    const slugs = storeTitleBaseNames(name).flatMap((base) =>
      this.psnPortalSlugs(base),
    );
    for (const slug of [...new Set(slugs)].slice(0, PS_MAX_PORTAL_SLUGS)) {
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
  private async resolvePsConceptIdsFromSearch(name: string): Promise<string[]> {
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
    const matched: Array<{ id: string; rank: number }> = [];
    // Keep the first non-empty raw tumbler list as a last resort when no
    // variant produced a title-plausible hit (over-strict normalize edge
    // cases). Prefer continuing across query variants before using it —
    // e.g. "Warhammer 40000 …" ranks unrelated 40k titles, while the
    // subtitle "Space Marine 2" hits the right SKU.
    let rawFallback: string[] = [];
    for (const query of this.psSearchQueries(name)) {
      const batch = await this.chihiroSearchProductIds(query, name);
      for (const hit of batch.matched) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        matched.push(hit);
      }
      if (rawFallback.length === 0 && batch.raw.length > 0) {
        rawFallback = batch.raw;
      }
      // A subtitle hit may be a spin-off, so keep looking for a closer title.
      if (matched.some((hit) => hit.rank < STORE_RELATION_RANK.subtitle)) break;
    }
    if (matched.length === 0) return rawFallback;
    return [...matched].sort((a, b) => a.rank - b.rank).map((hit) => hit.id);
  }

  private psSearchQueries(name: string): string[] {
    const queries: string[] = [];
    const add = (raw: string) => {
      const q = raw.replace(/\s+/g, ' ').trim();
      if (q.length >= 2 && !queries.includes(q)) queries.push(q);
    };
    for (const base of storeTitleBaseNames(name)) {
      add(base);
      add(this.simplifyPsQuery(base));
      add(romanNumeralsToDigits(this.simplifyPsQuery(base)));
    }
    const colonParts = name
      .split(':')
      .map((p) => p.trim())
      .filter(Boolean);
    if (colonParts.length > 1) {
      add(colonParts[0]);
      add(this.simplifyPsQuery(colonParts[0]));
      add(colonParts[colonParts.length - 1]);
      add(this.simplifyPsQuery(colonParts[colonParts.length - 1]));
    }
    return queries.slice(0, PS_MAX_SEARCH_QUERIES);
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
  ): Promise<{ matched: Array<{ id: string; rank: number }>; raw: string[] }> {
    try {
      const { data } = await axios.get<{
        links?: Array<{ id?: string; name?: string; container_type?: string }>;
      }>(`${CHIHIRO_SEARCH_URL}/${encodeURIComponent(query)}`, {
        params: { suggested_size: 10, offset: 0 },
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 20000,
      });
      const matched: Array<{ id: string; rank: number }> = [];
      const raw: string[] = [];
      for (const link of data.links ?? []) {
        if (!link.id || link.container_type !== 'product') continue;
        raw.push(link.id);
        // Only a cheap filter: the concept page makes the final decision.
        const relation = link.name
          ? storeTitleRelation(gameName, link.name)
          : 'subtitle';
        if (relation !== 'none') {
          matched.push({ id: link.id, rank: STORE_RELATION_RANK[relation] });
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

  /**
   * Release date of this concept, not of a cross-sell tile elsewhere on the
   * page, so look inside its own Apollo cache entry first.
   */
  private extractPsReleaseDate(page: string, url: string): Date | null {
    const conceptId = url.match(/\/concept\/(\d+)/)?.[1];
    const entry = conceptId ? page.indexOf(`"Concept:${conceptId}":{`) : -1;
    const scope = entry >= 0 ? page.slice(entry, entry + 6000) : page;
    const value =
      scope.match(
        /"releaseDate":\{"__typename":"ReleaseDate","type":"[A-Z_]*","value":"([^"]+)"/,
      )?.[1] ?? page.match(/"releaseDate":"(\d{4}-[^"]+)"/)?.[1];
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** The schema.org product name, independent of the page's <title>. */
  private extractPsProductName(page: string): string | null {
    const name = page.match(
      /"@type":"Product","name":"((?:[^"\\]|\\.)+)"/,
    )?.[1];
    return name ? this.decodeHtmlEntities(name) : null;
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
  // `x27` leaks into the normalized title and breaks the title
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

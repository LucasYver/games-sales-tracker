import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Platform, SignalMetric } from '../entities';

export interface StoreRating {
  platform: Platform;
  metric: SignalMetric;
  ratingCount: number;
  averageRating: number | null;
  sourceUrl: string;
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

  /**
   * Collect the number of user ratings for a game on console stores. The
   * count is later turned into a per-platform sales proxy (a console
   * Boxleiter). Each store is best-effort: a failure or a no-match yields
   * nothing rather than throwing.
   *
   * PlayStation uses the concept page, which aggregates every SKU/region
   * into a single global count. The Xbox Store has no such aggregate —
   * its rating count is scoped to the current locale's market — so we
   * deliberately read the US region only (the largest market) and treat
   * it as a proxy. That single-region count is enough to build a
   * dedicated Xbox Boxleiter later; until then the Xbox estimate is still
   * derived from the PS aggregate via `genre-console-split-from-ps-xbox`
   * (see `EstimationService.aggregateResultsByPlatform`).
   */
  async getRatings(name: string): Promise<StoreRating[]> {
    const [ps, xbox] = await Promise.all([
      this.getPlaystation(name),
      this.getXbox(name),
    ]);
    return [ps, xbox].filter((r): r is StoreRating => r !== null);
  }

  private async getPlaystation(name: string): Promise<StoreRating | null> {
    try {
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
      const page = await this.fetch(url);
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
        sourceUrl: url,
      };
    } catch (error) {
      this.logger.warn(`PlayStation lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  /**
   * Xbox Store lookup (US region). Mirrors the PlayStation flow: resolve
   * candidate products, open each product page, and only keep a rating
   * once the product's own title confirms the match — a wrong SKU won't
   * pass `titleMatches` and yields null rather than a bogus rating.
   *
   * The search API returns product ids in relevance order but no titles,
   * and the first hit is frequently an edition/companion SKU rather than
   * the base game (e.g. "It Takes Two - Friend's Pass" before
   * "It Takes Two"). So we scan the top candidates and prefer an exact
   * title match over a prefix one, falling back to the first prefix match
   * (which is what console-only edition names like "Hollow Knight:
   * Voidheart Edition" or "Disco Elysium - The Final Cut" require).
   */
  private async getXbox(name: string): Promise<StoreRating | null> {
    try {
      const productIds = await this.resolveXboxProductIds(name);
      if (productIds.length === 0) return null;

      let firstPrefixMatch: StoreRating | null = null;
      for (const productId of productIds.slice(0, XBOX_MAX_CANDIDATES)) {
        const url = `https://www.xbox.com/en-US/games/store/x/${productId}`;
        const page = await this.fetchOptional(url);
        if (!page) continue;

        const title = this.extractXboxTitle(page, productId);
        if (!title || !this.titleMatches(name, title)) continue;

        const rating = this.extractXboxRating(page, productId);
        if (!rating || rating.ratingCount <= 0) continue;

        const result: StoreRating = {
          platform: Platform.XBOX,
          metric: SignalMetric.XBOX_RATINGS,
          ratingCount: rating.ratingCount,
          averageRating: rating.averageRating,
          sourceUrl: url,
        };
        if (this.isExactTitleMatch(name, title)) return result;
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

  private simplifyXboxQuery(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Recover the product's real title. The document `<title>` is a generic
   * "Buy … | Xbox" (or even "Game Pass") shell, so we prefer the schema
   * JSON-LD `name`, then the canonical URL slug (`store/<slug>/<id>` — the
   * `x` slug we request with is our own placeholder and must be skipped),
   * then the `<title>` as a last resort.
   */
  private extractXboxTitle(page: string, productId: string): string | null {
    const jsonLd = page.match(
      /"@type":\[[^\]]*"VideoGame"[^\]]*\],"name":"([^"]+)"/,
    );
    if (jsonLd) return jsonLd[1];

    const slug = this.extractXboxSlug(page, productId);
    if (slug) return slug.replace(/-/g, ' ');

    const docTitle = page.match(/<title>([^<]+)<\/title>/);
    if (docTitle) {
      return docTitle[1]
        .replace(/^Buy\s+/i, '')
        .replace(/\s*\|\s*Xbox.*$/i, '')
        .trim();
    }
    return null;
  }

  private extractXboxSlug(page: string, productId: string): string | null {
    // The slug shows up both plain (`store/<slug>/<id>`) and JS-escaped
    // (`store\u002F<slug>\u002F<id>`).
    const patterns = [
      new RegExp(`store/([a-z0-9-]+)/${productId}`, 'g'),
      new RegExp(`store\\\\u002F([a-z0-9-]+)\\\\u002F${productId}`, 'g'),
    ];
    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(page))) {
        if (match[1] !== 'x') return match[1];
      }
    }
    return null;
  }

  /**
   * Extract the product's rating. Preferred source is the schema.org
   * JSON-LD block emitted once per page for the main product (carrying
   * both figures together). Some pages omit it and only expose the rating
   * on the React product object, so we fall back to the `ratingCount`
   * anchored to our product id — stopping before the next `productId` so a
   * cross-sell tile can't leak in. `averageRating` isn't always present in
   * that fallback shape.
   */
  private extractXboxRating(
    page: string,
    productId: string,
  ): { averageRating: number | null; ratingCount: number } | null {
    const jsonLd = page.match(
      /"aggregateRating":\{"@type":"AggregateRating","ratingValue":([\d.]+),"ratingCount":(\d+)/,
    );
    if (jsonLd) {
      return {
        averageRating: Number(jsonLd[1]),
        ratingCount: Number(jsonLd[2]),
      };
    }

    const anchored = page.match(
      new RegExp(
        `"productId":"${productId}"((?:(?!"productId")[\\s\\S]){0,600}?)"ratingCount":(\\d+)`,
      ),
    );
    if (anchored) {
      const avg = anchored[1].match(/"averageRating":([\d.]+)/);
      return {
        averageRating: avg ? Number(avg[1]) : null,
        ratingCount: Number(anchored[2]),
      };
    }
    return null;
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
    const decoded = html
      .replace(/\\u0026quot;/g, '"')
      .replace(/&quot;/g, '"');
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

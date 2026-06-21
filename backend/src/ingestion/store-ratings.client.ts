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

@Injectable()
export class StoreRatingsClient {
  private readonly logger = new Logger(StoreRatingsClient.name);

  /**
   * Collect the number of user ratings for a game on each console store.
   * The rating count is later turned into a per-platform sales proxy (a
   * console Boxleiter). Each store is best-effort: a failure or a no-match
   * yields nothing rather than throwing.
   *
   * - PlayStation Store and Xbox Store expose a public rating count.
   *   skipped here and relies on reported figures (Wikipedia/press) instead.
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
      const search = await this.fetch(
        `https://store.playstation.com/en-us/search/${encodeURIComponent(name)}`,
      );
      if (!search) return null;

      const link = search.match(/\/product\/[A-Z0-9_-]+/);
      if (!link) return null;

      const url = `https://store.playstation.com/en-us${link[0]}`;
      const page = await this.fetch(url);
      if (!page) return null;

      const title = this.extractPsTitle(page);
      if (!title || !this.titleMatches(name, title)) return null;

      const star = page.match(
        /"starRating":\{"__typename":"StarRating","averageRating":([\d.]+),"totalRatingsCount":(\d+)/,
      );
      if (!star) return null;

      const ratingCount = Number(star[2]);
      if (ratingCount <= 0) return null;

      return {
        platform: Platform.PLAYSTATION,
        metric: SignalMetric.PS_RATINGS,
        ratingCount,
        averageRating: Number(star[1]),
        sourceUrl: url,
      };
    } catch (error) {
      this.logger.warn(`PlayStation lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  private async getXbox(name: string): Promise<StoreRating | null> {
    try {
      const search = await this.fetch(
        `https://www.xbox.com/en-US/Search/Results?q=${encodeURIComponent(name)}`,
      );
      if (!search) return null;

      // The "games" bucket lists product ids in relevance order: take the first.
      const bucket = search.match(
        /"SEARCH_GAMES_SEARCHQUERY=[^"]*":\{"type":2,"data":\{"products":\[\{"productId":"([A-Z0-9]{12})"/,
      );
      if (!bucket) return null;

      const productId = bucket[1];
      const url = `https://www.xbox.com/en-US/games/store/x/${productId}`;
      const page = await this.fetch(url);
      if (!page) return null;

      // The product's real title only lives in the canonical URL slug. Tie it
      // to the known product id and ignore our placeholder "x" slug.
      const title = this.extractXboxTitle(page, productId);
      if (!title || !this.titleMatches(name, title)) return null;

      const rc = page.match(/"ratingCount":(\d+)/);
      const ar = page.match(/"averageRating":([\d.]+)/);
      if (!rc) return null;

      const ratingCount = Number(rc[1]);
      if (ratingCount <= 0) return null;

      return {
        platform: Platform.XBOX,
        metric: SignalMetric.XBOX_RATINGS,
        ratingCount,
        averageRating: ar ? Number(ar[1]) : null,
        sourceUrl: `https://www.xbox.com/en-US/games/store/${title.replace(/\s+/g, '-')}/${productId}`,
      };
    } catch (error) {
      this.logger.warn(`Xbox lookup failed for "${name}": ${error}`);
      return null;
    }
  }

  private extractPsTitle(page: string): string | null {
    const match = page.match(/<title>([^<]+)<\/title>/);
    if (!match) return null;
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/\b(PS4 & PS5|PS4|PS5)\b/g, '')
      .replace(/[™®]/g, '')
      .trim();
  }

  private extractXboxTitle(page: string, productId: string): string | null {
    const re = new RegExp(
      `store(?:\\\\u002F|/)([a-z0-9-]+)(?:\\\\u002F|/)${productId}`,
      'g',
    );
    let match: RegExpExecArray | null;
    while ((match = re.exec(page))) {
      if (match[1] !== 'x') return match[1].replace(/-/g, ' ');
    }
    return null;
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
}

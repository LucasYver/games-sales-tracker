import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface SteamPrice {
  // ISO 4217 currency code reported by Steam for the requested region.
  currency: string;
  // Regular ("initial") price in the currency's minor units (cents).
  initial: number;
  // Current price after any active discount, in minor units (cents).
  final: number;
  // Active discount percentage (0 when not on sale).
  discountPercent: number;
}

export interface SteamAppDetails {
  appId: number;
  name: string;
  releaseDate: Date | null;
  headerImage: string | null;
  shortDescription: string | null;
  isFree: boolean;
  developers: string[];
  publishers: string[];
  genres: string[];
  // Steam store "categories" (e.g. "Single-player", "Multi-player",
  // "Co-op", "Steam Achievements"). Display labels, not localized ids.
  categories: string[];
  // appIds of this game's DLC, as listed by the Steam store.
  dlc: number[];
  // Current pricing for the requested region; null for free titles or when
  // Steam omits `price_overview` (unreleased, region-locked, etc.).
  price: SteamPrice | null;
}

export interface SteamReviewDailyCount {
  // UTC day (YYYY-MM-DD).
  day: string;
  // New positive/negative reviews created that day (not cumulative).
  positive: number;
  negative: number;
}

export interface SteamReviewHistory {
  // Per-day new-review counts, sorted ascending by day.
  daily: SteamReviewDailyCount[];
  // Number of individual reviews actually paginated through.
  totalFetched: number;
  // `query_summary.total_reviews` reported by Steam on the first page; may
  // exceed `totalFetched` because deleted reviews are excluded from results.
  reportedTotal: number | null;
}

@Injectable()
export class SteamClient {
  private readonly logger = new Logger(SteamClient.name);

  async getAppDetails(appId: number): Promise<SteamAppDetails | null> {
    try {
      const data = await this.getStoreJson(
        'https://store.steampowered.com/api/appdetails',
        { appids: appId, l: 'english', cc: 'us' },
      );

      const entry = data?.[String(appId)];
      if (!entry?.success || !entry.data) return null;

      const d = entry.data;
      return {
        appId,
        name: d.name,
        releaseDate: this.parseReleaseDate(d.release_date?.date),
        headerImage: d.header_image ?? null,
        shortDescription: d.short_description ?? null,
        isFree: Boolean(d.is_free),
        developers: Array.isArray(d.developers) ? d.developers : [],
        publishers: Array.isArray(d.publishers) ? d.publishers : [],
        genres: Array.isArray(d.genres)
          ? (d.genres as { description: string }[]).map((g) => g.description)
          : [],
        categories: Array.isArray(d.categories)
          ? (d.categories as { description?: unknown }[])
              .map((c) => (typeof c.description === 'string' ? c.description : null))
              .filter((c): c is string => c !== null)
          : [],
        dlc: Array.isArray(d.dlc)
          ? (d.dlc as unknown[])
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id))
          : [],
        price: this.parsePrice(d.price_overview),
      };
    } catch (error) {
      this.logger.warn(`getAppDetails failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Resolve a Steam appId from a game name. Used as a fallback when IGDB
   * has no Steam external_game entry for a title that nevertheless ships on
   * Steam (notably EA / Ubisoft / Epic-exclusive games that joined Steam
   * later). We accept the top match only when the normalized title is an
   * exact or prefix match to avoid linking the wrong app.
   */
  async findAppIdByName(name: string): Promise<number | null> {
    try {
      const { data } = await axios.get<
        { appid: string; name: string }[]
      >(
        `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`,
        { timeout: 15000 },
      );
      if (!Array.isArray(data) || data.length === 0) return null;
      const top = data[0];
      if (!this.titleMatches(name, top.name)) return null;
      const appId = Number(top.appid);
      return Number.isFinite(appId) ? appId : null;
    } catch (error) {
      this.logger.warn(`findAppIdByName failed for "${name}": ${error}`);
      return null;
    }
  }

  /**
   * Steam's public per-achievement global unlock percentages, computed by
   * Valve over the entire Steam playerbase (not a sample). No API key
   * required. Returns null if the app has no achievements or the call
   * fails. The achievement `apiName` is Valve's internal slug (e.g.
   * `ACH00`, `CHARMED`), not the localized display title.
   */
  async getGlobalAchievementPercentages(
    appId: number,
  ): Promise<Array<{ apiName: string; percent: number }> | null> {
    try {
      const { data } = await axios.get(
        'https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/',
        { params: { gameid: appId, format: 'json' }, timeout: 15000 },
      );
      const raw = data?.achievementpercentages?.achievements;
      if (!Array.isArray(raw) || raw.length === 0) return null;

      const parsed: Array<{ apiName: string; percent: number }> = [];
      for (const entry of raw as Array<{ name?: unknown; percent?: unknown }>) {
        const apiName = typeof entry.name === 'string' ? entry.name : null;
        const percent = Number(entry.percent);
        if (!apiName || !Number.isFinite(percent) || percent < 0 || percent > 100) {
          continue;
        }
        parsed.push({ apiName, percent });
      }
      return parsed.length > 0 ? parsed : null;
    } catch (error) {
      this.logger.warn(
        `getGlobalAchievementPercentages failed for ${appId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Current number of concurrent players on Steam, via the public
   * `ISteamUserStats/GetNumberOfCurrentPlayers` endpoint. No API key
   * required. Polled daily to maintain a `STEAM_CONCURRENT` time series and
   * a running `STEAM_PEAK_CCU` peak per game. The peak CCU is a second,
   * largely independent signal of installed base used to tighten the
   * Boxleiter-based PC estimate via range intersection.
   */
  async getCurrentPlayerCount(appId: number): Promise<number | null> {
    try {
      const { data } = await axios.get(
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
        { params: { appid: appId, format: 'json' }, timeout: 15000 },
      );
      const players = data?.response?.player_count;
      if (typeof players !== 'number' || !Number.isFinite(players) || players < 0) {
        return null;
      }
      return players;
    } catch (error) {
      this.logger.warn(`getCurrentPlayerCount failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Total number of Steam reviews. This is the core signal for the Boxleiter
   * estimation method.
   */
  async getTotalReviews(appId: number): Promise<number | null> {
    try {
      const { data } = await axios.get(
        `https://store.steampowered.com/appreviews/${appId}`,
        {
          params: {
            json: 1,
            language: 'all',
            purchase_type: 'all',
            num_per_page: 0,
          },
          timeout: 15000,
        },
      );

      const total = data?.query_summary?.total_reviews;
      return typeof total === 'number' ? total : null;
    } catch (error) {
      this.logger.warn(`getTotalReviews failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Reconstruct the game's full review history from the public `appreviews`
   * endpoint. Steam doesn't expose a cumulative time series, but it does
   * return every individual review (with its creation timestamp and verdict)
   * when paginated chronologically via the `cursor` token. We aggregate those
   * into per-UTC-day counts of new positive/negative reviews; the caller turns
   * that into a cumulative series.
   *
   * This is the legitimate, API-only equivalent of the SteamDB review-chart
   * CSV (which we can't scrape behind Cloudflare). Deleted reviews are absent
   * from the API, so the reconstructed totals can run slightly below SteamDB's
   * live-recorded history, but the curve shape is faithful.
   *
   * `appreviews` shares the store's ~200 req/5 min IP rate limit, so pages are
   * throttled and retried on 429. Pagination stops when Steam returns no more
   * reviews or repeats a cursor; `maxPages` is a safety ceiling against loops.
   */
  async fetchReviewHistory(
    appId: number,
    options: { throttleMs?: number; maxPages?: number } = {},
  ): Promise<SteamReviewHistory | null> {
    const throttleMs = options.throttleMs ?? 700;
    const maxPages = options.maxPages ?? 5000;

    const daily = new Map<string, { positive: number; negative: number }>();
    const seenCursors = new Set<string>();
    let cursor = '*';
    let reportedTotal: number | null = null;
    let totalFetched = 0;
    let pages = 0;

    while (pages < maxPages) {
      let data: any;
      try {
        data = await this.getStoreJson(
          `https://store.steampowered.com/appreviews/${appId}`,
          {
            json: 1,
            filter: 'recent',
            language: 'all',
            purchase_type: 'all',
            review_type: 'all',
            num_per_page: 100,
            cursor,
          },
        );
      } catch (error) {
        this.logger.warn(
          `fetchReviewHistory page ${pages + 1} failed for ${appId}: ${error}`,
        );
        break;
      }

      if (pages === 0) {
        const summaryTotal = data?.query_summary?.total_reviews;
        reportedTotal =
          typeof summaryTotal === 'number' ? summaryTotal : null;
      }

      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) break;

      for (const review of reviews as Array<{
        timestamp_created?: unknown;
        voted_up?: unknown;
      }>) {
        const ts = Number(review.timestamp_created);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const day = new Date(ts * 1000).toISOString().slice(0, 10);
        const bucket = daily.get(day) ?? { positive: 0, negative: 0 };
        if (review.voted_up === true) bucket.positive += 1;
        else bucket.negative += 1;
        daily.set(day, bucket);
        totalFetched += 1;
      }

      const nextCursor =
        typeof data?.cursor === 'string' ? data.cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      pages += 1;

      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
    }

    if (daily.size === 0) return null;

    const sorted = Array.from(daily.entries())
      .map(([day, counts]) => ({ day, ...counts }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return { daily: sorted, totalFetched, reportedTotal };
  }

  /**
   * GET a Steam store endpoint with a small retry on HTTP 429. The store
   * `appdetails` / `appreviews` APIs are aggressively rate-limited (~200
   * requests / 5 min per IP); on 429 we back off and retry a couple of times
   * before letting the error propagate to the caller's try/catch.
   */
  private async getStoreJson(
    url: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await axios.get(url, { params, timeout: 15000 });
        return data;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 429 && attempt < maxAttempts) {
          const backoffMs = attempt * 5000;
          this.logger.warn(
            `Steam 429 on ${url} (attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  private parseReleaseDate(raw?: string): Date | null {
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Map Steam's `price_overview` block to `SteamPrice`. `initial`/`final` are
   * already in minor units (cents). Returns null when the block is absent
   * (free or unpriced apps) or malformed.
   */
  private parsePrice(raw: unknown): SteamPrice | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as {
      currency?: unknown;
      initial?: unknown;
      final?: unknown;
      discount_percent?: unknown;
    };
    const currency = typeof p.currency === 'string' ? p.currency : null;
    const initial = Number(p.initial);
    const final = Number(p.final);
    if (!currency || !Number.isFinite(initial) || !Number.isFinite(final)) {
      return null;
    }
    const discountPercent = Number(p.discount_percent);
    return {
      currency,
      initial,
      final,
      discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    };
  }

  // Accept when one normalized title is a prefix of the other (Steam store
  // names carry edition/year suffixes), with a minimum overlap to avoid noise.
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
}

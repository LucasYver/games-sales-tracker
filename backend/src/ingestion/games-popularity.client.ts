import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const BASE_URL = 'https://games-popularity.com/swagger/api/game';

// Safety cap on cursor pagination so a runaway/looping cursor can never spin
// forever. 1000 points/page × 60 pages = 60k points, far beyond the provider's
// ~2024-03 history depth for any real game.
const MAX_PAGES = 60;

// Politeness delay between paginated requests to the same free API.
const PAGE_THROTTLE_MS = 120;

// Wait used after a 429 when the provider sends no usable Retry-After.
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * The provider answered 429. Callers must stop or wait, never treat it as
 * "no data": swallowing it stamped a success on every game and froze the
 * follower series from 2026-10-22. `retryAfterMs` comes from Retry-After.
 */
export class GamesPopularityRateLimitError extends HttpException {
  constructor(readonly retryAfterMs: number) {
    super(
      `games-popularity rate limit (retry after ${Math.round(retryAfterMs / 1000)}s)`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// A single normalized time-series point: an integer value at a UTC instant.
export interface GamesPopularityPoint {
  value: number;
  capturedAt: Date;
}

// Raw per-endpoint response shape: `{ steamId, history: [...], nextCursor }`.
// Each history entry carries a metric-specific numeric key plus `added`.
interface RawHistoryResponse {
  steamId?: string;
  history?: Array<Record<string, unknown>>;
  nextCursor?: string | null;
}

/**
 * Client for games-popularity.com — a free third-party tracker that has
 * recorded Steam followers, live players, price and reviews for the whole
 * catalogue since ~2024-03. We use it as a BACKFILL source for followers (a
 * signal we don't otherwise collect); price is available optionally. It is a
 * forward-tracker, NOT a launch-depth archive: history bottoms out at the
 * provider's collection start (~2024-03), so pre-2024 games only get their
 * recent trajectory, not their launch ramp. Do NOT use it to replace our native
 * review/CCU backfills, which reach launch.
 *
 * Disabled (returns null) when no API key is configured. An uncovered app
 * (404) returns null. A 429 throws GamesPopularityRateLimitError; any other
 * failure on the first page throws, so the ingestion state records it.
 */
@Injectable()
export class GamesPopularityClient {
  private readonly logger = new Logger(GamesPopularityClient.name);
  private readonly apiKey: string | null;
  // Rate-limit headers are logged once per process to measure the quota.
  private rateLimitHeadersLogged = false;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GAMES_POPULARITY_API_KEY') ?? null;
    if (!this.apiKey) {
      this.logger.warn(
        'GAMES_POPULARITY_API_KEY not set: follower backfill will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Follower-count history for a Steam app (community-group member count).
   * `fullHistory` pages back to the provider's floor; otherwise only the first
   * (most recent) page is fetched.
   */
  async fetchFollowerHistory(
    appId: number,
    options: { fullHistory?: boolean } = {},
  ): Promise<GamesPopularityPoint[] | null> {
    return this.fetchHistory('followers', appId, 'followers', options);
  }

  /**
   * Price history (final price, in the provider's tracking currency). Values
   * are decimal (e.g. 6.24) — callers convert to their storage unit. Reserved
   * for a future price backfill; not wired into ingestion yet.
   */
  async fetchPriceHistory(
    appId: number,
    options: { fullHistory?: boolean } = {},
  ): Promise<GamesPopularityPoint[] | null> {
    return this.fetchHistory('price', appId, 'price', options);
  }

  /**
   * Shared cursor-paginated fetch. Returns the accumulated points (possibly
   * empty), or null when the provider does not cover the app (404). Throws on
   * 429 and on any other first-page failure; a later-page failure keeps what
   * was fetched. Points are returned newest-first (as the API does); callers
   * bucket/normalize as needed.
   */
  private async fetchHistory(
    endpoint: string,
    appId: number,
    valueKey: string,
    options: { fullHistory?: boolean },
  ): Promise<GamesPopularityPoint[] | null> {
    if (!this.apiKey) return null;

    const points: GamesPopularityPoint[] = [];
    let cursor: string | null = null;
    let page = 0;

    do {
      let data: RawHistoryResponse;
      try {
        const response = await axios.get<RawHistoryResponse>(
          `${BASE_URL}/${endpoint}/${appId}`,
          {
            params: {
              apiKey: this.apiKey,
              ...(cursor ? { cursor } : {}),
            },
            timeout: 20000,
          },
        );
        data = response.data;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 429) {
          const headers = axios.isAxiosError(error)
            ? (error.response?.headers ?? {})
            : {};
          if (!this.rateLimitHeadersLogged) {
            this.rateLimitHeadersLogged = true;
            const rateHeaders = Object.entries(headers)
              .filter(([k]) => /rate|retry|limit|quota/i.test(k))
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(', ');
            this.logger.warn(
              `429 on ${endpoint} for app ${appId}; headers: ${rateHeaders || 'none'}`,
            );
          }
          throw new GamesPopularityRateLimitError(
            this.retryAfterMs(headers['retry-after']),
          );
        }
        if (status === 404) return page === 0 ? null : points;
        this.logger.warn(
          `fetch ${endpoint} failed for app ${appId} (page ${page}): ${error}`,
        );
        // Nothing usable on the first page: let the caller record the error.
        // On a later page, keep what we have.
        if (page === 0) throw error;
        return points;
      }

      const history = Array.isArray(data.history) ? data.history : [];
      for (const entry of history) {
        const rawValue = entry[valueKey];
        const rawDate = entry['added'];
        const value = Number(rawValue);
        const capturedAt =
          typeof rawDate === 'string' ? new Date(rawDate) : new Date(NaN);
        if (!Number.isFinite(value) || Number.isNaN(capturedAt.getTime())) {
          continue;
        }
        points.push({ value, capturedAt });
      }

      cursor = options.fullHistory ? (data.nextCursor ?? null) : null;
      page += 1;

      if (cursor && page < MAX_PAGES) {
        await this.sleep(PAGE_THROTTLE_MS);
      }
    } while (cursor && page < MAX_PAGES);

    return points;
  }

  /** Retry-After is either seconds or an HTTP date. */
  private retryAfterMs(raw: unknown): number {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return DEFAULT_RETRY_AFTER_MS;
    }
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(String(raw));
    if (Number.isNaN(at)) return DEFAULT_RETRY_AFTER_MS;
    return Math.max(0, at - Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

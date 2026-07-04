import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const BASE_URL = 'https://games-popularity.com/swagger/api/game';

// Safety cap on cursor pagination so a runaway/looping cursor can never spin
// forever. 1000 points/page × 60 pages = 60k points, far beyond the provider's
// ~2024-03 history depth for any real game.
const MAX_PAGES = 60;

// Politeness delay between paginated requests to the same free API.
const PAGE_THROTTLE_MS = 120;

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
 * recorded Steam followers, top-seller rank, live players, price and reviews
 * for the whole catalogue since ~2024-03. We use it as a one-stop BACKFILL
 * source for the signals we don't already collect to launch depth (followers,
 * top-seller rank; price optionally). It is a forward-tracker, NOT a
 * launch-depth archive: history bottoms out at the provider's collection start
 * (~2024-03), so pre-2024 games only get their recent trajectory, not their
 * launch ramp. Do NOT use it to replace our native review/CCU backfills, which
 * reach launch.
 *
 * Disabled (returns null) when no API key is configured. Every call is
 * best-effort: a network/parse failure logs a warning and returns null.
 */
@Injectable()
export class GamesPopularityClient {
  private readonly logger = new Logger(GamesPopularityClient.name);
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GAMES_POPULARITY_API_KEY') ?? null;
    if (!this.apiKey) {
      this.logger.warn(
        'GAMES_POPULARITY_API_KEY not set: follower / top-seller-rank ' +
          'backfill will be skipped.',
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
   * Top-seller chart-position history (revenue-ranked; lower = better).
   * Only the days a game actually charted are present.
   */
  async fetchTopSellerRankHistory(
    appId: number,
    options: { fullHistory?: boolean } = {},
  ): Promise<GamesPopularityPoint[] | null> {
    return this.fetchHistory('top-sellers', appId, 'position', options);
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
   * empty when the game is uncovered) on success, or null on the first-page
   * network/parse failure. Points are returned newest-first (as the API does);
   * callers bucket/normalize as needed.
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
        // A hard failure on the very first page means we got nothing usable;
        // signal that to the caller. On a later page, keep what we have.
        this.logger.warn(
          `fetch ${endpoint} failed for app ${appId} (page ${page}): ${error}`,
        );
        return page === 0 ? null : points;
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

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

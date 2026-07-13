import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const HELIX_BASE = 'https://api.twitch.tv/helix';
const OAUTH_URL = 'https://id.twitch.tv/oauth2/token';

// Max streams per page allowed by Helix.
const PAGE_SIZE = 100;

// How many stream pages to sum per game. Helix returns streams sorted by
// viewer_count descending and exposes no aggregate total, so we sum the top
// N pages. Twitch itself recommends this approach; the long tail of tiny
// streams (0-2 viewers) is negligible, so a handful of pages yields a total
// within ~1-2% of the true figure for a tiny fraction of the API cost of
// walking every page. 5 pages = top 500 live streams.
const MAX_STREAM_PAGES = 5;

// Politeness delay between paginated stream requests for the same game.
const PAGE_THROTTLE_MS = 100;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
}

interface HelixGame {
  id: string;
  name: string;
}

interface HelixStream {
  viewer_count?: number;
}

interface HelixResponse<T> {
  data?: T[];
  pagination?: { cursor?: string };
}

/**
 * Client for the Twitch Helix API. Reuses the IGDB app credentials
 * (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET) — IGDB auth already goes through
 * Twitch OAuth, so the same client-credentials token works for Helix.
 *
 * Twitch removed all server-side aggregate counters, so a game's total
 * concurrent viewers must be computed by summing the `viewer_count` of its
 * live streams via {@link getTotalViewers}. Every call is best-effort: a
 * network/auth failure logs a warning and returns null.
 */
@Injectable()
export class TwitchClient {
  private readonly logger = new Logger(TwitchClient.name);
  private token: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('IGDB_CLIENT_ID') &&
      this.config.get<string>('IGDB_CLIENT_SECRET'),
    );
  }

  /**
   * Resolve a Twitch game (directory) id from a game name. Twitch matches the
   * exact display name, so this can miss when Twitch labels a title
   * differently from Steam/IGDB (editions, subtitles); callers treat null as
   * "no Twitch mapping". Returns the resolved id + Twitch's canonical name.
   */
  async resolveGameId(
    name: string,
  ): Promise<{ id: string; name: string } | null> {
    if (!this.isConfigured()) return null;

    const games = await this.helixGet<HelixGame>('/games', { name });
    if (games === null || games.length === 0) return null;
    const first = games[0];
    return { id: first.id, name: first.name };
  }

  /**
   * Total concurrent viewers across the top {@link MAX_STREAM_PAGES} pages of
   * live streams for a Twitch game id. Returns the summed viewer count plus how
   * many streams contributed, or null when the first page fails (so callers can
   * distinguish "0 live viewers" from "fetch failed"). A game with no live
   * streams legitimately returns `{ viewers: 0, streams: 0 }`.
   */
  async getTotalViewers(
    gameId: string,
  ): Promise<{ viewers: number; streams: number } | null> {
    if (!this.isConfigured()) return null;

    let viewers = 0;
    let streams = 0;
    let cursor: string | undefined;
    let page = 0;

    do {
      const response = await this.helixGetRaw<HelixStream>('/streams', {
        game_id: gameId,
        first: String(PAGE_SIZE),
        ...(cursor ? { after: cursor } : {}),
      });
      // First-page failure = nothing usable; a later-page failure keeps the
      // partial sum already accumulated from earlier pages.
      if (response === null) return page === 0 ? null : { viewers, streams };

      for (const stream of response.data ?? []) {
        const count = Number(stream.viewer_count);
        if (Number.isFinite(count)) {
          viewers += count;
          streams += 1;
        }
      }

      cursor = response.pagination?.cursor;
      page += 1;

      // Stop early once a page comes back short: no further streams exist.
      if ((response.data?.length ?? 0) < PAGE_SIZE) break;
      if (cursor && page < MAX_STREAM_PAGES) await this.sleep(PAGE_THROTTLE_MS);
    } while (cursor && page < MAX_STREAM_PAGES);

    return { viewers, streams };
  }

  // ───── internals ────────────────────────────────────────────────────────

  private async helixGet<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[] | null> {
    const response = await this.helixGetRaw<T>(path, params);
    return response ? (response.data ?? []) : null;
  }

  private async helixGetRaw<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<HelixResponse<T> | null> {
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;

    try {
      const token = await this.getAccessToken();
      const { data } = await axios.get<HelixResponse<T>>(
        `${HELIX_BASE}${path}`,
        {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`,
          },
          params,
          timeout: 15000,
        },
      );
      return data;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.warn(
        `Twitch Helix ${path} failed (params=${JSON.stringify(params)}): ${detail}`,
      );
      return null;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const clientSecret = this.config.get<string>('IGDB_CLIENT_SECRET')!;

    const { data } = await axios.post<OAuthTokenResponse>(OAUTH_URL, null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      },
      timeout: 15000,
    });

    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Platform } from '../entities';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_DISCOVERY_MAX_PAGES,
  IGDB_DISCOVERY_PAGE_SIZE,
  IGDB_MIN_RATING_COUNT,
  IGDB_PLATFORM_IDS,
  IGDB_PRE_FLOOR_MIN_RATING_COUNT,
  IGDB_RECENT_LIMIT,
  RECENT_WINDOW_DAYS,
} from './discovery.constants';

export interface IgdbGame {
  igdbId: number;
  name: string;
  summary: string | null;
  releaseDate: Date | null;
  coverUrl: string | null;
  steamAppId: number | null;
  platforms: Platform[];
  developer: string | null;
  publisher: string | null;
  genres: string[];
  totalRatingCount: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Fields we always want when reading an IGDB game, kept in one place so the
// list stays consistent across search / lookup calls.
const IGDB_FIELDS = [
  'name',
  'summary',
  'first_release_date',
  'total_rating_count',
  'cover.image_id',
  'platforms.name',
  'external_games.external_game_source',
  'external_games.uid',
  'involved_companies.company.name',
  'involved_companies.developer',
  'involved_companies.publisher',
  'genres.name',
].join(', ');

// IGDB platform name (lowercased) → our internal Platform enum.
// Substring match: any IGDB platform whose name contains one of these tokens
// maps to the corresponding bucket. The Sony / Microsoft / Nintendo families
// are folded so PS4+PS5 both count as PLAYSTATION, etc.
// Switch / mobile are intentionally absent: we have no reliable sales signal
// for those platforms, so we never map a game onto them.
const PLATFORM_TOKENS: ReadonlyArray<[string, Platform]> = [
  ['windows', Platform.PC],
  ['mac', Platform.PC],
  ['linux', Platform.PC],
  ['steam', Platform.PC],
  ['playstation', Platform.PLAYSTATION],
  ['ps vita', Platform.PLAYSTATION],
  ['psp', Platform.PLAYSTATION],
  ['xbox', Platform.XBOX],
];

@Injectable()
export class IgdbClient {
  private readonly logger = new Logger(IgdbClient.name);
  private token: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('IGDB_CLIENT_ID') &&
        this.config.get<string>('IGDB_CLIENT_SECRET'),
    );
  }

  /**
   * Search IGDB games by name. Used to populate the catalog and resolve the
   * pivot id + linked Steam app id when available.
   */
  async searchGames(query: string, limit = 10): Promise<IgdbGame[]> {
    if (!this.isConfigured()) {
      this.logger.warn('IGDB credentials are not configured; skipping search.');
      return [];
    }

    const body = [
      `search "${query.replace(/"/g, '')}";`,
      `fields ${IGDB_FIELDS};`,
      `limit ${limit};`,
    ].join(' ');

    return this.queryGames(body);
  }

  /**
   * Look up the single IGDB game linked to a given Steam app id. Two-step:
   * IGDB doesn't allow filtering /games by a nested external_games property,
   * so we hit /external_games first to resolve the game id, then fetch the
   * full record from /games.
   */
  async findBySteamAppId(steamAppId: number): Promise<IgdbGame | null> {
    if (!this.isConfigured()) return null;

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const headers = {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    };

    // Step 1: find the external_game row for this Steam app id and read its
    // game id. external_game_source = 1 = Steam (the old `category` field was
    // renamed). UID is stored as a string so it must be quoted.
    const externalBody = [
      `where external_game_source = 1 & uid = "${steamAppId}";`,
      'fields game;',
      'limit 1;',
    ].join(' ');

    let gameId: number | null = null;
    try {
      const { data } = await axios.post(
        'https://api.igdb.com/v4/external_games',
        externalBody,
        { headers, timeout: 15000 },
      );
      const rows = data as { game?: number }[];
      gameId = rows[0]?.game ?? null;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.warn(
        `IGDB /external_games lookup failed for steam=${steamAppId}: ${detail}`,
      );
      return null;
    }
    if (gameId == null) return null;

    // Step 2: full game record by id.
    const gameBody = [
      `where id = ${gameId};`,
      `fields ${IGDB_FIELDS};`,
      'limit 1;',
    ].join(' ');
    const results = await this.queryGames(gameBody);
    return results[0] ?? null;
  }

  /**
   * Discover catalog candidates from IGDB, deduplicated by IGDB id. Combines:
   *   A — established hits released since the date floor, ranked by popularity;
   *   B — landmark pre-floor classics (only the very biggest);
   *   C — fresh releases, regardless of IGDB rating (admitted downstream via
   *       the live Steam review signal).
   * Caller applies the final admission rule (IGDB rating OR Steam reviews).
   */
  async discoverCandidates(): Promise<IgdbGame[]> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'IGDB credentials are not configured; skipping discovery.',
      );
      return [];
    }

    const platforms = IGDB_PLATFORM_IDS.join(',');
    const floorUnix = Math.floor(DISCOVERY_RELEASE_FLOOR.getTime() / 1000);
    const recentUnix = Math.floor(
      (Date.now() - RECENT_WINDOW_DAYS * 24 * 3600 * 1000) / 1000,
    );

    const byId = new Map<number, IgdbGame>();
    const add = (games: IgdbGame[]) => {
      for (const g of games) if (!byId.has(g.igdbId)) byId.set(g.igdbId, g);
    };

    // A — established hits since the date floor, ranked by popularity.
    // `game_type = 0` is "main game" (the old `category` field was removed).
    for (let page = 0; page < IGDB_DISCOVERY_MAX_PAGES; page++) {
      const body = [
        `where game_type = 0 & total_rating_count >= ${IGDB_MIN_RATING_COUNT}`,
        `& first_release_date >= ${floorUnix} & platforms = (${platforms});`,
        `fields ${IGDB_FIELDS};`,
        `sort total_rating_count desc;`,
        `limit ${IGDB_DISCOVERY_PAGE_SIZE};`,
        `offset ${page * IGDB_DISCOVERY_PAGE_SIZE};`,
      ].join(' ');
      const games = await this.queryGames(body);
      add(games);
      if (games.length < IGDB_DISCOVERY_PAGE_SIZE) break;
    }

    // B — landmark pre-floor classics.
    for (let page = 0; page < IGDB_DISCOVERY_MAX_PAGES; page++) {
      const body = [
        `where game_type = 0 & total_rating_count >= ${IGDB_PRE_FLOOR_MIN_RATING_COUNT}`,
        `& first_release_date < ${floorUnix} & platforms = (${platforms});`,
        `fields ${IGDB_FIELDS};`,
        `sort total_rating_count desc;`,
        `limit ${IGDB_DISCOVERY_PAGE_SIZE};`,
        `offset ${page * IGDB_DISCOVERY_PAGE_SIZE};`,
      ].join(' ');
      const games = await this.queryGames(body);
      add(games);
      if (games.length < IGDB_DISCOVERY_PAGE_SIZE) break;
    }

    // C — fresh releases (rating bar skipped; Steam review signal decides).
    const recentBody = [
      `where game_type = 0 & first_release_date >= ${recentUnix}`,
      `& platforms = (${platforms});`,
      `fields ${IGDB_FIELDS};`,
      `sort first_release_date desc;`,
      `limit ${IGDB_RECENT_LIMIT};`,
    ].join(' ');
    add(await this.queryGames(recentBody));

    const all = [...byId.values()];
    this.logger.log(`IGDB discovery: ${all.length} unique candidate(s).`);
    return all;
  }

  /**
   * Best-effort match-by-name: returns the IGDB record whose name is closest
   * to `name`. Falls back to the first search hit when no name-equality match
   * is found. Returns null on no results or misconfiguration.
   */
  async findByName(name: string): Promise<IgdbGame | null> {
    const candidates = await this.searchGames(name, 5);
    if (candidates.length === 0) return null;

    const normalized = this.normalize(name);
    const exact = candidates.find((g) => this.normalize(g.name) === normalized);
    return exact ?? candidates[0];
  }

  // ───── internals ────────────────────────────────────────────────────────

  private async queryGames(body: string): Promise<IgdbGame[]> {
    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;

    try {
      const { data } = await axios.post('https://api.igdb.com/v4/games', body, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        timeout: 15000,
      });
      return (data as unknown[]).map((g) => this.mapGame(g));
    } catch (error) {
      // Surface the actual IGDB error body so 400s are debuggable rather than
      // hidden behind a generic axios message.
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(
        `IGDB /games query failed (body=${JSON.stringify(body)}): ${detail}`,
      );
      return [];
    }
  }

  private mapGame(raw: unknown): IgdbGame {
    const g = raw as Record<string, unknown> & {
      id: number;
      name: string;
      summary?: string;
      first_release_date?: number;
      total_rating_count?: number;
      cover?: { image_id?: string };
      platforms?: { name?: string }[];
      external_games?: { external_game_source?: number; uid?: string }[];
      involved_companies?: {
        company?: { name?: string };
        developer?: boolean;
        publisher?: boolean;
      }[];
      genres?: { name?: string }[];
    };

    // external_game_source = 1 identifies the Steam store entry (the old
    // `category` field was renamed). uid is the Steam app id.
    const steamExternal = (g.external_games ?? []).find(
      (e) => e.external_game_source === 1 && e.uid,
    );

    const platforms = this.mapPlatforms(g.platforms);

    const companies = g.involved_companies ?? [];
    const developer =
      companies.find((c) => c.developer && c.company?.name)?.company?.name ??
      null;
    const publisher =
      companies.find((c) => c.publisher && c.company?.name)?.company?.name ??
      null;

    const genres = (g.genres ?? [])
      .map((x) => x.name)
      .filter((n): n is string => Boolean(n));

    return {
      igdbId: g.id,
      name: g.name,
      summary: g.summary ?? null,
      releaseDate: g.first_release_date
        ? new Date(g.first_release_date * 1000)
        : null,
      coverUrl: g.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
        : null,
      steamAppId: steamExternal?.uid ? parseInt(steamExternal.uid, 10) : null,
      platforms,
      developer,
      publisher,
      genres,
      totalRatingCount:
        typeof g.total_rating_count === 'number' ? g.total_rating_count : 0,
    };
  }

  private mapPlatforms(
    raw: { name?: string }[] | undefined,
  ): Platform[] {
    if (!raw || raw.length === 0) return [];
    const set = new Set<Platform>();
    for (const entry of raw) {
      const name = entry.name?.toLowerCase();
      if (!name) continue;
      for (const [token, platform] of PLATFORM_TOKENS) {
        if (name.includes(token)) {
          set.add(platform);
          break;
        }
      }
    }
    return [...set];
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const clientSecret = this.config.get<string>('IGDB_CLIENT_SECRET')!;

    try {
      const { data } = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
          },
          timeout: 15000,
        },
      );

      this.token = {
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      return this.token.accessToken;
    } catch (error) {
      // Twitch returns 400 "invalid_client" when the client_id / secret pair
      // is rejected. The downstream caller will rethrow as a generic axios
      // error; this log makes the actual cause unambiguous.
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(
        `IGDB auth failed (check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in .env): ${detail}`,
      );
      throw error;
    }
  }
}

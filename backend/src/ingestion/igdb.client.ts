import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Platform } from '../entities';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_CATALOG_MIN_RATING_COUNT,
  IGDB_DISCOVERY_MAX_PAGES,
  IGDB_DISCOVERY_PAGE_SIZE,
  IGDB_PLATFORM_IDS,
  IGDB_PRE_FLOOR_MIN_RATING_COUNT,
  IGDB_RECENT_LIMIT,
  RECENT_WINDOW_DAYS,
} from './discovery.constants';

export interface IgdbGame {
  igdbId: number;
  name: string;
  // IGDB's own URL slug — the trailing segment of the canonical
  // `https://www.igdb.com/games/<slug>` page. Ours is derived from the name
  // and can diverge (collision suffixes, punctuation), so the link has to use
  // theirs to be trustworthy.
  slug: string | null;
  summary: string | null;
  releaseDate: Date | null;
  coverUrl: string | null;
  steamAppId: number | null;
  platforms: Platform[];
  developer: string | null;
  publisher: string | null;
  genres: string[];
  totalRatingCount: number;
  // Earliest launch date per our Platform bucket, e.g. a PlayStation launch
  // a year ahead of the PC port. Distinct from `releaseDate` above (the
  // earliest date across ALL platforms). Empty when IGDB has no
  // `release_dates` breakdown for this game.
  platformReleaseDates: Map<Platform, Date>;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
}

// Fields we always want when reading an IGDB game, kept in one place so the
// list stays consistent across search / lookup calls.
const IGDB_FIELDS = [
  'name',
  'slug',
  'summary',
  'first_release_date',
  'total_rating_count',
  'cover.image_id',
  'platforms.name',
  'release_dates.date',
  'release_dates.platform.name',
  'release_dates.status.name',
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

// IGDB `release_dates.status.name` values that are never a real release —
// skipped outright when bucketing per-platform dates.
const RELEASE_STATUS_EXCLUDE = new Set(['Cancelled', 'Rumored', 'Delisted']);

// Pre-release statuses: used only when a platform has no "Full Release" (or
// unstatused, which IGDB treats the same) entry to prefer instead.
const RELEASE_STATUS_PRERELEASE = new Set(['Early Access', 'Alpha', 'Beta']);

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
        `where game_type = 0 & total_rating_count >= ${IGDB_CATALOG_MIN_RATING_COUNT}`,
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
   * Resolve an IGDB game from its URL slug (the trailing segment of the
   * canonical `https://www.igdb.com/games/<slug>` page).
   */
  async findBySlug(slug: string): Promise<IgdbGame | null> {
    if (!this.isConfigured()) return null;

    const safeSlug = slug.replace(/"/g, '').trim();
    if (!safeSlug) return null;

    const body = [
      `where slug = "${safeSlug}";`,
      `fields ${IGDB_FIELDS};`,
      'limit 1;',
    ].join(' ');

    const results = await this.queryGames(body);
    return results[0] ?? null;
  }

  /**
   * Resolve an IGDB game from its numeric id.
   */
  async findById(id: number): Promise<IgdbGame | null> {
    if (!this.isConfigured()) return null;

    const body = [
      `where id = ${id};`,
      `fields ${IGDB_FIELDS};`,
      'limit 1;',
    ].join(' ');

    const results = await this.queryGames(body);
    return results[0] ?? null;
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

  /**
   * Fetch the entire IGDB genre catalog (typically ~25 entries).
   * Used by the admin `Sync IGDB` button to upsert any new genre we
   * haven't seen yet (no migration needed). Returns an empty array
   * when IGDB credentials are missing or the request fails — the
   * caller treats that as a no-op.
   */
  async fetchAllGenres(): Promise<
    Array<{ id: number; name: string; slug: string }>
  > {
    if (!this.isConfigured()) return [];

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;

    try {
      const { data } = await axios.post(
        'https://api.igdb.com/v4/genres',
        'fields id, name, slug; limit 500;',
        {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
          timeout: 15000,
        },
      );
      return (data as Array<{ id?: number; name?: string; slug?: string }>)
        .filter((g) => typeof g.id === 'number' && g.name && g.slug)
        .map((g) => ({ id: g.id!, name: g.name!, slug: g.slug! }));
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`IGDB /genres query failed: ${detail}`);
      return [];
    }
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
      slug?: string;
      summary?: string;
      first_release_date?: number;
      total_rating_count?: number;
      cover?: { image_id?: string };
      platforms?: { name?: string }[];
      release_dates?: {
        date?: number;
        platform?: { name?: string };
        status?: { name?: string };
      }[];
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
    const platformReleaseDates = this.mapReleaseDates(g.release_dates);

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
      slug: g.slug ?? null,
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
      platformReleaseDates,
    };
  }

  private mapPlatforms(raw: { name?: string }[] | undefined): Platform[] {
    if (!raw || raw.length === 0) return [];
    const set = new Set<Platform>();
    for (const entry of raw) {
      const platform = this.resolvePlatform(entry.name);
      if (platform) set.add(platform);
    }
    return [...set];
  }

  // Buckets IGDB's per-release-date-entry platform (e.g. "PS4", "PS5") into
  // our coarser Platform enum. Within a bucket, prefers a "Full Release" (or
  // unstatused, which IGDB uses for the same thing) entry over an Early
  // Access / Alpha / Beta one — e.g. Baldur's Gate 3 has a PC "Early Access"
  // row dated 2020-10-06 *and* a PC "Full Release" row dated 2023-08-03; we
  // want the latter, matching what a console "Full Release" date represents.
  // Only falls back to a pre-release entry when no full release exists yet.
  // Cancelled / rumored / delisted entries are never real releases and are
  // skipped outright. Ties within a tier keep the earliest date (regions).
  private mapReleaseDates(
    raw:
      | {
          date?: number;
          platform?: { name?: string };
          status?: { name?: string };
        }[]
      | undefined,
  ): Map<Platform, Date> {
    const best = new Map<Platform, { date: Date; tier: number }>();
    if (!raw || raw.length === 0) return new Map();

    for (const entry of raw) {
      if (!entry.date) continue;
      const platform = this.resolvePlatform(entry.platform?.name);
      if (!platform) continue;

      const status = entry.status?.name;
      if (status && RELEASE_STATUS_EXCLUDE.has(status)) continue;
      const tier = status && RELEASE_STATUS_PRERELEASE.has(status) ? 1 : 0;

      const date = new Date(entry.date * 1000);
      const existing = best.get(platform);
      if (
        !existing ||
        tier < existing.tier ||
        (tier === existing.tier && date < existing.date)
      ) {
        best.set(platform, { date, tier });
      }
    }

    const result = new Map<Platform, Date>();
    for (const [platform, { date }] of best) result.set(platform, date);
    return result;
  }

  private resolvePlatform(name: string | undefined): Platform | null {
    const lower = name?.toLowerCase();
    if (!lower) return null;
    for (const [token, platform] of PLATFORM_TOKENS) {
      if (lower.includes(token)) return platform;
    }
    return null;
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

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await axios.post<TwitchTokenResponse>(
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
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        // Twitch answers 4xx ("invalid_client") only when the id/secret pair is
        // actually rejected — retrying that is pointless. A 5xx or a bare
        // network failure is a Twitch-side outage, and losing it here costs the
        // whole daily discovery run, so those are worth a couple of retries.
        const isCredentialError = status !== undefined && status < 500;
        const retriable = axios.isAxiosError(error) && !isCredentialError;

        if (retriable && attempt < maxAttempts) {
          const backoffMs = attempt * 5000;
          this.logger.warn(
            `IGDB auth attempt ${attempt}/${maxAttempts} failed (status ${status ?? 'network'}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        const detail = axios.isAxiosError(error)
          ? JSON.stringify(error.response?.data ?? error.message)
          : String(error);
        this.logger.error(
          isCredentialError
            ? `IGDB auth rejected (check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in .env): ${detail}`
            : `IGDB auth failed after ${attempt} attempt(s), Twitch unreachable or erroring: ${detail}`,
        );
        throw error;
      }
    }

    throw new Error('IGDB auth failed: retries exhausted.');
  }
}

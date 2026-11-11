import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Platform } from '../entities';
import {
  pickCompanies,
  type IgdbInvolvedCompany,
} from '../games/game-companies';
import type { IgdbSeriesFields } from '../games/game-series';
import {
  gameModesFromIgdb,
  gameTypeFromIgdb,
  type GameMode,
  type GameType,
  type TimeToBeat,
} from '../games/igdb-facts';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_CATALOG_MIN_RATING_COUNT,
  IGDB_DISCOVERY_MAX_PAGES,
  IGDB_DISCOVERY_PAGE_SIZE,
  IGDB_PLATFORM_IDS,
  IGDB_RECENT_LIMIT,
  IGDB_UPCOMING_LIMIT,
  RECENT_WINDOW_DAYS,
  UPCOMING_WINDOW_DAYS,
} from './discovery.constants';
import { XBOX_PRODUCT_ID_RE } from './xbox-catalog.client';

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
  // IGDB's credit (see `games/game-companies.ts`), without a store name to
  // break ties. `companies` lets a caller that has one pick again.
  developer: string | null;
  publisher: string | null;
  companies: IgdbInvolvedCompany[];
  genres: string[];
  totalRatingCount: number;
  // Earliest launch date per our Platform bucket, e.g. a PlayStation launch
  // a year ahead of the PC port. Distinct from `releaseDate` above (the
  // earliest date across ALL platforms). Empty when IGDB has no
  // `release_dates` breakdown for this game.
  platformReleaseDates: Map<Platform, Date>;
  // IGDB gives each commercial edition ("Deluxe Edition", "GOTY Edition") its
  // own record that points at the base game through `version_parent`. The
  // lookups below return the base game, so an edition never becomes a second
  // catalog entry; `editionOf` then keeps the id of the edition that was
  // actually matched (a Steam app sold only as "Deluxe Edition", say).
  versionParentId: number | null;
  editionOf: number | null;
}

/** What the nightly IGDB refresh reads for a game already in the catalog. */
export interface IgdbRefreshFields {
  series: IgdbSeriesFields;
  companies: IgdbInvolvedCompany[];
  /** IGDB's first release date, across every platform it knows. */
  firstReleaseDate: Date | null;
  /** Earliest launch per platform bucket, same rule as `platformReleaseDates`. */
  platformReleaseDates: Map<Platform, Date>;
  /** Release kind (`game_type`), null when IGDB gives an unknown one. */
  gameType: GameType | null;
  /** The game a remake, remaster, port or expansion comes from. */
  parentGame: { igdbId: number; name: string } | null;
  gameModes: GameMode[];
}

/** A commercial edition of a game, as IGDB lists it under `version_parent`. */
export interface IgdbEdition {
  igdbId: number;
  parentId: number;
  name: string;
  versionTitle: string | null;
  releaseDate: Date | null;
}

/** Console store products IGDB links to a game (see `fetchStoreIds`). */
export interface IgdbStoreIds {
  /** PlayStation Store concept ids (`store.playstation.com/en-us/concept/<id>`). */
  playstation: string[];
  /** Xbox Store product ids, upper case (`9NCJSXWZTP88`). */
  xbox: string[];
  /** Epic Games Store page, or null. */
  epicUrl: string | null;
  /** GOG page, or null. */
  gogUrl: string | null;
  /** Listed in the Xbox Game Pass Ultimate cloud catalog. */
  gamePassCloud: boolean;
}

// IGDB `external_game_sources` ids (checked live on 2026-11-07).
const IGDB_SOURCE_GOG = 5;
const IGDB_SOURCE_MICROSOFT = 11;
const IGDB_SOURCE_EPIC = 26;
const IGDB_SOURCE_PLAYSTATION_US = 36;
const IGDB_SOURCE_GAME_PASS_CLOUD = 54;
const IGDB_STORE_SOURCES = [
  IGDB_SOURCE_GOG,
  IGDB_SOURCE_MICROSOFT,
  IGDB_SOURCE_EPIC,
  IGDB_SOURCE_PLAYSTATION_US,
  IGDB_SOURCE_GAME_PASS_CLOUD,
];

/** An http(s) store page URL, or null for anything else. */
function storePageUrl(url: string | undefined, host: RegExp): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol) || !host.test(parsed.hostname)) {
      return null;
    }
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return null;
  }
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
  'external_games.name',
  'involved_companies.company.name',
  'involved_companies.developer',
  'involved_companies.publisher',
  'involved_companies.porting',
  'involved_companies.supporting',
  'genres.name',
  'version_parent',
].join(', ');

// Steam apps that accompany a game rather than being the game itself. Matched
// against the store name IGDB reports for an `external_games` entry.
const STEAM_COMPANION_APP_PATTERN =
  /\b(playtest|demo|beta|alpha|test(ing)? server|dedicated server|soundtrack|ost|art ?book|trailer|benchmark|closed test|open test|public test)\b/i;

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

// Test phases: used only when a platform has no Early Access, "Full Release"
// (or unstatused, which IGDB treats the same) entry to prefer instead.
const RELEASE_STATUS_PRERELEASE = new Set(['Alpha', 'Beta']);

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

    const results = await this.resolveEditions(await this.queryGames(body));
    // An edition and its base game can both match; keep the base game once.
    const seen = new Set<number>();
    return results.filter((g) => !seen.has(g.igdbId) && seen.add(g.igdbId));
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
    return results[0] ? this.resolveEdition(results[0]) : null;
  }

  /**
   * Discover catalog candidates from IGDB, deduplicated by IGDB id. Combines:
   *   A — established hits released since the date floor, ranked by popularity;
   *   B — fresh releases, regardless of IGDB rating (admitted downstream via
   *       the live Steam review signal);
   *   C — unreleased games inside the upcoming window, ranked by IGDB follows.
   * Pre-2012 titles are never candidates. Caller applies the final admission
   * rule (IGDB rating, Steam reviews, or an upcoming release date).
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
    const nowUnix = Math.floor(Date.now() / 1000);
    const recentUnix = Math.floor(
      (Date.now() - RECENT_WINDOW_DAYS * 24 * 3600 * 1000) / 1000,
    );
    const upcomingUnix = Math.floor(
      (Date.now() + UPCOMING_WINDOW_DAYS * 24 * 3600 * 1000) / 1000,
    );

    const byId = new Map<number, IgdbGame>();
    const add = (games: IgdbGame[]) => {
      for (const g of games) if (!byId.has(g.igdbId)) byId.set(g.igdbId, g);
    };

    // A — established hits since the date floor, ranked by popularity.
    // `game_type = 0` is "main game" (the old `category` field was removed).
    // Commercial editions are main games too; `version_parent = null` drops
    // them, since each one points at a base game discovered on its own.
    for (let page = 0; page < IGDB_DISCOVERY_MAX_PAGES; page++) {
      const body = [
        `where game_type = 0 & version_parent = null & total_rating_count >= ${IGDB_CATALOG_MIN_RATING_COUNT}`,
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

    // B — fresh releases (rating bar skipped; Steam review signal decides).
    const recentBody = [
      `where game_type = 0 & version_parent = null & first_release_date >= ${recentUnix}`,
      `& platforms = (${platforms});`,
      `fields ${IGDB_FIELDS};`,
      `sort first_release_date desc;`,
      `limit ${IGDB_RECENT_LIMIT};`,
    ].join(' ');
    add(await this.queryGames(recentBody));

    // C — unreleased games. `hypes` is IGDB's pre-release follow count, the
    // only popularity signal available before ratings and reviews exist.
    const upcomingBody = [
      `where game_type = 0 & version_parent = null & first_release_date >= ${nowUnix}`,
      `& first_release_date <= ${upcomingUnix}`,
      `& platforms = (${platforms});`,
      `fields ${IGDB_FIELDS}, hypes;`,
      `sort hypes desc;`,
      `limit ${IGDB_UPCOMING_LIMIT};`,
    ].join(' ');
    add(await this.queryGames(upcomingBody));

    const all = [...byId.values()];
    this.logger.log(`IGDB discovery: ${all.length} unique candidate(s).`);
    return all;
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
    return results[0] ? this.resolveEdition(results[0]) : null;
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

  /**
   * The fields the nightly refresh keeps current (series, credited companies,
   * release dates) for up to 500 games in one request, keyed by IGDB id. A
   * game IGDB does not return is absent from the map. Returns null when the
   * request fails, so the caller can tell a failure from "nothing on IGDB".
   */
  async fetchRefreshFields(
    igdbIds: number[],
  ): Promise<Map<number, IgdbRefreshFields> | null> {
    if (!this.isConfigured()) return null;
    const ids = igdbIds.filter((id) => Number.isInteger(id)).slice(0, 500);
    if (ids.length === 0) return new Map();

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const body = [
      `where id = (${ids.join(',')});`,
      [
        'fields collections.name, franchise.name, franchises.name,',
        'involved_companies.company.name, involved_companies.developer,',
        'involved_companies.publisher, involved_companies.porting,',
        'involved_companies.supporting, first_release_date,',
        'release_dates.date, release_dates.platform.name,',
        'release_dates.status.name, game_type, parent_game.name,',
        'game_modes.slug;',
      ].join(' '),
      `limit ${ids.length};`,
    ].join(' ');

    type Named = { name?: string };
    type Involved = {
      company?: Named;
      developer?: boolean;
      publisher?: boolean;
      porting?: boolean;
      supporting?: boolean;
    };
    try {
      const { data } = await axios.post('https://api.igdb.com/v4/games', body, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        timeout: 30000,
      });
      const names = (list: Named[] | undefined) =>
        (list ?? [])
          .map((entry) => entry.name?.trim())
          .filter((name): name is string => Boolean(name));
      const fields = new Map<number, IgdbRefreshFields>();
      for (const raw of data as Array<{
        id: number;
        collections?: Named[];
        franchise?: Named;
        franchises?: Named[];
        involved_companies?: Involved[];
        first_release_date?: number;
        release_dates?: {
          date?: number;
          platform?: Named;
          status?: Named;
        }[];
        game_type?: number;
        parent_game?: { id?: number; name?: string };
        game_modes?: { slug?: string }[];
      }>) {
        const parentName = raw.parent_game?.name?.trim();
        fields.set(raw.id, {
          series: {
            collections: names(raw.collections),
            franchise: raw.franchise?.name?.trim() || null,
            franchises: names(raw.franchises),
          },
          companies: (raw.involved_companies ?? [])
            .filter((c) => c.company?.name?.trim())
            .map((c) => ({
              name: (c.company?.name as string).trim(),
              developer: Boolean(c.developer),
              publisher: Boolean(c.publisher),
              porting: Boolean(c.porting),
              supporting: Boolean(c.supporting),
            })),
          firstReleaseDate: raw.first_release_date
            ? new Date(raw.first_release_date * 1000)
            : null,
          platformReleaseDates: this.mapReleaseDates(raw.release_dates),
          gameType: gameTypeFromIgdb(raw.game_type),
          parentGame:
            typeof raw.parent_game?.id === 'number' && parentName
              ? { igdbId: raw.parent_game.id, name: parentName }
              : null,
          gameModes: gameModesFromIgdb(
            (raw.game_modes ?? []).map((mode) => mode.slug),
          ),
        });
      }
      return fields;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`IGDB refresh query failed: ${detail}`);
      return null;
    }
  }

  /**
   * The commercial editions of up to 500 games, keyed by base game IGDB id. A
   * game with none is absent from the map. Returns null when a request
   * fails, so the caller can tell a failure from "no editions".
   */
  async fetchEditions(
    igdbIds: number[],
  ): Promise<Map<number, IgdbEdition[]> | null> {
    if (!this.isConfigured()) return null;
    const ids = igdbIds.filter((id) => Number.isInteger(id)).slice(0, 500);
    const editions = new Map<number, IgdbEdition[]>();
    if (ids.length === 0) return editions;

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const pageSize = 500;
    try {
      // A few games have dozens of editions: page until IGDB runs out.
      for (let offset = 0; ; offset += pageSize) {
        const { data } = await axios.post(
          'https://api.igdb.com/v4/games',
          [
            `where version_parent = (${ids.join(',')});`,
            'fields name, version_parent, version_title, first_release_date;',
            'sort id asc;',
            `limit ${pageSize};`,
            `offset ${offset};`,
          ].join(' '),
          {
            headers: {
              'Client-ID': clientId,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'text/plain',
            },
            timeout: 30000,
          },
        );
        const rows = data as Array<{
          id: number;
          name?: string;
          version_parent?: number;
          version_title?: string;
          first_release_date?: number;
        }>;
        for (const row of rows) {
          if (typeof row.version_parent !== 'number' || !row.name) continue;
          const list = editions.get(row.version_parent) ?? [];
          list.push({
            igdbId: row.id,
            parentId: row.version_parent,
            name: row.name.trim(),
            versionTitle: row.version_title?.trim() || null,
            releaseDate: row.first_release_date
              ? new Date(row.first_release_date * 1000)
              : null,
          });
          editions.set(row.version_parent, list);
        }
        if (rows.length < pageSize) break;
      }
      return editions;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`IGDB editions query failed: ${detail}`);
      return null;
    }
  }

  /**
   * The console store products IGDB links to up to 500 games, keyed by IGDB
   * id: PlayStation Store concept ids and Xbox Store product ids. A game with
   * neither is absent from the map. Returns null when a request fails, so the
   * caller can tell a failure from "no store links".
   *
   * Console ids come from 36 (PlayStation Store US, uid = concept id) and 11
   * (Microsoft, uid = 12-character Store product id). Source 11 also holds
   * Xbox 360 Marketplace GUIDs, and 31 only those: both are skipped by the id
   * check. Epic (26) and GOG (5) give their store page URL; Game Pass cloud
   * (54) is read as presence only. A game IGDB lists only as Epic, GOG or
   * Game Pass is in the map too.
   */
  async fetchStoreIds(
    igdbIds: number[],
  ): Promise<Map<number, IgdbStoreIds> | null> {
    if (!this.isConfigured()) return null;
    const ids = igdbIds.filter((id) => Number.isInteger(id)).slice(0, 500);
    const stores = new Map<number, IgdbStoreIds>();
    if (ids.length === 0) return stores;

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const pageSize = 500;
    try {
      for (let offset = 0; ; offset += pageSize) {
        const { data } = await axios.post<unknown>(
          'https://api.igdb.com/v4/external_games',
          [
            `where game = (${ids.join(',')})`,
            `& external_game_source = (${IGDB_STORE_SOURCES.join(',')});`,
            'fields game, external_game_source, uid, url;',
            'sort id asc;',
            `limit ${pageSize};`,
            `offset ${offset};`,
          ].join(' '),
          {
            headers: {
              'Client-ID': clientId,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'text/plain',
            },
            timeout: 30000,
          },
        );
        const rows = data as Array<{
          game?: number;
          external_game_source?: number;
          uid?: string;
          url?: string;
        }>;
        for (const row of rows) {
          const uid = row.uid?.trim();
          if (typeof row.game !== 'number') continue;
          const entry = stores.get(row.game) ?? {
            playstation: [],
            xbox: [],
            epicUrl: null,
            gogUrl: null,
            gamePassCloud: false,
          };
          if (row.external_game_source === IGDB_SOURCE_GAME_PASS_CLOUD) {
            entry.gamePassCloud = true;
          } else if (row.external_game_source === IGDB_SOURCE_EPIC) {
            // IGDB keeps an old `epicgames.com/store/p/...` URL next to the
            // current `store.epicgames.com` one: the current one wins.
            const url = storePageUrl(row.url, /(^|\.)epicgames\.com$/);
            if (url && (!entry.epicUrl || /store\.epicgames\.com/.test(url))) {
              entry.epicUrl = url;
            }
          } else if (row.external_game_source === IGDB_SOURCE_GOG) {
            entry.gogUrl ??= storePageUrl(row.url, /(^|\.)gog\.com$/);
          } else if (!uid) {
            continue;
          } else if (
            row.external_game_source === IGDB_SOURCE_PLAYSTATION_US &&
            /^\d+$/.test(uid) &&
            !entry.playstation.includes(uid)
          ) {
            entry.playstation.push(uid);
          } else if (
            row.external_game_source === IGDB_SOURCE_MICROSOFT &&
            XBOX_PRODUCT_ID_RE.test(uid) &&
            !entry.xbox.includes(uid.toUpperCase())
          ) {
            entry.xbox.push(uid.toUpperCase());
          } else {
            continue;
          }
          stores.set(row.game, entry);
        }
        if (rows.length < pageSize) break;
      }
      return stores;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`IGDB store links query failed: ${detail}`);
      return null;
    }
  }

  /**
   * Player-reported completion times (`game_time_to_beats`, in seconds) for
   * up to 500 games, keyed by IGDB id. IGDB keeps one row per game; a game
   * with none is absent from the map. Returns null when the request fails.
   */
  async fetchTimeToBeat(
    igdbIds: number[],
  ): Promise<Map<number, TimeToBeat> | null> {
    if (!this.isConfigured()) return null;
    const ids = igdbIds.filter((id) => Number.isInteger(id)).slice(0, 500);
    const times = new Map<number, TimeToBeat>();
    if (ids.length === 0) return times;

    const token = await this.getAccessToken();
    const clientId = this.config.get<string>('IGDB_CLIENT_ID')!;
    const seconds = (value: unknown) =>
      typeof value === 'number' && value > 0 ? Math.round(value) : null;
    try {
      const { data } = await axios.post<unknown>(
        'https://api.igdb.com/v4/game_time_to_beats',
        [
          `where game_id = (${ids.join(',')});`,
          'fields game_id, hastily, normally, completely, count;',
          `limit 500;`,
        ].join(' '),
        {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
          timeout: 30000,
        },
      );
      for (const row of data as Array<{
        game_id?: number;
        hastily?: number;
        normally?: number;
        completely?: number;
        count?: number;
      }>) {
        if (typeof row.game_id !== 'number') continue;
        const time: TimeToBeat = {
          hastily: seconds(row.hastily),
          normally: seconds(row.normally),
          completely: seconds(row.completely),
          count: typeof row.count === 'number' ? row.count : 0,
        };
        if (!time.hastily && !time.normally && !time.completely) continue;
        times.set(row.game_id, time);
      }
      return times;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`IGDB time-to-beat query failed: ${detail}`);
      return null;
    }
  }

  // ───── internals ────────────────────────────────────────────────────────

  /**
   * The base game of an IGDB edition, or the game itself when it is not one.
   * Falls back to the edition when the parent cannot be read, so a failed
   * request never loses the match.
   */
  private async resolveEdition(game: IgdbGame): Promise<IgdbGame> {
    const [resolved] = await this.resolveEditions([game]);
    return resolved;
  }

  /** {@link resolveEdition} for a list, with one request for every parent. */
  private async resolveEditions(games: IgdbGame[]): Promise<IgdbGame[]> {
    const parentIds = [
      ...new Set(
        games
          .map((g) => g.versionParentId)
          .filter((id): id is number => id != null),
      ),
    ];
    if (parentIds.length === 0) return games;

    const parents = await this.queryGames(
      [
        `where id = (${parentIds.join(',')});`,
        `fields ${IGDB_FIELDS};`,
        `limit ${parentIds.length};`,
      ].join(' '),
    );
    const byId = new Map(parents.map((p) => [p.igdbId, p]));
    return games.map((g) => {
      const parent =
        g.versionParentId != null ? byId.get(g.versionParentId) : undefined;
      if (!parent) return g;
      // The edition's own Steam app is the one that matched; keep it when the
      // base game lists none.
      return {
        ...parent,
        steamAppId: parent.steamAppId ?? g.steamAppId,
        editionOf: g.igdbId,
      };
    });
  }

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
      external_games?: {
        external_game_source?: number;
        uid?: string;
        name?: string;
      }[];
      involved_companies?: {
        company?: { name?: string };
        developer?: boolean;
        publisher?: boolean;
        porting?: boolean;
        supporting?: boolean;
      }[];
      genres?: { name?: string }[];
      version_parent?: number;
    };

    // external_game_source = 1 identifies the Steam store entry (the old
    // `category` field was renamed). uid is the Steam app id.
    const steamAppId = this.pickSteamAppId(
      g.name,
      (g.external_games ?? []).filter(
        (
          e,
        ): e is { external_game_source: number; uid: string; name?: string } =>
          e.external_game_source === 1 && Boolean(e.uid),
      ),
    );

    const platforms = this.mapPlatforms(g.platforms);
    const platformReleaseDates = this.mapReleaseDates(g.release_dates);

    const companies: IgdbInvolvedCompany[] = (g.involved_companies ?? [])
      .filter((c) => c.company?.name?.trim())
      .map((c) => ({
        name: (c.company?.name as string).trim(),
        developer: Boolean(c.developer),
        publisher: Boolean(c.publisher),
        porting: Boolean(c.porting),
        supporting: Boolean(c.supporting),
      }));
    const { developer, publisher } = pickCompanies(companies, {
      developer: null,
      publisher: null,
    });

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
      steamAppId,
      platforms,
      developer,
      publisher,
      companies,
      genres,
      totalRatingCount:
        typeof g.total_rating_count === 'number' ? g.total_rating_count : 0,
      platformReleaseDates,
      versionParentId:
        typeof g.version_parent === 'number' ? g.version_parent : null,
      editionOf: null,
    };
  }

  /**
   * IGDB often lists several Steam apps for one game: the store page plus its
   * playtest, demo or dedicated-server app. Array order is not meaningful, so
   * taking the first entry can link the game to an app that has a handful of
   * reviews and no concurrent-player data at all. Prefer the entry whose store
   * name matches the game, then any non-companion app, and only fall back to
   * the first entry when every candidate looks like a companion app.
   */
  private pickSteamAppId(
    gameName: string,
    entries: { uid: string; name?: string }[],
  ): number | null {
    if (entries.length === 0) return null;

    const usable = entries.filter((e) => Number.isFinite(Number(e.uid)));
    if (usable.length === 0) return null;

    const isCompanion = (name: string | undefined): boolean =>
      name !== undefined && STEAM_COMPANION_APP_PATTERN.test(name);
    const normalize = (value: string): string =>
      value.toLowerCase().replace(/[^a-z0-9]/g, '');

    const target = normalize(gameName);
    const exact = usable.find(
      (e) => e.name !== undefined && normalize(e.name) === target,
    );
    const standalone = usable.find((e) => !isCompanion(e.name));

    return Number((exact ?? standalone ?? usable[0]).uid);
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
  // our coarser Platform enum. Within a bucket, keeps the earliest date among
  // Early Access, "Full Release" and unstatused entries (IGDB uses the last two
  // for the same thing), because sales start with Early Access — e.g. Baldur's
  // Gate 3 has a PC "Early Access" row dated 2020-10-06 *and* a PC "Full
  // Release" row dated 2023-08-03; we want the former. Falling on a 1.0 date
  // makes a game on sale for years look unreleased to the estimates.
  // Only falls back to an Alpha / Beta entry when nothing else exists yet.
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

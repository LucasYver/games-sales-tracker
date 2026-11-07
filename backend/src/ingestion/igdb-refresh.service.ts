import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  Game,
  GameEdition,
  GamePlatformReleaseDate,
  Platform,
} from '../entities';
import { resolveCompanies } from '../games/game-companies';
import { pickSeriesName, seriesSlug } from '../games/game-series';
import {
  igdbEarliestRelease,
  nextReleaseDate,
  releaseDatesMayMove,
} from '../games/release-date-refresh';
import { DevelopersService } from '../developers/developers.service';
import { PublishersService } from '../publishers/publishers.service';
import { IgdbClient } from './igdb.client';

/** Games read per nightly run. IGDB answers 500 per request. */
const GAMES_PER_RUN = 2000;
const IGDB_BATCH = 500;

type Grouping = {
  seriesSlug: string | null;
  seriesName: string | null;
  developer: string | null;
  publisher: string | null;
};

/**
 * Keeps a game's IGDB-backed fields current after ingestion: how IGDB groups
 * it (series for the franchise pages; developer and publisher, read
 * everywhere, see `games/game-companies.ts`) and, until it
 * launches, its release dates (`releaseDate` and per platform, see
 * `games/release-date-refresh.ts`). Each nightly run takes the games checked
 * longest ago (never checked first), so the whole catalog is covered in a
 * few nights and then re-read in turn.
 */
@Injectable()
export class IgdbRefreshService {
  private readonly logger = new Logger(IgdbRefreshService.name);

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(GamePlatformReleaseDate)
    private readonly platformDates: Repository<GamePlatformReleaseDate>,
    @InjectRepository(GameEdition)
    private readonly editions: Repository<GameEdition>,
    private readonly igdb: IgdbClient,
    private readonly publishers: PublishersService,
    private readonly developers: DevelopersService,
  ) {}

  async refreshFromIgdb(limit = GAMES_PER_RUN): Promise<{
    checked: number;
    groupingChanged: number;
    releaseDatesMoved: number;
    platformDatesChanged: number;
    editions: number;
    storeLinks: number;
    timesToBeat: number;
  }> {
    const result = {
      checked: 0,
      groupingChanged: 0,
      releaseDatesMoved: 0,
      platformDatesChanged: 0,
      editions: 0,
      storeLinks: 0,
      timesToBeat: 0,
    };
    if (!this.igdb.isConfigured()) return result;

    const games = await this.games.find({
      where: { igdbId: Not(IsNull()) },
      select: {
        id: true,
        name: true,
        igdbId: true,
        developer: true,
        publisher: true,
        releaseDate: true,
        steamDeveloper: true,
        steamPublisher: true,
        publisherId: true,
        developerId: true,
        manualFields: true,
        seriesSlug: true,
        seriesName: true,
      },
      order: {
        igdbCheckedAt: { direction: 'ASC', nulls: 'FIRST' },
        id: 'ASC',
      },
      take: limit,
    });

    const now = new Date();
    for (let start = 0; start < games.length; start += IGDB_BATCH) {
      const batch = games.slice(start, start + IGDB_BATCH);
      const fetched = await this.igdb.fetchRefreshFields(
        batch.map((game) => game.igdbId as number),
      );
      // A failed request leaves the batch unchecked, so the next run retries it.
      if (!fetched) break;

      const unreleased = new Set<string>();
      const rows = batch.map((game) => {
        const igdb = fetched.get(game.igdbId as number);
        const name = igdb ? pickSeriesName(game.name, igdb.series) : null;
        const slug = name ? seriesSlug(name) || null : null;
        // A game IGDB no longer returns credits nobody: the store names apply.
        const companies = resolveCompanies(game, igdb?.companies ?? []);
        const grouping: Grouping = {
          seriesSlug: slug,
          seriesName: slug ? name : null,
          developer: companies.developer,
          publisher: companies.publisher,
        };
        if (
          (Object.keys(grouping) as (keyof Grouping)[]).some(
            (key) => grouping[key] !== game[key],
          )
        ) {
          result.groupingChanged += 1;
        }
        // An admin-set date is never touched, per platform either.
        const igdbRelease =
          igdb && !game.manualFields?.includes('releaseDate')
            ? igdbEarliestRelease(
                igdb.platformReleaseDates.values(),
                igdb.firstReleaseDate,
              )
            : null;
        if (
          igdbRelease &&
          releaseDatesMayMove(game.releaseDate, igdbRelease, now)
        ) {
          unreleased.add(game.id);
        }
        const releaseDate = nextReleaseDate(game.releaseDate, igdbRelease, now);
        if (releaseDate) {
          result.releaseDatesMoved += 1;
          this.logger.log(
            `[igdb-refresh] "${game.name}" release date ${game.releaseDate?.toISOString().slice(0, 10) ?? 'none'} -> ${releaseDate.toISOString().slice(0, 10)}`,
          );
        }
        return {
          id: game.id,
          ...grouping,
          releaseDate,
          gameType: igdb?.gameType ?? null,
          parentId: igdb?.parentGame?.igdbId ?? null,
          parentName: igdb?.parentGame?.name ?? null,
          gameModes: igdb?.gameModes.length ? igdb.gameModes : null,
        };
      });

      await this.games.query(
        `UPDATE game AS g
         SET "seriesSlug" = v.series_slug, "seriesName" = v.series_name,
             "developer" = v.developer, "publisher" = v.publisher,
             "releaseDate" = COALESCE(v.release_date, g."releaseDate"),
             "gameType" = v.game_type,
             "igdbParentGameId" = v.parent_id,
             "igdbParentGameName" = v.parent_name,
             "gameModes" = v.game_modes::text[],
             "igdbCheckedAt" = now()
         FROM unnest($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[],
                     $5::varchar[], $6::timestamptz[], $7::varchar[],
                     $8::int[], $9::varchar[], $10::text[])
           AS v(id, series_slug, series_name, developer, publisher,
                release_date, game_type, parent_id, parent_name, game_modes)
         WHERE g.id = v.id`,
        [
          rows.map((r) => r.id),
          rows.map((r) => r.seriesSlug),
          rows.map((r) => r.seriesName),
          rows.map((r) => r.developer),
          rows.map((r) => r.publisher),
          rows.map((r) => r.releaseDate),
          rows.map((r) => r.gameType),
          rows.map((r) => r.parentId),
          rows.map((r) => r.parentName),
          // One array literal per game: unnest cannot take a ragged 2-D array.
          rows.map((r) => (r.gameModes ? `{${r.gameModes.join(',')}}` : null)),
        ],
      );

      // A new company name gets its row and the game its link.
      await this.publishers.linkGames(
        rows.map((r, i) => ({
          id: r.id,
          publisher: r.publisher,
          publisherId: batch[i].publisherId,
        })),
      );
      await this.developers.linkGames(
        rows.map((r, i) => ({
          id: r.id,
          developer: r.developer,
          developerId: batch[i].developerId,
        })),
      );

      result.platformDatesChanged += await this.syncPlatformDates(
        batch.filter((game) => unreleased.has(game.id)),
        fetched,
      );
      result.editions += await this.syncEditions(batch);
      result.storeLinks += await this.syncStoreIds(batch);
      result.timesToBeat += await this.syncTimeToBeat(batch);
      result.checked += batch.length;
    }

    this.logger.log(
      `IGDB refresh: ${result.checked} game(s) checked, ${result.groupingChanged} regrouped, ${result.releaseDatesMoved} release date(s) moved, ${result.platformDatesChanged} platform date set(s) rewritten, ${result.editions} edition(s) listed, ${result.storeLinks} game(s) with a store link, ${result.timesToBeat} with a time to beat.`,
    );
    return result;
  }

  /**
   * Rewrites the editions of the batch's games from IGDB (one request for
   * the batch). A failed request keeps the stored rows, so a game never loses
   * its editions to a transient error. Returns the editions now listed.
   */
  private async syncEditions(batch: Game[]): Promise<number> {
    const byParent = await this.igdb.fetchEditions(
      batch.map((game) => game.igdbId as number),
    );
    if (!byParent) return 0;
    const rows = batch.flatMap((game) =>
      (byParent.get(game.igdbId as number) ?? []).map((e) => ({
        igdbId: e.igdbId,
        gameId: game.id,
        name: e.name,
        versionTitle: e.versionTitle,
        releaseDate: e.releaseDate,
      })),
    );
    await this.editions.manager.transaction(async (manager) => {
      await manager.delete(GameEdition, {
        gameId: In(batch.map((game) => game.id)),
      });
      // An edition id is unique on IGDB: an upsert only guards a row still
      // held by a game outside this batch.
      if (rows.length > 0) await manager.upsert(GameEdition, rows, ['igdbId']);
    });
    return rows.length;
  }

  /**
   * Rewrites the store links IGDB gives for the batch's games (one request
   * for the batch): the console products the store lookup tries before it
   * searches, the Epic and GOG pages and Game Pass cloud presence. A failed
   * request keeps the stored values. Returns the games with at least one.
   */
  private async syncStoreIds(batch: Game[]): Promise<number> {
    const byGame = await this.igdb.fetchStoreIds(
      batch.map((game) => game.igdbId as number),
    );
    if (!byGame) return 0;
    const links = batch.map((game) => byGame.get(game.igdbId as number));
    const asArray = (ids: string[] | undefined) =>
      ids && ids.length > 0 ? `{${ids.join(',')}}` : null;
    await this.games.query(
      `UPDATE game AS g
       SET "igdbPsConceptIds" = v.ps::text[],
           "igdbXboxProductIds" = v.xbox::text[],
           "igdbEpicUrl" = v.epic,
           "igdbGogUrl" = v.gog,
           "igdbGamePassCloud" = v.game_pass
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::varchar[],
                   $5::varchar[], $6::boolean[])
         AS v(id, ps, xbox, epic, gog, game_pass)
       WHERE g.id = v.id`,
      [
        batch.map((game) => game.id),
        links.map((link) => asArray(link?.playstation)),
        links.map((link) => asArray(link?.xbox)),
        links.map((link) => link?.epicUrl ?? null),
        links.map((link) => link?.gogUrl ?? null),
        links.map((link) => link?.gamePassCloud ?? false),
      ],
    );
    return links.filter(
      (link) =>
        link &&
        (link.playstation.length > 0 ||
          link.xbox.length > 0 ||
          link.epicUrl ||
          link.gogUrl ||
          link.gamePassCloud),
    ).length;
  }

  /**
   * Rewrites the batch's player-reported times to beat (one request for the
   * batch). A failed request keeps the stored values; a game IGDB has none
   * for is cleared. Returns the games with one.
   */
  private async syncTimeToBeat(batch: Game[]): Promise<number> {
    const byGame = await this.igdb.fetchTimeToBeat(
      batch.map((game) => game.igdbId as number),
    );
    if (!byGame) return 0;
    const times = batch.map((game) => byGame.get(game.igdbId as number));
    await this.games.query(
      `UPDATE game AS g
       SET "timeToBeat" = v.time
       FROM unnest($1::uuid[], $2::jsonb[]) AS v(id, time)
       WHERE g.id = v.id`,
      [
        batch.map((game) => game.id),
        times.map((time) => (time ? JSON.stringify(time) : null)),
      ],
    );
    return times.filter(Boolean).length;
  }

  /**
   * Rewrites the per-platform dates of the given games (those not launched
   * yet) whose IGDB breakdown changed, in one read for the batch. A game IGDB
   * returns with no breakdown keeps the rows it has, as at ingestion.
   */
  private async syncPlatformDates(
    batch: Game[],
    fetched: Map<number, { platformReleaseDates: Map<Platform, Date> }>,
  ): Promise<number> {
    if (batch.length === 0) return 0;
    const stored = await this.platformDates.find({
      where: { gameId: In(batch.map((game) => game.id)) },
    });
    const storedByGame = new Map<string, Map<Platform, number>>();
    for (const row of stored) {
      const dates = storedByGame.get(row.gameId) ?? new Map<Platform, number>();
      dates.set(row.platform, row.releaseDate.getTime());
      storedByGame.set(row.gameId, dates);
    }

    let changed = 0;
    for (const game of batch) {
      const next = fetched.get(game.igdbId as number)?.platformReleaseDates;
      if (!next || next.size === 0) continue;
      const current = storedByGame.get(game.id) ?? new Map<Platform, number>();
      const same =
        current.size === next.size &&
        [...next].every(
          ([platform, date]) => current.get(platform) === date.getTime(),
        );
      if (same) continue;

      const platforms = [...next.keys()];
      await this.platformDates.delete({
        gameId: game.id,
        platform: Not(In(platforms)),
      });
      await this.platformDates.upsert(
        platforms.map((platform) => ({
          gameId: game.id,
          platform,
          releaseDate: next.get(platform) as Date,
        })),
        ['gameId', 'platform'],
      );
      changed += 1;
    }
    return changed;
  }
}

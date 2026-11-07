import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Game } from '../entities';
import { pickCompanies } from '../games/game-companies';
import { pickSeriesName, seriesSlug } from '../games/game-series';
import { IgdbClient } from './igdb.client';

/** Games read per nightly run. IGDB answers 500 per request. */
const GAMES_PER_RUN = 2000;
const IGDB_BATCH = 500;

type Grouping = {
  seriesSlug: string | null;
  seriesName: string | null;
  igdbDeveloper: string | null;
  igdbPublisher: string | null;
};

/**
 * Keeps how IGDB groups each game (series, developer, publisher) up to date
 * for the public pages. Each nightly run takes the games checked longest ago
 * (never checked first), so the whole catalog is covered in a few nights and
 * then re-read in turn, which also picks up IGDB's own corrections.
 */
@Injectable()
export class IgdbGroupingService {
  private readonly logger = new Logger(IgdbGroupingService.name);

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    private readonly igdb: IgdbClient,
  ) {}

  async refreshGrouping(
    limit = GAMES_PER_RUN,
  ): Promise<{ checked: number; changed: number }> {
    if (!this.igdb.isConfigured()) return { checked: 0, changed: 0 };

    const games = await this.games.find({
      where: { igdbId: Not(IsNull()) },
      select: {
        id: true,
        name: true,
        igdbId: true,
        developer: true,
        publisher: true,
        seriesSlug: true,
        seriesName: true,
        igdbDeveloper: true,
        igdbPublisher: true,
      },
      order: {
        igdbCheckedAt: { direction: 'ASC', nulls: 'FIRST' },
        id: 'ASC',
      },
      take: limit,
    });

    let checked = 0;
    let changed = 0;
    for (let start = 0; start < games.length; start += IGDB_BATCH) {
      const batch = games.slice(start, start + IGDB_BATCH);
      const fetched = await this.igdb.fetchGrouping(
        batch.map((game) => game.igdbId as number),
      );
      // A failed request leaves the batch unchecked, so the next run retries it.
      if (!fetched) break;

      const rows = batch.map((game) => {
        const igdb = fetched.get(game.igdbId as number);
        const name = igdb ? pickSeriesName(game.name, igdb.series) : null;
        const slug = name ? seriesSlug(name) || null : null;
        const companies = pickCompanies(igdb?.companies ?? [], game);
        const next: Grouping = {
          seriesSlug: slug,
          seriesName: slug ? name : null,
          igdbDeveloper: companies.developer,
          igdbPublisher: companies.publisher,
        };
        if (
          (Object.keys(next) as (keyof Grouping)[]).some(
            (key) => next[key] !== game[key],
          )
        ) {
          changed += 1;
        }
        return { id: game.id, ...next };
      });

      await this.games.query(
        `UPDATE game AS g
         SET "seriesSlug" = v.series_slug, "seriesName" = v.series_name,
             "igdbDeveloper" = v.developer, "igdbPublisher" = v.publisher,
             "igdbCheckedAt" = now()
         FROM unnest($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[], $5::varchar[])
           AS v(id, series_slug, series_name, developer, publisher)
         WHERE g.id = v.id`,
        [
          rows.map((r) => r.id),
          rows.map((r) => r.seriesSlug),
          rows.map((r) => r.seriesName),
          rows.map((r) => r.igdbDeveloper),
          rows.map((r) => r.igdbPublisher),
        ],
      );
      checked += batch.length;
    }

    this.logger.log(
      `IGDB grouping: ${checked} game(s) checked, ${changed} changed.`,
    );
    return { checked, changed };
  }
}

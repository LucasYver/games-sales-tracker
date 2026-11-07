import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Developer, Game } from '../entities';
import { CompanyRegistry } from '../games/company-registry';

export interface DeveloperWithCount {
  id: string;
  name: string;
  gameCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeveloperDetail extends DeveloperWithCount {
  games: Array<{
    id: string;
    name: string;
    slug: string;
    releaseDate: Date | null;
    coverUrl: string | null;
  }>;
}

type GameDeveloper = {
  id: string;
  developer: string | null;
  developerId?: string | null;
};

/**
 * Registry of every studio a game names, one row per company, and the
 * `game.developerId` link that follows `game.developer` (see
 * `games/company-registry.ts`). The public studio pages group games by it.
 */
@Injectable()
export class DevelopersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevelopersService.name);
  private readonly registry: CompanyRegistry;

  constructor(
    @InjectRepository(Developer)
    private readonly developers: Repository<Developer>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
  ) {
    this.registry = new CompanyRegistry(
      (sql, params) => this.developers.query(sql, params),
      'developer',
      'developerId',
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    // Only games with a developer and no link: after the first run, the few
    // created since the last cold start.
    const unlinked = await this.games.query<GameDeveloper[]>(
      `SELECT id, developer FROM game
       WHERE "developerId" IS NULL AND NULLIF(trim(developer), '') IS NOT NULL`,
    );
    const linked = await this.linkGames(unlinked);
    if (linked > 0) this.logger.log(`Linked ${linked} game(s) to a developer.`);
  }

  /**
   * Point each game's `developerId` at the row of its `developer`, creating
   * the rows that are missing. A game without a developer loses its link.
   * Pass the current `developerId` to skip games already right. Returns the
   * number of games changed.
   */
  linkGames(games: GameDeveloper[]): Promise<number> {
    return this.registry.linkGames(
      games.map((g) => ({
        id: g.id,
        name: g.developer,
        linkedId: g.developerId,
      })),
    );
  }

  /** Link one game after an ingestion or an admin edit. */
  async resolveAndLink(
    gameId: string,
    developer: string | null,
  ): Promise<void> {
    await this.linkGames([{ id: gameId, developer }]);
  }

  /** Relink every game, for the admin button. */
  async backfillGameLinks(): Promise<{
    linked: number;
    alreadyLinked: number;
    unmatched: number;
  }> {
    const games = await this.games.query<GameDeveloper[]>(
      `SELECT id, developer, "developerId" FROM game`,
    );
    const linked = await this.linkGames(games);
    const unmatched = games.filter((g) => !g.developer?.trim()).length;
    return {
      linked,
      alreadyLinked: games.length - linked - unmatched,
      unmatched,
    };
  }

  async list(): Promise<DeveloperWithCount[]> {
    const rows = await this.developers.query<
      (Omit<DeveloperWithCount, 'gameCount'> & { gameCount: string })[]
    >(
      `SELECT d.id, d.name, d."createdAt", d."updatedAt",
              COUNT(g.id) AS "gameCount"
       FROM developer d
       LEFT JOIN game g ON g."developerId" = d.id AND g."deletedAt" IS NULL
       GROUP BY d.id
       ORDER BY COUNT(g.id) DESC, d.name`,
    );
    return rows.map((row) => ({ ...row, gameCount: Number(row.gameCount) }));
  }

  async getDetail(id: string): Promise<DeveloperDetail> {
    const row = await this.developers.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Developer ${id} not found`);

    const games = await this.games.find({
      where: { developerId: id },
      select: ['id', 'name', 'slug', 'releaseDate', 'coverUrl'],
      order: { releaseDate: 'DESC' },
    });

    return {
      id: row.id,
      name: row.name,
      gameCount: games.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      games: games.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        releaseDate: g.releaseDate,
        coverUrl: g.coverUrl,
      })),
    };
  }
}

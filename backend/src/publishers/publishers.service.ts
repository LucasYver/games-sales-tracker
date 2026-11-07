import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Game, Publisher } from '../entities';
import { CompanyRegistry } from '../games/company-registry';
import {
  PUBLISHER_HEURISTICS,
  findPublisherHeuristic,
} from './publishers.seed';

export interface PublisherWithCount {
  id: string;
  name: string;
  gameCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublisherDetail extends PublisherWithCount {
  games: Array<{
    id: string;
    name: string;
    slug: string;
    releaseDate: Date | null;
    coverUrl: string | null;
  }>;
}

type GamePublisher = {
  id: string;
  publisher: string | null;
  publisherId?: string | null;
};

/**
 * Registry of every publisher a game names, one row per company, and the
 * `game.publisherId` link that follows `game.publisher` (see
 * `games/company-registry.ts`). A name matching a curated heuristic
 * (`publishers.seed.ts`) joins that curated row, so renamed companies stay one
 * publisher (Sony Computer Entertainment and Sony Interactive Entertainment).
 */
@Injectable()
export class PublishersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PublishersService.name);
  private readonly registry: CompanyRegistry;

  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
  ) {
    this.registry = new CompanyRegistry(
      (sql, params) => this.publishers.query(sql, params),
      'publisher',
      'publisherId',
      (name) => findPublisherHeuristic(name)?.name ?? name,
      new Set(PUBLISHER_HEURISTICS.map((h) => h.name)),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedCanonical();
    // Only games with a publisher and no link: after the first run, the few
    // created since the last cold start.
    const unlinked = await this.games.query<GamePublisher[]>(
      `SELECT id, publisher FROM game
       WHERE "publisherId" IS NULL AND NULLIF(trim(publisher), '') IS NOT NULL`,
    );
    const linked = await this.linkGames(unlinked);
    if (linked > 0) this.logger.log(`Linked ${linked} game(s) to a publisher.`);
  }

  /**
   * Insert a curated `Publisher` row for every heuristic in
   * `publishers.seed.ts` that is missing from the table. Existing rows
   * are left untouched.
   */
  async seedCanonical(): Promise<void> {
    const existing = await this.publishers.find({ select: ['name'] });
    const names = new Set(existing.map((p) => p.name.toLowerCase()));
    const missing = PUBLISHER_HEURISTICS.filter(
      (h) => !names.has(h.name.toLowerCase()),
    );
    if (missing.length === 0) return;
    await this.registry.insertNames(missing.map((h) => h.name));
    this.logger.log(`Seeded ${missing.length} curated publisher(s).`);
  }

  /**
   * Point each game's `publisherId` at the row of its `publisher`, creating
   * the rows that are missing. A game without a publisher loses its link.
   * Pass the current `publisherId` to skip games already right. Returns the
   * number of games changed.
   */
  linkGames(games: GamePublisher[]): Promise<number> {
    return this.registry.linkGames(
      games.map((g) => ({
        id: g.id,
        name: g.publisher,
        linkedId: g.publisherId,
      })),
    );
  }

  /** Link one game after an ingestion or an admin edit. */
  async resolveAndLink(
    gameId: string,
    rawPublisher: string | null,
  ): Promise<void> {
    await this.linkGames([{ id: gameId, publisher: rawPublisher }]);
  }

  /** Relink every game, for the admin button. */
  async backfillGameLinks(): Promise<{
    linked: number;
    alreadyLinked: number;
    unmatched: number;
  }> {
    const games = await this.games.query<GamePublisher[]>(
      `SELECT id, publisher, "publisherId" FROM game`,
    );
    const linked = await this.linkGames(games);
    const unmatched = games.filter((g) => !g.publisher?.trim()).length;
    return {
      linked,
      alreadyLinked: games.length - linked - unmatched,
      unmatched,
    };
  }

  async list(): Promise<PublisherWithCount[]> {
    const rows = await this.publishers.query<
      (Omit<PublisherWithCount, 'gameCount'> & { gameCount: string })[]
    >(
      `SELECT p.id, p.name, p."createdAt", p."updatedAt",
              COUNT(g.id) AS "gameCount"
       FROM publisher p
       LEFT JOIN game g ON g."publisherId" = p.id AND g."deletedAt" IS NULL
       GROUP BY p.id
       ORDER BY COUNT(g.id) DESC, p.name`,
    );
    return rows.map((row) => ({ ...row, gameCount: Number(row.gameCount) }));
  }

  async getDetail(id: string): Promise<PublisherDetail> {
    const row = await this.publishers.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Publisher ${id} not found`);

    const games = await this.games.find({
      where: { publisherId: id },
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

  async findByIds(ids: string[]): Promise<Map<string, Publisher>> {
    if (ids.length === 0) return new Map();
    const rows = await this.publishers.find({ where: { id: In(ids) } });
    return new Map(rows.map((r) => [r.id, r]));
  }
}

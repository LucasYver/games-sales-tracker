import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Game, Publisher } from '../entities';
import { companyKey } from '../games/game-companies';
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

/** How long an instance trusts its copy of the registry. */
const REGISTRY_TTL_MS = 10 * 60 * 1000;

/**
 * Registry of every publisher a game names, one row per company, and the
 * `game.publisherId` link that follows `game.publisher`. A name matching a
 * curated heuristic (`publishers.seed.ts`) joins that curated row, so renamed
 * companies stay one publisher (Sony Computer Entertainment and Sony
 * Interactive Entertainment). Any other name gets its own row the first time a
 * game names it, and spellings of one company share it (see `companyKey`).
 */
@Injectable()
export class PublishersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PublishersService.name);
  private registry: { byKey: Map<string, string>; loadedAt: number } | null =
    null;

  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
  ) {}

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
    await this.insertNames(missing.map((h) => h.name));
    this.registry = null;
    this.logger.log(`Seeded ${missing.length} curated publisher(s).`);
  }

  /**
   * Point each game's `publisherId` at the row of its `publisher`, creating
   * the rows that are missing, in one insert and one update for the batch. A
   * game without a publisher loses its link. Pass the current `publisherId`
   * to skip games already right. Returns the number of games changed.
   */
  async linkGames(games: GamePublisher[]): Promise<number> {
    if (games.length === 0) return 0;
    const target = (raw: string | null): string | null => {
      const name = raw?.trim();
      if (!name) return null;
      return findPublisherHeuristic(name)?.name ?? name;
    };

    let byKey = await this.loadRegistry();
    const missing = new Map<string, string>();
    for (const game of games) {
      const name = target(game.publisher);
      if (!name) continue;
      const key = companyKey(name) || name.toLowerCase();
      if (!byKey.has(key) && !missing.has(key)) missing.set(key, name);
    }
    if (missing.size > 0) {
      await this.insertNames([...missing.values()]);
      byKey = await this.loadRegistry(true);
    }

    const ids: string[] = [];
    const publisherIds: (string | null)[] = [];
    for (const game of games) {
      const name = target(game.publisher);
      const id = name
        ? (byKey.get(companyKey(name) || name.toLowerCase()) ?? null)
        : null;
      if (game.publisherId !== undefined && game.publisherId === id) continue;
      ids.push(game.id);
      publisherIds.push(id);
    }
    if (ids.length === 0) return 0;
    await this.games.query(
      `UPDATE game AS g SET "publisherId" = v.publisher_id
       FROM unnest($1::uuid[], $2::uuid[]) AS v(id, publisher_id)
       WHERE g.id = v.id AND g."publisherId" IS DISTINCT FROM v.publisher_id`,
      [ids, publisherIds],
    );
    return ids.length;
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

  /** Row id by `companyKey` of its name. A curated name wins a shared key. */
  private async loadRegistry(force = false): Promise<Map<string, string>> {
    if (
      !force &&
      this.registry &&
      Date.now() - this.registry.loadedAt < REGISTRY_TTL_MS
    ) {
      return this.registry.byKey;
    }
    const rows = await this.publishers.find({ select: ['id', 'name'] });
    const curated = new Set(PUBLISHER_HEURISTICS.map((h) => h.name));
    const byKey = new Map<string, string>();
    for (const row of [...rows].sort(
      (a, b) => Number(curated.has(b.name)) - Number(curated.has(a.name)),
    )) {
      const key = companyKey(row.name) || row.name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, row.id);
    }
    this.registry = { byKey, loadedAt: Date.now() };
    return byKey;
  }

  private async insertNames(names: string[]): Promise<void> {
    await this.publishers.query(
      `INSERT INTO publisher (name)
       SELECT DISTINCT unnest($1::varchar[])
       ON CONFLICT (name) DO NOTHING`,
      [names],
    );
  }
}

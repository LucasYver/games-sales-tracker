import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Game, Publisher } from '../entities';
import {
  PUBLISHER_HEURISTICS,
  findPublisherHeuristic,
} from './publishers.seed';

export interface PublisherWithCount {
  id: string;
  name: string;
  steamSharePctLow: number;
  steamSharePctHigh: number;
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

@Injectable()
export class PublishersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PublishersService.name);

  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedCanonical();
    const result = await this.backfillGameLinks();
    this.logger.log(
      `Publisher backfill: ${result.linked} game(s) newly linked, ${result.alreadyLinked} already linked, ${result.unmatched} without a curated publisher.`,
    );
  }

  /**
   * Insert a curated `Publisher` row for every heuristic in
   * `publishers.seed.ts` that is missing from the table. Existing rows
   * are left untouched — in particular, admin-edited Steam-share values
   * are never overwritten by re-seeding.
   */
  async seedCanonical(): Promise<void> {
    const existing = await this.publishers.find();
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

    const missing = PUBLISHER_HEURISTICS.filter(
      (h) => !byName.has(h.name.toLowerCase()),
    );
    if (missing.length === 0) return;

    const rows = missing.map((h) =>
      this.publishers.create({
        name: h.name,
        steamSharePctLow: h.defaultSteamSharePctLow,
        steamSharePctHigh: h.defaultSteamSharePctHigh,
      }),
    );
    await this.publishers.save(rows);
    this.logger.log(`Seeded ${rows.length} curated publisher(s).`);
  }

  /**
   * Walk every game that has a raw publisher string but no `publisherId`
   * FK, and link it to a curated Publisher row when a heuristic matches.
   * Idempotent: games already linked are skipped, unmatched games stay
   * unlinked. Triggered automatically on boot and exposable as an admin
   * endpoint to re-run after editing heuristics or after a bulk import.
   */
  async backfillGameLinks(): Promise<{
    linked: number;
    alreadyLinked: number;
    unmatched: number;
  }> {
    const games = await this.games.find({
      where: { publisher: Not(IsNull()) },
      select: ['id', 'publisher', 'publisherId'],
    });

    let linked = 0;
    let alreadyLinked = 0;
    let unmatched = 0;

    for (const game of games) {
      if (game.publisherId) {
        alreadyLinked += 1;
        continue;
      }
      const heuristic = findPublisherHeuristic(game.publisher);
      if (!heuristic) {
        unmatched += 1;
        continue;
      }
      const row = await this.publishers.findOne({
        where: { name: heuristic.name },
      });
      if (!row) {
        unmatched += 1;
        continue;
      }
      await this.games.update(game.id, { publisherId: row.id });
      linked += 1;
    }

    return { linked, alreadyLinked, unmatched };
  }

  /**
   * Ensure `gameId` is linked to the right curated Publisher (if any).
   * Called from every ingestion path so newly-discovered games inherit
   * their publisher's profile immediately. No-op when the raw publisher
   * string matches no heuristic.
   */
  async resolveAndLink(
    gameId: string,
    rawPublisher: string | null,
  ): Promise<void> {
    const heuristic = findPublisherHeuristic(rawPublisher);
    if (!heuristic) {
      // If the game was previously linked but the publisher field has
      // since changed to something unmatched, we leave the existing link
      // alone — manual admin edits should not be silently undone.
      return;
    }
    const row = await this.publishers.findOne({
      where: { name: heuristic.name },
    });
    if (!row) return;

    const current = await this.games.findOne({
      where: { id: gameId },
      select: ['id', 'publisherId'],
    });
    if (!current || current.publisherId === row.id) return;
    await this.games.update(gameId, { publisherId: row.id });
  }

  async list(): Promise<PublisherWithCount[]> {
    const publishers = await this.publishers.find({
      order: { name: 'ASC' },
    });
    if (publishers.length === 0) return [];

    const counts = await this.games
      .createQueryBuilder('g')
      .select('g.publisherId', 'publisherId')
      .addSelect('COUNT(*)', 'count')
      .where('g.publisherId IN (:...ids)', {
        ids: publishers.map((p) => p.id),
      })
      .groupBy('g.publisherId')
      .getRawMany<{ publisherId: string; count: string }>();
    const byId = new Map(counts.map((c) => [c.publisherId, Number(c.count)]));

    return publishers.map((p) => ({
      id: p.id,
      name: p.name,
      steamSharePctLow: p.steamSharePctLow,
      steamSharePctHigh: p.steamSharePctHigh,
      gameCount: byId.get(p.id) ?? 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
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
      steamSharePctLow: row.steamSharePctLow,
      steamSharePctHigh: row.steamSharePctHigh,
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

  async update(
    id: string,
    patch: { steamSharePctLow?: number; steamSharePctHigh?: number },
  ): Promise<Publisher> {
    const row = await this.publishers.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Publisher ${id} not found`);

    let changed = false;
    if (
      patch.steamSharePctLow !== undefined &&
      patch.steamSharePctLow !== row.steamSharePctLow
    ) {
      row.steamSharePctLow = patch.steamSharePctLow;
      changed = true;
    }
    if (
      patch.steamSharePctHigh !== undefined &&
      patch.steamSharePctHigh !== row.steamSharePctHigh
    ) {
      row.steamSharePctHigh = patch.steamSharePctHigh;
      changed = true;
    }
    if (row.steamSharePctLow > row.steamSharePctHigh) {
      throw new BadRequestException(
        'steamSharePctLow must be lower than or equal to steamSharePctHigh',
      );
    }
    if (changed) await this.publishers.save(row);
    return row;
  }

  async findByIds(ids: string[]): Promise<Map<string, Publisher>> {
    if (ids.length === 0) return new Map();
    const rows = await this.publishers.find({ where: { id: In(ids) } });
    return new Map(rows.map((r) => [r.id, r]));
  }
}

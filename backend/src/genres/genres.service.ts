import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Genre, GenreSource } from '../entities';
import { IgdbClient } from '../ingestion/igdb.client';

export interface GenreRow {
  id: string;
  slug: string;
  name: string;
  source: GenreSource;
  externalId: number | null;
  updatedAt: Date;
}

export interface IgdbSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Owns the granular genre taxonomy (`genre` table) sourced from IGDB.
 * This is classification/display metadata only: since the move to the
 * data-driven matcher, genres no longer feed the estimation model, so
 * this service just exposes the catalog and keeps it in sync with IGDB.
 */
@Injectable()
export class GenresService {
  private readonly logger = new Logger(GenresService.name);

  constructor(
    @InjectRepository(Genre)
    private readonly genres: Repository<Genre>,
    private readonly igdb: IgdbClient,
  ) {}

  async listGenres(): Promise<GenreRow[]> {
    const rows = await this.genres
      .createQueryBuilder('g')
      .select([
        'g.id AS id',
        'g.slug AS slug',
        'g.name AS name',
        'g.source AS source',
        'g."externalId" AS "externalId"',
        'g."updatedAt" AS "updatedAt"',
      ])
      .orderBy('g.name', 'ASC')
      .getRawMany<GenreRow>();

    return rows.map((r) => ({
      ...r,
      externalId: r.externalId === null ? null : Number(r.externalId),
    }));
  }

  /**
   * Pull the full IGDB genre catalog and upsert into our `genre` table.
   * Existing rows keyed by `(source=IGDB, externalId)` are updated
   * (name/slug refresh). New rows are inserted. Returns counters so the
   * caller can show "fetched X, inserted Y, updated Z".
   */
  async syncFromIgdb(): Promise<IgdbSyncResult> {
    const fetched = await this.igdb.fetchAllGenres();
    if (fetched.length === 0) {
      this.logger.warn(
        'IGDB returned no genres (credentials missing or request failed). Skipping sync.',
      );
      return { fetched: 0, inserted: 0, updated: 0, skipped: 0 };
    }

    const existing = await this.genres.find({
      where: { source: GenreSource.IGDB },
    });
    const byExternalId = new Map(
      existing
        .filter((g) => g.externalId != null)
        .map((g) => [g.externalId!, g]),
    );

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of fetched) {
      const current = byExternalId.get(raw.id);
      if (current) {
        const namedChanged = current.name !== raw.name;
        const slugChanged = current.slug !== raw.slug;
        if (namedChanged || slugChanged) {
          current.name = raw.name;
          current.slug = raw.slug;
          await this.genres.save(current);
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const fresh = this.genres.create({
        name: raw.name,
        slug: raw.slug,
        source: GenreSource.IGDB,
        externalId: raw.id,
      });
      await this.genres.save(fresh);
      inserted += 1;
    }

    this.logger.log(
      `IGDB genre sync: fetched=${fetched.length} inserted=${inserted} updated=${updated} skipped=${skipped}.`,
    );
    return { fetched: fetched.length, inserted, updated, skipped };
  }
}

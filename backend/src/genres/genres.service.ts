import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConfidenceLevel,
  Genre,
  GenreProfile,
  GenreSource,
  Year2Retention,
} from '../entities';
import { IgdbClient } from '../ingestion/igdb.client';

export interface GenreProfileSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  leanLabel: string | null;
  confidence: ConfidenceLevel;
  lifecycleIndex: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  lifecycleDriver: string | null;
  genreCount: number;
  updatedAt: Date;
}

export interface GenreRow {
  id: string;
  slug: string;
  name: string;
  source: GenreSource;
  externalId: number | null;
  profileId: string | null;
  profileSlug: string | null;
  profileName: string | null;
  updatedAt: Date;
}

export interface IgdbSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface UpdateGenreProfileInput {
  name?: string;
  description?: string | null;
  pcShare?: number;
  playstationShare?: number;
  xboxShare?: number;
  switchShare?: number;
  leanLabel?: string | null;
  confidence?: ConfidenceLevel;
  lifecycleIndex?: number;
  firstWeekToYearOneMultiplier?: number;
  year2Retention?: Year2Retention;
  lifecycleDriver?: string | null;
}

export interface UpdateGenreInput {
  profileId?: string | null;
}

@Injectable()
export class GenresService {
  private readonly logger = new Logger(GenresService.name);

  constructor(
    @InjectRepository(GenreProfile)
    private readonly profiles: Repository<GenreProfile>,
    @InjectRepository(Genre)
    private readonly genres: Repository<Genre>,
    private readonly igdb: IgdbClient,
  ) {}

  async listProfiles(): Promise<GenreProfileSummary[]> {
    const profiles = await this.profiles.find({
      order: { firstWeekToYearOneMultiplier: 'DESC' },
    });
    if (profiles.length === 0) return [];

    const counts = await this.genres
      .createQueryBuilder('g')
      .select('g.profileId', 'profileId')
      .addSelect('COUNT(*)', 'count')
      .where('g.profileId IS NOT NULL')
      .groupBy('g.profileId')
      .getRawMany<{ profileId: string; count: string }>();

    const countByProfileId = new Map(
      counts.map((c) => [c.profileId, Number(c.count)]),
    );

    return profiles.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      pcShare: Number(p.pcShare),
      playstationShare: Number(p.playstationShare),
      xboxShare: Number(p.xboxShare),
      switchShare: Number(p.switchShare),
      leanLabel: p.leanLabel,
      confidence: p.confidence,
      lifecycleIndex: Number(p.lifecycleIndex),
      firstWeekToYearOneMultiplier: Number(p.firstWeekToYearOneMultiplier),
      year2Retention: p.year2Retention,
      lifecycleDriver: p.lifecycleDriver,
      genreCount: countByProfileId.get(p.id) ?? 0,
      updatedAt: p.updatedAt,
    }));
  }

  async updateProfile(
    id: string,
    input: UpdateGenreProfileInput,
  ): Promise<GenreProfileSummary> {
    const profile = await this.profiles.findOne({ where: { id } });
    if (!profile) throw new NotFoundException(`Profile ${id} not found`);

    const shares: Array<keyof UpdateGenreProfileInput> = [
      'pcShare',
      'playstationShare',
      'xboxShare',
      'switchShare',
    ];
    for (const key of shares) {
      const value = input[key];
      if (value !== undefined && (Number(value) < 0 || Number(value) > 1)) {
        throw new BadRequestException(`${key} must be between 0 and 1`);
      }
    }

    if (input.name !== undefined) profile.name = input.name;
    if (input.description !== undefined) profile.description = input.description;
    if (input.pcShare !== undefined) profile.pcShare = input.pcShare;
    if (input.playstationShare !== undefined) {
      profile.playstationShare = input.playstationShare;
    }
    if (input.xboxShare !== undefined) profile.xboxShare = input.xboxShare;
    if (input.switchShare !== undefined) profile.switchShare = input.switchShare;
    if (input.leanLabel !== undefined) profile.leanLabel = input.leanLabel;
    if (input.confidence !== undefined) profile.confidence = input.confidence;

    if (input.lifecycleIndex !== undefined) {
      if (input.lifecycleIndex < 0) {
        throw new BadRequestException('lifecycleIndex must be ≥ 0');
      }
      profile.lifecycleIndex = input.lifecycleIndex;
    }
    if (input.firstWeekToYearOneMultiplier !== undefined) {
      if (input.firstWeekToYearOneMultiplier < 0) {
        throw new BadRequestException(
          'firstWeekToYearOneMultiplier must be ≥ 0',
        );
      }
      profile.firstWeekToYearOneMultiplier = input.firstWeekToYearOneMultiplier;
    }
    if (input.year2Retention !== undefined) {
      profile.year2Retention = input.year2Retention;
    }
    if (input.lifecycleDriver !== undefined) {
      profile.lifecycleDriver = input.lifecycleDriver;
    }

    await this.profiles.save(profile);

    const summaries = await this.listProfiles();
    const updated = summaries.find((s) => s.id === id);
    if (!updated) throw new NotFoundException(`Profile ${id} not found`);
    return updated;
  }

  async listGenres(): Promise<GenreRow[]> {
    const rows = await this.genres
      .createQueryBuilder('g')
      .leftJoin(GenreProfile, 'gp', 'gp.id = g.profileId')
      .select([
        'g.id AS id',
        'g.slug AS slug',
        'g.name AS name',
        'g.source AS source',
        'g."externalId" AS "externalId"',
        'g."profileId" AS "profileId"',
        'gp.slug AS "profileSlug"',
        'gp.name AS "profileName"',
        'g."updatedAt" AS "updatedAt"',
      ])
      .orderBy('g.name', 'ASC')
      .getRawMany<GenreRow>();

    return rows.map((r) => ({
      ...r,
      externalId: r.externalId === null ? null : Number(r.externalId),
    }));
  }

  async updateGenre(id: string, input: UpdateGenreInput): Promise<GenreRow> {
    const genre = await this.genres.findOne({ where: { id } });
    if (!genre) throw new NotFoundException(`Genre ${id} not found`);

    if (input.profileId !== undefined) {
      if (input.profileId !== null) {
        const exists = await this.profiles.exist({
          where: { id: input.profileId },
        });
        if (!exists) {
          throw new NotFoundException(
            `Profile ${input.profileId} not found`,
          );
        }
      }
      genre.profileId = input.profileId;
    }

    await this.genres.save(genre);
    const rows = await this.listGenres();
    const updated = rows.find((r) => r.id === id);
    if (!updated) throw new NotFoundException(`Genre ${id} not found`);
    return updated;
  }

  /**
   * Pull the full IGDB genre catalog and upsert into our `genre` table.
   * Existing rows keyed by `(source=IGDB, externalId)` are updated
   * (name/slug refresh, profile assignment preserved). New rows land
   * with `profileId = NULL` and are surfaced in the admin for manual
   * mapping. Returns counters so the caller can show "fetched X,
   * inserted Y, updated Z".
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
      existing.filter((g) => g.externalId != null).map((g) => [g.externalId!, g]),
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
        profileId: null,
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

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ConfidenceLevel,
  Game,
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
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
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
  peakCcuToWeekOneLow?: number;
  peakCcuToWeekOneHigh?: number;
}

export interface UpdateGenreInput {
  profileId?: string | null;
}

/**
 * Outcome of resolving a `Game.genres` array into a single platform
 * + lifecycle profile. Numeric fields are equal-weighted averages
 * across the matched profiles; `year2Retention` reports the median
 * (rounded down on ties) and is exposed alongside the underlying
 * tail multipliers so the caller doesn't need to re-derive them.
 *
 * `matchedSlugs` is meant for logging / `method` tagging.
 * `confidence` is the *minimum* of the matched profiles — blending
 * an HIGH profile with a LOW profile can't yield more than LOW.
 */
export interface ResolvedGenreProfile {
  matchedSlugs: string[];
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  tailFactorY2: number;
  tailFactorY5: number;
  lifecycleIndex: number;
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
  confidence: ConfidenceLevel;
}

// Year-2 / year-5 cumulative units expressed as a multiplier of the
// year-1 cumulative ratio. NEGATIVE (annualised sport) barely grows;
// VERY_HIGH (Minecraft-tier sandbox) keeps compounding. Used to
// extend the projection curve past day 365.
const YEAR2_TAIL_FACTOR: Record<
  Year2Retention,
  { y2: number; y5: number }
> = {
  NEGATIVE: { y2: 1.05, y5: 1.1 },
  VERY_LOW: { y2: 1.05, y5: 1.12 },
  LOW: { y2: 1.15, y5: 1.25 },
  LOW_MEDIUM: { y2: 1.25, y5: 1.4 },
  MEDIUM: { y2: 1.4, y5: 1.65 },
  MEDIUM_HIGH: { y2: 1.55, y5: 1.95 },
  HIGH: { y2: 1.7, y5: 2.3 },
  VERY_HIGH: { y2: 1.9, y5: 2.8 },
};

const RETENTION_ORDER: Year2Retention[] = [
  Year2Retention.NEGATIVE,
  Year2Retention.VERY_LOW,
  Year2Retention.LOW,
  Year2Retention.LOW_MEDIUM,
  Year2Retention.MEDIUM,
  Year2Retention.MEDIUM_HIGH,
  Year2Retention.HIGH,
  Year2Retention.VERY_HIGH,
];

const CONFIDENCE_ORDER: ConfidenceLevel[] = [
  ConfidenceLevel.LOW,
  ConfidenceLevel.MEDIUM,
  ConfidenceLevel.HIGH,
];

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
      peakCcuToWeekOneLow: Number(p.peakCcuToWeekOneLow),
      peakCcuToWeekOneHigh: Number(p.peakCcuToWeekOneHigh),
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
    if (input.peakCcuToWeekOneLow !== undefined) {
      if (input.peakCcuToWeekOneLow < 0) {
        throw new BadRequestException('peakCcuToWeekOneLow must be ≥ 0');
      }
      profile.peakCcuToWeekOneLow = input.peakCcuToWeekOneLow;
    }
    if (input.peakCcuToWeekOneHigh !== undefined) {
      if (input.peakCcuToWeekOneHigh < 0) {
        throw new BadRequestException('peakCcuToWeekOneHigh must be ≥ 0');
      }
      profile.peakCcuToWeekOneHigh = input.peakCcuToWeekOneHigh;
    }

    const effLow =
      input.peakCcuToWeekOneLow ?? Number(profile.peakCcuToWeekOneLow);
    const effHigh =
      input.peakCcuToWeekOneHigh ?? Number(profile.peakCcuToWeekOneHigh);
    if (effLow > effHigh) {
      throw new BadRequestException(
        'peakCcuToWeekOneLow must be ≤ peakCcuToWeekOneHigh',
      );
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
   * Resolve a game's free-form IGDB genre strings into a single
   * blended platform + lifecycle profile. Returns `null` when no
   * genre on the game maps to a profile (the caller should fall
   * back to whatever default behaviour was in place before).
   *
   * Matching is case-insensitive on `Genre.name` (IGDB strings
   * sometimes show up with stray spaces / capitalisation drift); the
   * profile assignment is what we manually curate via the admin.
   *
   * Blending strategy: equal-weight average of every numeric field
   * across the matched profiles. `year2Retention` is reported as the
   * median (rounded down) of the matched levels but the consumer
   * should prefer `tailFactorY2/Y5` since those are pre-averaged on
   * the underlying numeric scale.
   */
  async resolveProfileForGame(
    game: Pick<Game, 'genres'>,
  ): Promise<ResolvedGenreProfile | null> {
    const names = (game.genres ?? [])
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    if (names.length === 0) return null;

    const matched = await this.genres
      .createQueryBuilder('g')
      .where('LOWER(g.name) IN (:...names)', {
        names: names.map((n) => n.toLowerCase()),
      })
      .andWhere('g."profileId" IS NOT NULL')
      .getMany();

    if (matched.length === 0) return null;

    const profileIds = Array.from(
      new Set(matched.map((g) => g.profileId).filter((id): id is string => !!id)),
    );
    if (profileIds.length === 0) return null;

    const profiles = await this.profiles.find({
      where: { id: In(profileIds) },
    });
    if (profiles.length === 0) return null;

    const n = profiles.length;
    const avg = (selector: (p: GenreProfile) => unknown): number => {
      const sum = profiles.reduce(
        (acc, p) => acc + Number(selector(p) ?? 0),
        0,
      );
      return sum / n;
    };

    const tailY2 =
      profiles.reduce(
        (acc, p) => acc + YEAR2_TAIL_FACTOR[p.year2Retention].y2,
        0,
      ) / n;
    const tailY5 =
      profiles.reduce(
        (acc, p) => acc + YEAR2_TAIL_FACTOR[p.year2Retention].y5,
        0,
      ) / n;

    const medianRetention =
      profiles
        .map((p) => RETENTION_ORDER.indexOf(p.year2Retention))
        .sort((a, b) => a - b)[Math.floor((n - 1) / 2)] ?? 0;

    const minConfidence = profiles.reduce<ConfidenceLevel>(
      (worst, p) =>
        CONFIDENCE_ORDER.indexOf(p.confidence) <
        CONFIDENCE_ORDER.indexOf(worst)
          ? p.confidence
          : worst,
      ConfidenceLevel.HIGH,
    );

    return {
      matchedSlugs: profiles.map((p) => p.slug).sort(),
      pcShare: avg((p) => p.pcShare),
      playstationShare: avg((p) => p.playstationShare),
      xboxShare: avg((p) => p.xboxShare),
      switchShare: avg((p) => p.switchShare),
      firstWeekToYearOneMultiplier: avg(
        (p) => p.firstWeekToYearOneMultiplier,
      ),
      year2Retention: RETENTION_ORDER[medianRetention],
      tailFactorY2: tailY2,
      tailFactorY5: tailY5,
      lifecycleIndex: avg((p) => p.lifecycleIndex),
      peakCcuToWeekOneLow: avg((p) => p.peakCcuToWeekOneLow),
      peakCcuToWeekOneHigh: avg((p) => p.peakCcuToWeekOneHigh),
      confidence: minConfidence,
    };
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

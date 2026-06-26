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
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
  genreCount: number;
  gameCount: number;
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
  pcDefaultBoxleiterLow?: number | null;
  pcDefaultBoxleiterHigh?: number | null;
  psDefaultBoxleiterLow?: number | null;
  psDefaultBoxleiterHigh?: number | null;
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
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
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

    // How many games currently resolve to each profile (auto-assigned at
    // ingestion or manually pinned). Queried on the `game` table via the
    // shared manager to avoid injecting another repository here.
    const gameCounts = await this.profiles.manager
      .createQueryBuilder()
      .select('g."genreProfileId"', 'profileId')
      .addSelect('COUNT(*)', 'count')
      .from(Game, 'g')
      .where('g."genreProfileId" IS NOT NULL')
      .groupBy('g."genreProfileId"')
      .getRawMany<{ profileId: string; count: string }>();

    const gameCountByProfileId = new Map(
      gameCounts.map((c) => [c.profileId, Number(c.count)]),
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
      pcDefaultBoxleiterLow:
        p.pcDefaultBoxleiterLow != null ? Number(p.pcDefaultBoxleiterLow) : null,
      pcDefaultBoxleiterHigh:
        p.pcDefaultBoxleiterHigh != null
          ? Number(p.pcDefaultBoxleiterHigh)
          : null,
      psDefaultBoxleiterLow:
        p.psDefaultBoxleiterLow != null ? Number(p.psDefaultBoxleiterLow) : null,
      psDefaultBoxleiterHigh:
        p.psDefaultBoxleiterHigh != null
          ? Number(p.psDefaultBoxleiterHigh)
          : null,
      genreCount: countByProfileId.get(p.id) ?? 0,
      gameCount: gameCountByProfileId.get(p.id) ?? 0,
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

    for (const key of [
      'pcDefaultBoxleiterLow',
      'pcDefaultBoxleiterHigh',
      'psDefaultBoxleiterLow',
      'psDefaultBoxleiterHigh',
    ] as const) {
      if (!(key in input)) continue;
      const val = input[key];
      if (val !== null && val !== undefined && Number(val) < 0) {
        throw new BadRequestException(`${key} must be ≥ 0 or null`);
      }
      profile[key] = val ?? null;
    }

    const pcLow =
      'pcDefaultBoxleiterLow' in input
        ? input.pcDefaultBoxleiterLow
        : profile.pcDefaultBoxleiterLow;
    const pcHigh =
      'pcDefaultBoxleiterHigh' in input
        ? input.pcDefaultBoxleiterHigh
        : profile.pcDefaultBoxleiterHigh;
    if (pcLow != null && pcHigh != null && Number(pcLow) > Number(pcHigh)) {
      throw new BadRequestException(
        'pcDefaultBoxleiterLow must be ≤ pcDefaultBoxleiterHigh',
      );
    }

    const psLow =
      'psDefaultBoxleiterLow' in input
        ? input.psDefaultBoxleiterLow
        : profile.psDefaultBoxleiterLow;
    const psHigh =
      'psDefaultBoxleiterHigh' in input
        ? input.psDefaultBoxleiterHigh
        : profile.psDefaultBoxleiterHigh;
    if (psLow != null && psHigh != null && Number(psLow) > Number(psHigh)) {
      throw new BadRequestException(
        'psDefaultBoxleiterLow must be ≤ psDefaultBoxleiterHigh',
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
   * Pick the profile of the FIRST genre (in `genres` order) that maps to
   * one. Returns `null` when the game has no genre or none of them is
   * mapped. Matching is case-insensitive on `Genre.name` (the catalog
   * strings drift on spacing / capitalisation); the profile assignment
   * is what we curate via the admin.
   *
   * This is the single source of truth for "which profile does this
   * game's genres imply" — used both at ingestion (to persist
   * `Game.genreProfileId`) and as the estimation-time fallback.
   */
  async resolveFirstProfileId(
    genres: string[] | null,
  ): Promise<string | null> {
    const names = (genres ?? [])
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

    const profileByName = new Map(
      matched
        .filter((g) => g.profileId)
        .map((g) => [g.name.toLowerCase(), g.profileId as string]),
    );
    for (const name of names) {
      const profileId = profileByName.get(name.toLowerCase());
      if (profileId) return profileId;
    }
    return null;
  }

  /**
   * Persist the auto-resolved genre profile onto a game, unless it was
   * pinned manually by an admin (`genreProfileManual`). Mutates the
   * passed entity in place; the caller is responsible for saving it.
   */
  async applyAutoGenreProfile(game: Game): Promise<void> {
    if (game.genreProfileManual) return;
    game.genreProfileId = await this.resolveFirstProfileId(game.genres);
  }

  /**
   * Resolve a game's persisted profile into the numeric platform +
   * lifecycle bucket consumed by the estimation model. Reads
   * `Game.genreProfileId` first (the value persisted at ingestion or
   * pinned by an admin); when absent, falls back to resolving the first
   * matching genre on the fly. Returns `null` when no genre maps to a
   * profile.
   */
  async resolveProfileForGame(
    game: Pick<Game, 'genres' | 'genreProfileId'>,
  ): Promise<ResolvedGenreProfile | null> {
    const profileId =
      game.genreProfileId ?? (await this.resolveFirstProfileId(game.genres));
    if (!profileId) return null;

    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return null;

    return this.buildResolvedProfile([profile]);
  }

  /**
   * Blend one or more `GenreProfile` rows into a single resolved profile
   * (numeric fields averaged, retention taken as the median, confidence
   * as the worst of the set). A single-element array (the per-game
   * override path) passes straight through with its own values.
   */
  private buildResolvedProfile(
    profiles: GenreProfile[],
  ): ResolvedGenreProfile {
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
      // Nullable overrides: only propagate when every blended profile has a
      // non-null value; otherwise fall back to global constants at call site.
      pcDefaultBoxleiterLow: profiles.every((p) => p.pcDefaultBoxleiterLow != null)
        ? avg((p) => p.pcDefaultBoxleiterLow)
        : null,
      pcDefaultBoxleiterHigh: profiles.every(
        (p) => p.pcDefaultBoxleiterHigh != null,
      )
        ? avg((p) => p.pcDefaultBoxleiterHigh)
        : null,
      psDefaultBoxleiterLow: profiles.every((p) => p.psDefaultBoxleiterLow != null)
        ? avg((p) => p.psDefaultBoxleiterLow)
        : null,
      psDefaultBoxleiterHigh: profiles.every(
        (p) => p.psDefaultBoxleiterHigh != null,
      )
        ? avg((p) => p.psDefaultBoxleiterHigh)
        : null,
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

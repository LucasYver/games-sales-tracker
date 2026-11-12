import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  type FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Or,
  Raw,
  Repository,
} from 'typeorm';
import {
  AchievementSnapshot,
  BlogPost,
  ConfidenceLevel,
  EstimateSnapshot,
  Game,
  GameEdition,
  GameRank,
  Milestone,
  Platform,
  PriceSnapshot,
  SalesEstimate,
  SalesSource,
  SerializedReconciliationEntry,
  SignalMetric,
  SignalSnapshot,
  SourceType,
} from '../entities';
import type { Agreement } from '../entities';
import {
  AGGREGATED_METHOD_CODE,
  EstimationMethodService,
} from '../estimation/estimation-method.service';
import { EstimationService } from '../estimation/estimation.service';
import { ML_METHOD_CODE } from '../estimation/ml/ml-estimate.service';
import {
  AGREEMENT_GROWTH_PER_YEAR,
  AGREEMENT_OVERSHOOT_RATIO,
  FALLBACK_ANNUAL_GROWTH,
  FALLBACK_GROWTH_CAP_YEARS,
  FIRST_WEEK_PEAK_CCU_WINDOW_DAYS,
  FRESHNESS_MIN_HEADROOM,
  FRESHNESS_VARIANCE_BUFFER,
  PC_DOMINANCE_RATIO_THRESHOLD,
  REVIEWS_REBUILD_BUCKET_DAYS,
  REVIEWS_REBUILD_MONTHLY_AFTER_DAYS,
  REVIEWS_REBUILD_MONTHLY_BUCKET_DAYS,
  ageInDays,
  ageInYears,
  lifetimeSalesPct,
} from './sales-modeling.constants';
import {
  awaitingRelease,
  computedAfterReleaseSql,
  ESTIMATE_MIN_RELEASE,
  estimateOutOfScope,
  estimatePublicSql,
} from './estimate-scope';
import { shownPublisher } from './game-companies';
import { platformReleaseDate } from './platform-release-date';
import { type GameMode, type GameType } from './igdb-facts';
import { normalizeSteamPriceCountry } from '../ingestion/steam-store-countries';
import {
  COMPANY_HUBS,
  type CompanyHub,
  FRANCHISE_HUB_MIN_GAMES,
  PUBLISHER_HUB_MIN_GAMES,
  STUDIO_HUB_MIN_GAMES,
  franchiseName,
  franchiseSlugSql,
  studioSlug,
  studioSlugSql,
} from './hubs';

// One row per live game linked to a studio or a publisher: that company's
// name and hub slug.
const companyGamesSql = (hub: CompanyHub) => `
  SELECT c.name, ${studioSlugSql('c.name')} AS slug
  FROM game g
  JOIN ${hub.table} c ON c.id = g."${hub.idColumn}"
  WHERE g."deletedAt" IS NULL`;

// The `trending` listing sort: games released in the window, with enough Steam
// reviews and console ratings to mean something, and a gain measured over the
// last two weeks.
const TRENDING_WINDOW_DAYS = 365;
const TRENDING_MIN_REVIEWS = 1000;
const TRENDING_GAIN_DAYS = 14;
// Per list on a game page: enough to link around, short enough to stay read.
const RELATED_GAMES_LIMIT = 6;

// A game's Steam review count (MAX of its STEAM_REVIEWS snapshots), read as
// one index-only probe on IDX_signal_snapshot_steam_reviews. The metric stays
// a literal so Postgres can match the partial index predicate.
const steamReviewsSql = (gameId: string) => `COALESCE((
  SELECT MAX(rs.value) FROM signal_snapshot rs
  WHERE rs."gameId" = ${gameId} AND rs.metric = 'STEAM_REVIEWS'
), 0)`;

// The "Reviews" figure of every listing: Steam reviews plus PlayStation, Xbox
// and Switch store ratings, each platform's latest count (its MAX). Console
// rows read IDX_signal_snapshot_store_ratings; synthetic PS points are not
// real ratings and stay out, as on the game page.
const totalReviewsSql = (gameId: string) =>
  [steamReviewsSql(gameId)]
    .concat(
      ['PS_RATINGS', 'XBOX_RATINGS', 'SWITCH_RATINGS'].map(
        (metric) => `COALESCE((
  SELECT MAX(rs.value) FROM signal_snapshot rs
  WHERE rs."gameId" = ${gameId} AND rs.metric = '${metric}' AND NOT rs.synthetic
), 0)`,
      ),
    )
    .join(' + ');

export interface PopularGame {
  id: string;
  name: string;
  slug: string;
  releaseDate: Date | null;
  coverUrl: string | null;
  platforms: Platform[];
  genres: string[];
  isFree: boolean;
  reviews: number;
  estimatedLow: number | null;
  estimatedHigh: number | null;
  /** The figure to display (see `EstimatedToday`). */
  estimatedUnits: number | null;
}

export interface GenreOption {
  name: string;
  count: number;
}

export interface PaginatedGames {
  items: PopularGame[];
  total: number;
}

export type DisplaySource = SalesSource | 'ESTIMATE';

// How a declared figure compares to our independent estimate for the same
// platform. 'strong' = estimate range brackets the figure; 'weak' = off but
// plausible (e.g. growth since an old figure); 'conflict' = they disagree
// beyond what time/uncertainty explains, flagging a figure or model to review.
// Defined in entities/enums.ts; re-exported here for backwards compatibility.
export { type Agreement } from '../entities';

/** IGDB facts shown on the public game page (`games/igdb-facts.ts`). */
export interface PublicIgdbFacts {
  gameType: GameType | null;
  /** What a remake, remaster, port or expansion comes from. */
  parentGame: { name: string; slug: string | null } | null;
  /** Catalog games that come from this one (its remakes, remasters…). */
  derivedGames: { name: string; slug: string; gameType: GameType | null }[];
  gameModes: GameMode[];
}

export interface PlatformSales {
  platform: Platform;
  low: number;
  high: number;
  source: DisplaySource;
  confidence: ConfidenceLevel | null;
  sourceUrl: string | null;
  // Set on declared lines that also have an estimate to cross-check against.
  agreement: Agreement | null;
}

// Side-by-side comparison of a platform's declared figure and our estimate.
export interface ReconciliationEntry {
  platform: Platform;
  declaredUnits: number;
  declaredSource: SalesSource;
  declaredAt: Date | null;
  estimateLow: number;
  estimateHigh: number;
  estimateMethod: string;
  agreement: Agreement;
  // estimate midpoint / declared figure. >1 = we estimate more than declared.
  ratio: number;
  detail: string;
}

export interface TotalSales {
  low: number;
  high: number;
  // 'reported' = an authoritative worldwide figure (e.g. Wikipedia/official);
  // 'sum' = our per-platform figures added up.
  basis: 'reported' | 'sum';
  sources: DisplaySource[];
  source: DisplaySource | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: Date | null;
  confidence: ConfidenceLevel | null;
}

// A single dated sales figure, kept for the timeline so the same game can show
// how its reported sales evolved over time across sources.
export interface StoreRatings {
  // `reviewerMedianPlaytimeMinutes`: directional SteamSpy-style proxy sampled
  // from reviewer `playtime_forever`; null when never polled or unavailable.
  steam: {
    reviews: number;
    reviewerMedianPlaytimeMinutes: number | null;
  } | null;
  playstation: { reviews: number; score: number | null } | null;
  xbox: { reviews: number; score: number | null } | null;
}

/**
 * Price over time, in cents of `currency`. `final` is what a buyer pays,
 * `initial` the catalogue price — they differ exactly when a sale is running.
 */
export interface PublicPricePoint {
  capturedAt: Date;
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
}

export interface PublicRegionalPrice {
  country: string;
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
}

export type PublicPriceStore = 'steam' | 'xbox' | 'playstation';

function sourceForPriceStore(store: PublicPriceStore): SourceType {
  if (store === 'xbox') return SourceType.XBOX_STORE;
  if (store === 'playstation') return SourceType.PS_STORE;
  return SourceType.STEAM;
}

/**
 * Our own chart position, computed from observed weekly review velocity across
 * the games we track — never from estimated units, which would make it
 * circular. Exposed so the page can say plainly whose ranking this is.
 */
export interface PublicRank {
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  peakPercentile: number;
  weeksTopDecile: number;
  computedAt: Date;
}

/**
 * One historical point of the headline reconciled estimate, exposed on the
 * public game detail to draw the sales-over-time chart. Mirrors the admin
 * `AdminEstimateSnapshot` but stripped of the internal reconciliation jsonb.
 */
export interface PublicEstimateSnapshot {
  computedAt: Date;
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
  estimatedTodayUnits: number | null;
}

/** Latest estimate batch of a game: per-platform rows + the worldwide ML row. */
interface LatestEstimates {
  byPlatform: Map<Platform, SalesEstimate>;
  ml: SalesEstimate | null;
}

/**
 * The headline "today" estimate: a range plus the single figure the site
 * displays. For the platform sum that figure is the range's midpoint; for the
 * ML estimate (estimate ÷/× a factor) it is the estimate itself.
 */
export interface EstimatedToday {
  low: number;
  high: number;
  units: number;
}

const midpoint = (low: number, high: number): number => (low + high) / 2;

// Map a numeric milestone confidence score (0–100) to the qualitative
// `ConfidenceLevel` the public API still surfaces on per-platform sales
// breakdowns. Used only as a display fallback — calibration ignores the
// score entirely.
function scoreToLevel(score: number | null): ConfidenceLevel | null {
  if (score == null) return null;
  if (score >= 75) return ConfidenceLevel.HIGH;
  if (score >= 45) return ConfidenceLevel.MEDIUM;
  return ConfidenceLevel.LOW;
}

function serializeReconciliationEntry(
  entry: ReconciliationEntry,
): SerializedReconciliationEntry {
  return {
    ...entry,
    declaredAt: entry.declaredAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    @InjectRepository(SalesEstimate)
    private readonly estimates: Repository<SalesEstimate>,
    @InjectRepository(EstimateSnapshot)
    private readonly estimateSnapshots: Repository<EstimateSnapshot>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(PriceSnapshot)
    private readonly prices: Repository<PriceSnapshot>,
    @InjectRepository(GameRank)
    private readonly ranks: Repository<GameRank>,
    @InjectRepository(BlogPost)
    private readonly blogPosts: Repository<BlogPost>,
    @InjectRepository(GameEdition)
    private readonly editions: Repository<GameEdition>,
    private readonly estimation: EstimationService,
    private readonly estimationMethods: EstimationMethodService,
  ) {}

  /**
   * Resolve a free-form article title to a tracked game. Uses trigram
   * word_similarity so the game name only has to appear as a fragment of the
   * headline (e.g. "Helldivers 2" within "Helldivers 2 tops 12m sales"). A
   * strict threshold avoids false matches; null when nothing is confident.
   */
  async matchByTitle(title: string, threshold = 0.6): Promise<Game | null> {
    const trimmed = title.trim();
    if (trimmed.length < 3) return null;

    return this.games
      .createQueryBuilder('g')
      .where('word_similarity(g.name, :title) >= :threshold', {
        title: trimmed,
        threshold,
      })
      .orderBy('word_similarity(g.name, :title)', 'DESC')
      .addOrderBy('length(g.name)', 'DESC')
      .limit(1)
      .getOne();
  }

  async search(query: string, limit = 20): Promise<Game[]> {
    const trimmed = query.trim();

    if (!trimmed) {
      return this.games.find({ take: limit, order: { releaseDate: 'DESC' } });
    }

    // Trigram search via word_similarity: compares the query against the
    // best-matching fragment of the title, so short typo-prone queries
    // still rank their full game. ILIKE fallback catches short substrings.
    return this.games
      .createQueryBuilder('g')
      .where('word_similarity(:q, g.name) > 0.3', { q: trimmed })
      .orWhere('g.name ILIKE :pattern', { pattern: `%${trimmed}%` })
      .orderBy('word_similarity(:q, g.name)', 'DESC')
      .addOrderBy('g.releaseDate', 'DESC', 'NULLS LAST')
      .limit(limit)
      .getMany();
  }

  /**
   * Search results in the same shape as the listing, so the site's live search
   * can show the sales figure and review count next to each hit instead of a
   * bare title. Kept to a handful of rows — this runs on every keystroke.
   */
  async searchDetailed(query: string, limit = 8): Promise<PopularGame[]> {
    const games = await this.search(query, limit);
    if (games.length === 0) return [];

    const ids = games.map((g) => g.id);
    const [reviewsByGame, estimates] = await Promise.all([
      this.totalReviews(ids),
      this.latestReconciledEstimates(ids),
    ]);

    return games.map((game) => {
      const headline = estimates.get(game.id) ?? null;
      return {
        id: game.id,
        name: game.name,
        slug: game.slug,
        releaseDate: game.releaseDate,
        coverUrl: game.coverUrl,
        platforms: game.platforms ?? [],
        genres: game.genres ?? [],
        isFree: game.isFree,
        reviews: reviewsByGame.get(game.id) ?? 0,
        estimatedLow: headline?.low ?? null,
        estimatedHigh: headline?.high ?? null,
        estimatedUnits: headline?.units ?? null,
      };
    });
  }

  async listPopular(
    options: {
      limit?: number;
      sort?: 'trending' | 'popular' | 'recent' | 'oldest' | 'sales';
      platform?: string;
      offset?: number;
      genre?: string;
      status?: 'released' | 'new' | 'upcoming';
      yearMin?: number;
      yearMax?: number;
      minReviews?: number;
    } = {},
  ): Promise<PaginatedGames> {
    const {
      limit = 24,
      sort = 'popular',
      platform,
      offset = 0,
      genre,
      status,
      yearMin,
      yearMax,
      minReviews,
    } = options;

    // Review count per game, all platforms summed, as correlated index
    // probes. Joining signal_snapshot instead scanned all ~3.9M rows on
    // every call.
    const reviewsSql = totalReviewsSql('g.id');

    const qb = this.games
      .createQueryBuilder('g')
      .select('g.id', 'id')
      .addSelect('g.name', 'name')
      .addSelect('g.slug', 'slug')
      .addSelect('g.releaseDate', 'releaseDate')
      .addSelect('g.coverUrl', 'coverUrl')
      .addSelect('g.platforms', 'platforms')
      .addSelect('g.genres', 'genres')
      .addSelect('g.isFree', 'isFree')
      .addSelect(reviewsSql, 'reviews')
      .groupBy('g.id');

    const countQb = this.games.createQueryBuilder('g');

    // Apply identical row-level filters to both query builders so the
    // pagination total stays consistent with the visible page.
    const applyRowFilters = (target: typeof qb) => {
      if (platform) {
        // PostgreSQL enum-array containment: platforms @> ARRAY['X']::platform_enum[]
        target.andWhere(
          `g.platforms @> ARRAY[:platform]::game_platforms_enum[]`,
          { platform },
        );
      }

      if (genre) {
        // `genres` is stored as a comma-separated `simple-array`; match whole
        // tokens (with optional surrounding spaces) so "RPG" doesn't
        // accidentally hit "Role-playing (RPG)" via substring.
        target.andWhere(
          `string_to_array(g.genres, ',') ` +
            `&& ARRAY[:genre, ' ' || :genre, :genre || ' ', ' ' || :genre || ' ']`,
          { genre },
        );
      }

      if (status === 'upcoming') {
        target.andWhere('g.releaseDate > NOW()');
      } else if (status === 'released') {
        target.andWhere('g.releaseDate <= NOW()');
      } else if (status === 'new') {
        target.andWhere(
          `g.releaseDate <= NOW() AND g.releaseDate >= NOW() - INTERVAL '30 days'`,
        );
      }

      if (yearMin != null) {
        target.andWhere(`EXTRACT(YEAR FROM g.releaseDate) >= :yearMin`, {
          yearMin,
        });
      }

      if (yearMax != null) {
        target.andWhere(`EXTRACT(YEAR FROM g.releaseDate) <= :yearMax`, {
          yearMax,
        });
      }
    };

    applyRowFilters(qb);
    applyRowFilters(countQb);

    // `minReviews` filters on an aggregate, so it must go through HAVING on
    // the grouped query and be counted via a wrapping subquery. The filter
    // is labelled "Steam reviews", so it reads Steam only.
    if (minReviews != null && minReviews > 0) {
      qb.having(`${steamReviewsSql('g.id')} >= :minReviews`, { minReviews });
    }

    if (sort === 'sales') {
      // Latest headline snapshot per game — same source as listingUnits().
      // Alias stays lowercase: TypeORM emits ORDER BY <alias> unquoted, and
      // Postgres folds that to lower case, so a camelCase alias never matches.
      qb.leftJoin(
        `(
          SELECT DISTINCT ON ("gameId")
            "gameId",
            "estimatedTodayLow" AS low,
            "estimatedTodayHigh" AS high,
            "estimatedTodayUnits" AS units,
            "computedAt" AS computed_at
          FROM estimate_snapshot
          ORDER BY "gameId", "computedAt" DESC
        )`,
        'snap',
        // Games out of the estimate scope or not yet estimated since launch
        // show no figure, so they rank last.
        `snap."gameId" = g.id AND ${estimatePublicSql('g')} AND ${computedAfterReleaseSql('g', 'snap.computed_at')}`,
        { estimateMinRelease: ESTIMATE_MIN_RELEASE },
      );
      qb.addSelect(
        // The figure listingUnits() displays (midpoint for pre-ML rows).
        'MAX(COALESCE(snap.units, (COALESCE(snap.low, 0) + COALESCE(snap.high, 0)) / 2.0))',
        'sales_mid',
      );
      qb.orderBy('sales_mid', 'DESC');
    } else if (sort === 'trending') {
      // Steam reviews and console ratings per day, summed across platforms and
      // averaged since launch plus over the last two weeks: the first favours
      // recent hits, the second what is moving right now. A game released
      // inside the window has no baseline, so its whole count is its gain. Any
      // other game without a baseline has an unmeasured gain. Games outside the
      // window have no score and follow by total Steam reviews, so every filter
      // and page still lists the whole catalog.
      qb.leftJoin(
        `(
          SELECT
            recent.id AS "gameId",
            SUM(
              total.value::float / (recent.age + ${TRENDING_GAIN_DAYS})
              + COALESCE(
                GREATEST(total.value - base.value, 0)::float
                  / GREATEST(EXTRACT(EPOCH FROM total.last - base."capturedAt") / 86400, 1),
                CASE WHEN recent.age < ${TRENDING_GAIN_DAYS}
                  THEN total.value::float / ${TRENDING_GAIN_DAYS}
                  ELSE 0
                END
              )
            ) AS score
          FROM (
            SELECT id, GREATEST(EXTRACT(EPOCH FROM NOW() - "releaseDate") / 86400, 0) AS age
            FROM game
            WHERE "releaseDate" <= NOW()
              AND "releaseDate" >= NOW() - INTERVAL '${TRENDING_WINDOW_DAYS} days'
          ) recent
          CROSS JOIN unnest(
            ARRAY['STEAM_REVIEWS', 'PS_RATINGS', 'XBOX_RATINGS', 'SWITCH_RATINGS']::signal_snapshot_metric_enum[]
          ) AS m(metric)
          JOIN LATERAL (
            SELECT MAX(value) AS value, MAX("capturedAt") AS last
            FROM signal_snapshot
            WHERE "gameId" = recent.id AND metric = m.metric AND NOT synthetic
          ) total ON total.value IS NOT NULL
          LEFT JOIN LATERAL (
            SELECT value, "capturedAt"
            FROM signal_snapshot
            WHERE "gameId" = recent.id
              AND metric = m.metric
              AND NOT synthetic
              AND "capturedAt" < NOW() - INTERVAL '${TRENDING_GAIN_DAYS} days'
            ORDER BY "capturedAt" DESC
            LIMIT 1
          ) base ON TRUE
          GROUP BY recent.id
          HAVING SUM(total.value) >= ${TRENDING_MIN_REVIEWS}
        )`,
        'trend',
        'trend."gameId" = g.id',
      );
      qb.addSelect('MAX(trend.score)', 'trending_score');
      qb.orderBy('trending_score', 'DESC', 'NULLS LAST');
      qb.addOrderBy('reviews', 'DESC');
    } else if (sort === 'recent') {
      qb.orderBy('g.releaseDate', 'DESC', 'NULLS LAST');
      qb.addOrderBy('reviews', 'DESC');
    } else if (sort === 'oldest') {
      qb.orderBy('g.releaseDate', 'ASC', 'NULLS LAST');
      qb.addOrderBy('reviews', 'DESC');
    } else {
      qb.orderBy('reviews', 'DESC');
    }
    // Ties (same release day, same score) had no order, so a game could show
    // on two pages or on none. The id makes every page stable.
    qb.addOrderBy('g.id', 'ASC');

    // When a HAVING filter is in play we can't rely on getCount() (which
    // ignores GROUP BY/HAVING); count rows of the grouped projection instead.
    const totalPromise =
      minReviews != null && minReviews > 0
        ? qb
            .clone()
            .offset(0)
            .limit(undefined)
            .getRawMany()
            .then((r) => r.length)
        : countQb.getCount();

    const [rows, total] = await Promise.all([
      qb.offset(offset).limit(limit).getRawMany<{
        id: string;
        name: string;
        slug: string;
        releaseDate: Date | null;
        coverUrl: string | null;
        platforms: Platform[];
        genres: string | null;
        isFree: boolean;
        reviews: string;
      }>(),
      totalPromise,
    ]);

    const ids = rows.map((r) => r.id);
    const latestByGame = await this.latestReconciledEstimates(ids);

    const items = rows.map((r) => {
      const headline = latestByGame.get(r.id) ?? null;
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        releaseDate: r.releaseDate,
        coverUrl: r.coverUrl,
        platforms: this.parsePlatforms(r.platforms),
        genres: this.parseGenres(r.genres),
        isFree: r.isFree,
        reviews: Number(r.reviews),
        estimatedLow: headline?.low ?? null,
        estimatedHigh: headline?.high ?? null,
        estimatedUnits: headline?.units ?? null,
      };
    });

    return { items, total };
  }

  /**
   * Distinct genres across all games with usage counts, sorted by popularity.
   * Powers the genre filter dropdown on the public list. Bare minimum count
   * filter to keep one-off / typo genres out of the UI.
   */
  async listGenres(): Promise<GenreOption[]> {
    const rows = await this.games.query<{ name: string; count: string }[]>(
      `
      SELECT trim(g) AS name, COUNT(*) AS count
      FROM (
        SELECT regexp_split_to_table(genres, ',') AS g
        FROM game
        WHERE genres IS NOT NULL AND genres <> ''
      ) sub
      WHERE trim(g) <> ''
      GROUP BY name
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC, name ASC
      `,
    );
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  /**
   * Other games of the same franchise and the same developer, for the links
   * on a game page. Newest first, so a list only changes when the catalog does.
   * A game shown under its franchise is not repeated under its studio. The
   * publisher only gets its hub link.
   */
  async listRelated(slug: string) {
    const game = await this.games.findOne({
      where: { slug },
      select: {
        id: true,
        developerId: true,
        publisherId: true,
        franchiseSlug: true,
        seriesSlug: true,
        seriesName: true,
        developerRecord: { id: true, name: true },
        publisherRecord: { id: true, name: true },
      },
      relations: { developerRecord: true, publisherRecord: true },
    });
    if (!game) throw new NotFoundException(`Game "${slug}" not found`);
    const franchiseSlug = game.seriesSlug ?? game.franchiseSlug;
    const developer = game.developerRecord?.name ?? null;
    const slugOfStudio = developer ? studioSlug(developer) : '';
    const publisher = game.publisherRecord?.name ?? null;
    const slugOfPublisher = publisher ? studioSlug(publisher) : '';

    const load = (where: FindOptionsWhere<Game>, take: number) =>
      this.games.find({
        where: { ...where, id: Not(game.id) },
        select: {
          id: true,
          name: true,
          slug: true,
          releaseDate: true,
          coverUrl: true,
          platforms: true,
          genres: true,
          isFree: true,
        },
        order: { releaseDate: { direction: 'DESC', nulls: 'LAST' }, id: 'ASC' },
        take,
      });

    const [franchise, sameDeveloper, publisherGames] = await Promise.all([
      franchiseSlug
        ? load(
            {
              seriesSlug: Raw(
                (alias) => `COALESCE(${alias}, "franchiseSlug") = :franchise`,
                { franchise: franchiseSlug },
              ),
            },
            RELATED_GAMES_LIMIT,
          )
        : [],
      slugOfStudio && game.developerId
        ? load(
            { developerId: game.developerId },
            // Enough to still fill the list once franchise games are removed.
            RELATED_GAMES_LIMIT * 2,
          )
        : [],
      // The publisher has no list on the page, only its hub link, so a count
      // is enough. Counted on its own row, as the studio link is.
      slugOfPublisher && game.publisherId
        ? this.games.count({ where: { publisherId: game.publisherId } })
        : 0,
    ]);

    const inFranchise = new Set(franchise.map((g) => g.id));
    const studio = sameDeveloper
      .filter((g) => !inFranchise.has(g.id))
      .slice(0, RELATED_GAMES_LIMIT);

    const estimates = await this.latestReconciledEstimates(
      [...franchise, ...studio].map((g) => g.id),
    );
    const toItem = (g: Game) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      releaseDate: g.releaseDate,
      coverUrl: g.coverUrl,
      platforms: g.platforms ?? [],
      genres: g.genres ?? [],
      isFree: g.isFree,
      estimatedUnits: estimates.get(g.id)?.units ?? null,
    });

    // Each list leaves out the game itself. The lists are capped well above the
    // hub thresholds, so their length is enough to tell whether a hub exists.
    return {
      franchise: franchise.map(toItem),
      studio: studio.map(toItem),
      franchiseHub:
        franchiseSlug && franchise.length + 1 >= FRANCHISE_HUB_MIN_GAMES
          ? {
              slug: franchiseSlug,
              name: franchiseName(
                franchiseSlug,
                game.seriesSlug ? game.seriesName : null,
              ),
            }
          : null,
      studioHub:
        slugOfStudio && sameDeveloper.length + 1 >= STUDIO_HUB_MIN_GAMES
          ? { slug: slugOfStudio, name: developer as string }
          : null,
      // The count includes the game itself.
      publisherHub:
        slugOfPublisher && publisherGames >= PUBLISHER_HUB_MIN_GAMES
          ? { slug: slugOfPublisher, name: publisher as string }
          : null,
    };
  }

  /**
   * Every game of a studio (its `developer` rows sharing the slug), for its
   * public hub page. A slug built from an older spelling of a game's
   * developer, the Steam one ("capcom-co-ltd") or one since folded, returns
   * the hub its games moved to, under that hub's slug, so the page can
   * redirect.
   */
  getStudioHub(slug: string) {
    return this.getCompanyHub(COMPANY_HUBS.studio, slug);
  }

  /** Same as `getStudioHub`, for a publisher (its `publisher` rows). */
  getPublisherHub(slug: string) {
    return this.getCompanyHub(COMPANY_HUBS.publisher, slug);
  }

  private async getCompanyHub(hub: CompanyHub, slug: string) {
    const notFound = () =>
      new NotFoundException(`${hub.label} "${slug}" not found`);
    if (!slug) throw notFound();
    const shown = studioSlugSql('c.name');
    const hubWhere = `g."${hub.idColumn}" IN (
      SELECT c.id FROM ${hub.table} c WHERE ${shown} = :slug)`;
    let games = await this.hubGames(hubWhere, slug);
    let hubSlug = slug;
    if (games.length < hub.minGames) {
      const [moved] = await this.games.query<{ slug: string }[]>(
        `SELECT ${shown} AS slug
         FROM game g
         JOIN ${hub.table} c ON c.id = g."${hub.idColumn}"
         WHERE g."deletedAt" IS NULL
           AND (${studioSlugSql(`g."${hub.steamColumn}"`)} = $1
                OR ${studioSlugSql(`g.${hub.nameColumn}`)} = $1)
           AND ${shown} <> $1
         GROUP BY 1
         ORDER BY COUNT(*) DESC, 1
         LIMIT 1`,
        [slug],
      );
      if (moved) {
        hubSlug = moved.slug;
        games = await this.hubGames(hubWhere, hubSlug);
      }
    }
    if (games.length < hub.minGames) throw notFound();
    // Rows sharing a slug: the name of the one with the most games.
    const [{ name }] = await this.games.query<{ name: string }[]>(
      `SELECT c.name
       FROM ${hub.table} c
       JOIN game g ON g."${hub.idColumn}" = c.id AND g."deletedAt" IS NULL
       WHERE ${shown} = $1
       GROUP BY c.id
       ORDER BY COUNT(*) DESC, c.name
       LIMIT 1`,
      [hubSlug],
    );
    return this.toHub(hubSlug, name, games);
  }

  /**
   * Every game of a franchise, for its public hub page. A slug from before the
   * IGDB series (derived from titles) returns the hub its games moved to, under
   * that hub's slug, so the page can redirect.
   */
  async getFranchiseHub(slug: string) {
    const hubWhere = `${franchiseSlugSql('g')} = :slug`;
    let games = await this.hubGames(hubWhere, slug);
    let hubSlug = slug;
    if (games.length < FRANCHISE_HUB_MIN_GAMES) {
      const [moved] = await this.games.query<{ slug: string }[]>(
        `SELECT ${franchiseSlugSql()} AS slug
         FROM game
         WHERE "deletedAt" IS NULL AND "franchiseSlug" = $1
           AND ${franchiseSlugSql()} <> $1
         GROUP BY 1
         ORDER BY COUNT(*) DESC, 1
         LIMIT 1`,
        [slug],
      );
      if (moved) {
        hubSlug = moved.slug;
        games = await this.hubGames(hubWhere, hubSlug);
      }
    }
    if (games.length < FRANCHISE_HUB_MIN_GAMES) {
      throw new NotFoundException(`Franchise "${slug}" not found`);
    }
    return this.toHub(
      hubSlug,
      franchiseName(hubSlug, mostCommon(games.map((g) => g.seriesName))),
      games,
    );
  }

  /** Every studio with a hub page, for the public index. */
  listStudios() {
    return this.listCompanyHubs(COMPANY_HUBS.studio);
  }

  /** Every publisher with a hub page, for the public index. */
  listPublishers() {
    return this.listCompanyHubs(COMPANY_HUBS.publisher);
  }

  private async listCompanyHubs(hub: CompanyHub) {
    const rows = await this.games.query<
      { slug: string; name: string; games: string }[]
    >(
      `SELECT slug, MODE() WITHIN GROUP (ORDER BY name) AS name, COUNT(*) AS games
       FROM (${companyGamesSql(hub)}) companies
       WHERE slug <> ''
       GROUP BY slug
       HAVING COUNT(*) >= $1
       ORDER BY LOWER(MODE() WITHIN GROUP (ORDER BY name)), slug`,
      [hub.minGames],
    );
    return rows.map((row) => ({ ...row, games: Number(row.games) }));
  }

  /** Every franchise with a hub page, for the public index. */
  async listFranchises() {
    const rows = await this.games.query<
      { slug: string; name: string | null; games: string }[]
    >(
      `SELECT ${franchiseSlugSql()} AS slug,
              MODE() WITHIN GROUP (ORDER BY "seriesName") AS name,
              COUNT(*) AS games
       FROM game
       WHERE "deletedAt" IS NULL AND ${franchiseSlugSql()} IS NOT NULL
       GROUP BY 1
       HAVING COUNT(*) >= $1`,
      [FRANCHISE_HUB_MIN_GAMES],
    );
    return rows
      .map((row) => ({
        slug: row.slug,
        name: franchiseName(row.slug, row.name),
        games: Number(row.games),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Slugs of the hubs that exist, for the sitemap. */
  async listHubs(): Promise<{
    studios: string[];
    publishers: string[];
    franchises: string[];
  }> {
    const companySlugs = (hub: CompanyHub) =>
      this.games.query<{ slug: string }[]>(
        `SELECT slug
         FROM (${companyGamesSql(hub)}) companies
         WHERE slug <> ''
         GROUP BY 1
         HAVING COUNT(*) >= $1
         ORDER BY 1`,
        [hub.minGames],
      );
    const [studios, publishers, franchises] = await Promise.all([
      companySlugs(COMPANY_HUBS.studio),
      companySlugs(COMPANY_HUBS.publisher),
      this.games.query<{ slug: string }[]>(
        `SELECT ${franchiseSlugSql()} AS slug
         FROM game
         WHERE "deletedAt" IS NULL AND ${franchiseSlugSql()} IS NOT NULL
         GROUP BY 1
         HAVING COUNT(*) >= $1
         ORDER BY 1`,
        [FRANCHISE_HUB_MIN_GAMES],
      ),
    ]);
    return {
      studios: studios.map((row) => row.slug),
      publishers: publishers.map((row) => row.slug),
      franchises: franchises.map((row) => row.slug),
    };
  }

  private hubGames(where: string, slug: string): Promise<Game[]> {
    return this.games
      .createQueryBuilder('g')
      .select([
        'g.id',
        'g.name',
        'g.slug',
        'g.releaseDate',
        'g.coverUrl',
        'g.platforms',
        'g.genres',
        'g.isFree',
        'g.developer',
        'g.seriesName',
      ])
      .where(where, { slug })
      .getMany();
  }

  /** The listing's review count (all platforms summed) for these games. */
  private async totalReviews(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.games.query<{ gameId: string; reviews: string }[]>(
      `SELECT g.id AS "gameId", ${totalReviewsSql('g.id')} AS reviews
       FROM unnest($1::uuid[]) AS g(id)`,
      [ids],
    );
    return new Map(rows.map((r) => [r.gameId, Number(r.reviews)]));
  }

  /** Same row shape as the listing, best seller first. */
  private async toHub(slug: string, name: string, games: Game[]) {
    const ids = games.map((game) => game.id);
    const [estimates, reviews] = await Promise.all([
      this.latestReconciledEstimates(ids),
      this.totalReviews(ids),
    ]);

    const items = games
      .map((game) => {
        const headline = estimates.get(game.id) ?? null;
        return {
          id: game.id,
          name: game.name,
          slug: game.slug,
          releaseDate: game.releaseDate,
          coverUrl: game.coverUrl,
          platforms: game.platforms ?? [],
          genres: game.genres ?? [],
          isFree: game.isFree,
          reviews: reviews.get(game.id) ?? 0,
          estimatedLow: headline?.low ?? null,
          estimatedHigh: headline?.high ?? null,
          estimatedUnits: game.isFree ? null : (headline?.units ?? null),
        };
      })
      .sort(
        (a, b) =>
          (b.estimatedUnits ?? -1) - (a.estimatedUnits ?? -1) ||
          (b.releaseDate?.getTime() ?? 0) - (a.releaseDate?.getTime() ?? 0) ||
          a.id.localeCompare(b.id),
      );

    return { slug, name, games: items };
  }

  /**
   * Slug + last estimate (else release date) for the public sitemap. An
   * upcoming game falls back to its last row update: a future release date
   * is not a modification time, and search engines distrust the whole
   * sitemap's lastmod when some entries are in the future.
   */
  async listSitemap(): Promise<{
    items: { slug: string; lastModified: string | null }[];
  }> {
    const rows = await this.games
      .createQueryBuilder('g')
      .leftJoin(
        `(
          SELECT "gameId", MAX("computedAt") AS "computedAt"
          FROM estimate_snapshot
          GROUP BY "gameId"
        )`,
        'snap',
        'snap."gameId" = g.id',
      )
      .select('g.slug', 'slug')
      .addSelect(
        'COALESCE(snap."computedAt", LEAST(g.releaseDate, g.updatedAt))',
        'lastModified',
      )
      // Stable order: the frontend splits this list into fixed-size
      // sitemap files, so a game must not hop between them.
      .orderBy('g.createdAt', 'ASC')
      .addOrderBy('g.id', 'ASC')
      .getRawMany<{ slug: string; lastModified: Date | string | null }>();

    return {
      items: rows.map((r) => {
        if (!r.lastModified) return { slug: r.slug, lastModified: null };
        const at = new Date(r.lastModified);
        return {
          slug: r.slug,
          lastModified: Number.isNaN(at.getTime()) ? null : at.toISOString(),
        };
      }),
    };
  }

  private parseGenres(value: string | null): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  async getBySlug(slug: string, country?: string, store?: string) {
    const priceCountry = normalizeSteamPriceCountry(country);
    const game = await this.games.findOne({
      where: { slug },
      relations: { sources: true, milestones: true },
    });

    if (!game) throw new NotFoundException(`Game "${slug}" not found`);

    // Before launch there are no sales: no estimate, no declared figure.
    const unreleased = awaitingRelease(game.releaseDate);
    const visibleMilestones = game.isFree || unreleased ? [] : game.milestones;

    const estimateHidden = game.estimateHidden;
    const outOfScope = estimateHidden || estimateOutOfScope(game.releaseDate);
    const noEstimate = game.isFree || outOfScope || unreleased;
    // Only estimates computed from signals captured after launch are public:
    // the first one lands at the next rebuild following the release.
    const estimatesSince = game.releaseDate ?? undefined;

    // Everything below hangs off game.id alone, so it goes out in one wave
    // instead of a dozen sequential round trips. Only the price rows wait on
    // the store list, and that chain runs alongside the rest.
    const series = (metric: SignalMetric, realOnly = false) =>
      this.signals.find({
        where: {
          gameId: game.id,
          metric,
          ...(realOnly ? { synthetic: false } : {}),
        },
        order: { capturedAt: 'ASC' },
        select: { capturedAt: true, value: true },
      });

    const loadPrices = async () => {
      if (game.isFree) {
        return {
          availablePriceStores: [] as PublicPriceStore[],
          priceStore: this.resolvePriceStore(store, []),
          priceRows: [] as PriceSnapshot[],
          regionalPrices: [] as PublicRegionalPrice[],
        };
      }
      const availablePriceStores = await this.availablePriceStores(game.id);
      const priceStore = this.resolvePriceStore(store, availablePriceStores);
      const priceSource = sourceForPriceStore(priceStore);
      const [priceRows, regionalPrices] = await Promise.all([
        this.prices.find({
          where: {
            gameId: game.id,
            country: priceCountry,
            source: priceSource,
          },
          order: { capturedAt: 'ASC' },
          select: {
            capturedAt: true,
            currency: true,
            initial: true,
            final: true,
            discountPercent: true,
          },
        }),
        this.latestRegionalPrices(game.id, priceSource),
      ]);
      return { availablePriceStores, priceStore, priceRows, regionalPrices };
    };

    const [
      latestEstimates,
      reviewHistory,
      followersHistory,
      twitchViewersHistory,
      psRatingsHistory,
      xboxRatingsHistory,
      switchRatingsHistory,
      ccuHistory,
      // Concurrent players: the daily series above plus the all-time record,
      // stored as its own metric (a new row only when the record is beaten,
      // so it is read by value, not by date).
      peakCcuRow,
      { availablePriceStores, priceStore, priceRows, regionalPrices },
      rankRow,
      storeRatings,
      reviewLanguagesRow,
      publishedBlog,
      estimateSnapshotRows,
      editionRows,
      lineage,
    ] = await Promise.all([
      noEstimate
        ? Promise.resolve<LatestEstimates>({
            byPlatform: new Map<Platform, SalesEstimate>(),
            ml: null,
          })
        : this.latestEstimates(game.id, undefined, estimatesSince),
      series(SignalMetric.STEAM_REVIEWS),
      series(SignalMetric.STEAM_FOLLOWERS),
      series(SignalMetric.TWITCH_VIEWERS),
      series(SignalMetric.PS_RATINGS, true),
      series(SignalMetric.XBOX_RATINGS, true),
      series(SignalMetric.SWITCH_RATINGS, true),
      series(SignalMetric.STEAM_CONCURRENT, true),
      this.signals.findOne({
        where: { gameId: game.id, metric: SignalMetric.STEAM_PEAK_CCU },
        order: { value: 'DESC' },
        select: { capturedAt: true, value: true },
      }),
      loadPrices(),
      this.ranks.findOne({ where: { gameId: game.id } }),
      this.buildStoreRatings(game.id),
      // Not selected by default (catalog-wide reads skip it).
      this.games.findOne({
        where: { id: game.id },
        select: { id: true, reviewLanguages: true },
      }),
      this.blogPosts.findOne({
        // Live includes a published article whose refresh is in review.
        // The game page links its evergreen article, not news or launch posts.
        where: {
          gameId: game.id,
          kind: 'GAME_SALES_FACTS',
          publishedAt: Not(IsNull()),
          status: Not('REJECTED'),
        },
        relations: { translations: true },
      }),
      noEstimate
        ? Promise.resolve([])
        : this.estimateSnapshots.find({
            where: {
              gameId: game.id,
              ...(estimatesSince
                ? { computedAt: MoreThanOrEqual(estimatesSince) }
                : {}),
            },
            order: { computedAt: 'ASC' },
            select: {
              computedAt: true,
              estimatedTodayLow: true,
              estimatedTodayHigh: true,
              estimatedTodayUnits: true,
            },
            take: 500,
          }),
      this.editions.find({
        where: { gameId: game.id },
        order: {
          releaseDate: { direction: 'ASC', nulls: 'LAST' },
          igdbId: 'ASC',
        },
        select: { name: true, versionTitle: true, releaseDate: true },
      }),
      this.igdbLineage(game),
    ]);

    const { breakdown, total, reconciliation, estimatedToday } = game.isFree
      ? {
          breakdown: [],
          total: null,
          reconciliation: [],
          estimatedToday: null,
        }
      : this.aggregateSales(
          visibleMilestones,
          latestEstimates,
          game.releaseDate,
        );

    const priceHistory: PublicPricePoint[] = priceRows.map((p) => ({
      capturedAt: p.capturedAt,
      currency: p.currency,
      initial: p.initial,
      final: p.final,
      discountPercent: p.discountPercent,
    }));
    const currentPrice = priceHistory.at(-1) ?? null;
    const lowestPrice = priceHistory.reduce<PublicPricePoint | null>(
      (best, p) => (!best || p.final < best.final ? p : best),
      null,
    );

    const rank: PublicRank | null = rankRow
      ? {
          weeksCharted: rankRow.weeksCharted,
          peakRank: rankRow.peakRank,
          avgRank: rankRow.avgRank,
          peakPercentile: rankRow.peakPercentile,
          weeksTopDecile: rankRow.weeksTopDecile,
          computedAt: rankRow.computedAt,
        }
      : null;

    const reviewLanguages = reviewLanguagesRow?.reviewLanguages;

    const blog = publishedBlog
      ? {
          slugByLocale: Object.fromEntries(
            publishedBlog.translations.map((t) => [t.locale, t.slug]),
          ) as { en?: string; fr?: string },
        }
      : null;

    const estimateSnapshots: PublicEstimateSnapshot[] =
      estimateSnapshotRows.map((s) => ({
        computedAt: s.computedAt,
        estimatedTodayLow: s.estimatedTodayLow,
        estimatedTodayHigh: s.estimatedTodayHigh,
        estimatedTodayUnits: s.estimatedTodayUnits,
      }));

    return {
      id: game.id,
      igdbId: game.igdbId,
      name: game.name,
      slug: game.slug,
      releaseDate: game.releaseDate,
      coverUrl: game.coverUrl,
      summary: game.summary,
      isFree: game.isFree,
      platforms: game.platforms,
      developer: game.developer?.trim() || null,
      publisher: shownPublisher(game),
      genres: game.genres ?? [],
      sources: game.sources,
      salesBreakdown: breakdown,
      totalSales: total,
      // Always our model, never a declared milestone: the listing, the search
      // panel, the admin page and this page all show the same estimate.
      // Declared worldwide figures stay available as a cross-check through
      // `totalSales` / `reconciliation`.
      headline: estimatedToday,
      reconciliation,
      estimatedToday,
      estimateOutOfScope: outOfScope,
      // Hidden by hand rather than by the 2017 floor: the page explains why.
      estimateHidden,
      awaitingRelease: unreleased,
      estimateSnapshots,
      reviewHistory,
      followersHistory,
      twitchViewersHistory,
      psRatingsHistory,
      xboxRatingsHistory,
      switchRatingsHistory,
      ccuHistory,
      peakCcu: peakCcuRow
        ? { value: peakCcuRow.value, capturedAt: peakCcuRow.capturedAt }
        : null,
      priceHistory,
      currentPrice,
      lowestPrice,
      priceCountry,
      priceStore,
      availablePriceStores,
      regionalPrices,
      rank,
      storeRatings,
      reviewLanguages: reviewLanguages ?? null,
      blog,
      // The sales above cover every edition (see GameEdition).
      editions: editionRows.map((e) => ({
        name: e.name,
        versionTitle: e.versionTitle,
        releaseDate: e.releaseDate,
      })),
      igdbFacts: {
        gameType: game.gameType,
        parentGame: lineage.parentGame,
        derivedGames: lineage.derivedGames,
        gameModes: game.gameModes ?? [],
      } satisfies PublicIgdbFacts,
      // Store pages IGDB links beyond the ones we track (see `sources`).
      otherStores: {
        epicUrl: game.igdbEpicUrl,
        gogUrl: game.igdbGogUrl,
      },
    };
  }

  /**
   * The game a remake, remaster or port comes from, and the catalog games
   * that come from this one (both from IGDB `parent_game`). A parent outside
   * the catalog keeps its IGDB name with no slug.
   */
  private async igdbLineage(game: Game): Promise<{
    parentGame: PublicIgdbFacts['parentGame'];
    derivedGames: PublicIgdbFacts['derivedGames'];
  }> {
    const [parent, derived] = await Promise.all([
      game.igdbParentGameId
        ? this.games.findOne({
            where: { igdbId: game.igdbParentGameId },
            select: { id: true, name: true, slug: true },
          })
        : null,
      game.igdbId
        ? this.games.find({
            where: { igdbParentGameId: game.igdbId },
            select: { id: true, name: true, slug: true, gameType: true },
            order: {
              releaseDate: { direction: 'ASC', nulls: 'LAST' },
              name: 'ASC',
            },
            take: 10,
          })
        : [],
    ]);
    return {
      parentGame: game.igdbParentGameName
        ? {
            name: parent?.name ?? game.igdbParentGameName,
            slug: parent?.slug ?? null,
          }
        : null,
      derivedGames: derived.map((g) => ({
        name: g.name,
        slug: g.slug,
        gameType: g.gameType,
      })),
    };
  }

  /**
   * Every sourced sales figure of one game, oldest first, for a page that
   * tracks a launch figure by figure. Rejected rows, player counts and
   * third-party model estimates are left out; notes are internal and never
   * exposed. Shown even before launch, unlike the game page.
   */
  async getSalesTimeline(slug: string) {
    const games: { id: string; name: string; releaseDate: Date | null }[] =
      await this.games.query(
        `SELECT id, name, "releaseDate" FROM game
          WHERE slug = $1 AND "deletedAt" IS NULL`,
        [slug],
      );
    const game = games[0];
    if (!game) throw new NotFoundException(`Game "${slug}" not found`);
    const figures: {
      units: number;
      platform: string;
      source: string;
      publisher: string | null;
      sourceUrl: string | null;
      reportedAt: Date | null;
    }[] = await this.milestones.query(
      `SELECT units, platform, source, publisher, "sourceUrl", "reportedAt"
         FROM milestone
        WHERE "gameId" = $1 AND "rejectedAt" IS NULL
          AND NOT "isEngagement" AND NOT "isEstimate"
        ORDER BY "reportedAt" ASC NULLS LAST, units ASC`,
      [game.id],
    );
    return {
      name: game.name,
      releaseDate: game.releaseDate,
      figures,
    };
  }

  /**
   * Cumulative Steam reviews of one game by days since its PC launch, for a
   * page that compares launches of the same series when no sales figure
   * exists (the Call of Duty HQ games). Day 0 is the PC release date, else
   * the game's release date.
   *
   * Reconstructed history (`appreviewhistogram` backfill) is stored as one
   * row per month at the month's first midnight, holding the total at the END
   * of that month: those rows are moved to the next month's first day, so
   * each point sits at the age it really measured. Cron rows keep their day.
   * One point per day (the highest), pre-launch days dropped, two years max.
   * Cached by the page for an hour; only the comparison page calls it.
   */
  async getSteamReviewCurve(slug: string) {
    const games: { id: string; name: string; launch: string | null }[] =
      await this.games.query(
        `SELECT g.id, g.name,
                COALESCE(pc."releaseDate", g."releaseDate")::date::text AS launch
           FROM game g
           LEFT JOIN game_platform_release_date pc
             ON pc."gameId" = g.id AND pc.platform = 'PC'
          WHERE g.slug = $1 AND g."deletedAt" IS NULL`,
        [slug],
      );
    const game = games[0];
    if (!game) throw new NotFoundException(`Game "${slug}" not found`);
    if (!game.launch) return { name: game.name, launch: null, points: [] };
    // A backfilled month row is written at local midnight of the 1st, which
    // reads as 00:00-02:00 depending on the writer's time zone; cron rows
    // carry seconds and fractions, so they never match.
    const points: { day: number; reviews: number }[] = await this.signals
      .query(
        `SELECT (d.day - $2::date) AS day, MAX(d.value)::int AS reviews
           FROM (
             SELECT CASE
                      WHEN date_part('day', "capturedAt") = 1
                       AND "capturedAt"::time IN ('00:00', '01:00', '02:00')
                      THEN (date_trunc('month', "capturedAt") + interval '1 month')::date
                      ELSE "capturedAt"::date
                    END AS day,
                    value
               FROM signal_snapshot
              WHERE "gameId" = $1 AND metric = 'STEAM_REVIEWS'
                AND NOT synthetic
           ) d
          WHERE d.day >= $2::date AND d.day <= $2::date + 730
          GROUP BY d.day
          ORDER BY d.day`,
        [game.id, game.launch],
      )
      .then((rows: { day: number; reviews: number }[]) =>
        rows.map((r) => ({ day: Number(r.day), reviews: Number(r.reviews) })),
      );
    // When Activision folds a game into the HQ app, its own page stops
    // counting and the total falls to ~0 (MW III, then BO6 in 2026): the
    // series ends at the last point before that fall.
    let peak = 0;
    const end = points.findIndex((p) => {
      const fell = p.reviews < peak / 2;
      peak = Math.max(peak, p.reviews);
      return fell;
    });
    return {
      name: game.name,
      launch: game.launch,
      points: end === -1 ? points : points.slice(0, end),
    };
  }

  /**
   * Where the URL of a game merged into another now leads: an edition game
   * folded into its base keeps its IGDB id once soft-deleted, and that id is
   * one of the base game's editions. Null when the slug is not such a game.
   */
  async findRedirectSlug(slug: string): Promise<{ slug: string } | null> {
    const rows: { slug: string }[] = await this.games.query(
      `SELECT base.slug
         FROM game old
         JOIN game_edition e ON e."igdbId" = old."igdbId"
         JOIN game base ON base.id = e."gameId" AND base."deletedAt" IS NULL
        WHERE old.slug = $1 AND old."deletedAt" IS NOT NULL
        LIMIT 1`,
      [slug],
    );
    return rows[0] ? { slug: rows[0].slug } : null;
  }

  private async latestRegionalPrices(
    gameId: string,
    source: SourceType,
  ): Promise<PublicRegionalPrice[]> {
    const rows: PublicRegionalPrice[] = await this.prices.query(
      `SELECT DISTINCT ON (country)
         country, currency, initial, final, "discountPercent"
       FROM price_snapshot
       WHERE "gameId" = $1 AND source = $2
       ORDER BY country, "capturedAt" DESC`,
      [gameId, source],
    );
    return rows;
  }

  private async availablePriceStores(
    gameId: string,
  ): Promise<PublicPriceStore[]> {
    const rows: Array<{ source: SourceType }> = await this.prices.query(
      `SELECT DISTINCT source FROM price_snapshot WHERE "gameId" = $1`,
      [gameId],
    );
    const stores: PublicPriceStore[] = [];
    if (rows.some((r) => r.source === SourceType.STEAM)) stores.push('steam');
    if (rows.some((r) => r.source === SourceType.XBOX_STORE))
      stores.push('xbox');
    if (rows.some((r) => r.source === SourceType.PS_STORE))
      stores.push('playstation');
    return stores;
  }

  private resolvePriceStore(
    requested: string | undefined,
    available: PublicPriceStore[],
  ): PublicPriceStore {
    if (requested === 'playstation' && available.includes('playstation')) {
      return 'playstation';
    }
    if (requested === 'xbox' && available.includes('xbox')) return 'xbox';
    if (requested === 'steam' && available.includes('steam')) return 'steam';
    if (available.includes('steam')) return 'steam';
    if (available.includes('xbox')) return 'xbox';
    if (available.includes('playstation')) return 'playstation';
    return 'steam';
  }

  private async buildStoreRatings(gameId: string): Promise<StoreRatings> {
    const metrics = [
      SignalMetric.STEAM_REVIEWS,
      SignalMetric.STEAM_REVIEWER_MEDIAN_PLAYTIME,
      SignalMetric.PS_RATINGS,
      SignalMetric.XBOX_RATINGS,
    ];

    const snapshots = await this.signals.find({
      where: { gameId, metric: In(metrics), synthetic: false },
      order: { capturedAt: 'DESC' },
      select: { metric: true, value: true, averageRating: true },
    });

    const latest = new Map<SignalMetric, (typeof snapshots)[0]>();
    for (const s of snapshots) {
      if (!latest.has(s.metric)) latest.set(s.metric, s);
    }

    const steam = latest.get(SignalMetric.STEAM_REVIEWS);
    const steamPlaytime = latest.get(
      SignalMetric.STEAM_REVIEWER_MEDIAN_PLAYTIME,
    );
    const ps = latest.get(SignalMetric.PS_RATINGS);
    const xbox = latest.get(SignalMetric.XBOX_RATINGS);

    return {
      steam: steam
        ? {
            reviews: steam.value,
            reviewerMedianPlaytimeMinutes: steamPlaytime?.value ?? null,
          }
        : null,
      playstation: ps
        ? { reviews: ps.value, score: ps.averageRating ?? null }
        : null,
      xbox: xbox
        ? { reviews: xbox.value, score: xbox.averageRating ?? null }
        : null,
    };
  }

  /**
   * Persist a snapshot of the headline "today" range and the per-platform
   * reconciliation as they stand right now (or as they stood at `asOf` for
   * a historical replay). Idempotent: calling twice in the same second
   * for the same game produces two rows — callers that don't want
   * duplicates should dedupe upstream (the cron refresh is naturally
   * de-duped because it runs at most once a day per game).
   *
   * When `asOf` is provided, declared figures dated *after* `asOf` are
   * dropped (we reconstruct what the reconciliation would have looked
   * like at that point in time), and only the most recent estimate per
   * platform with `computedAt <= asOf` is considered.
   */
  async snapshotReconcile(gameId: string, asOf?: Date): Promise<void> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return;

    const milestones = await this.milestonesAsOf(gameId, asOf);
    const estimates = await this.latestEstimates(gameId, asOf);
    const { reconciliation, estimatedToday } = this.aggregateSales(
      milestones,
      estimates,
      game.releaseDate,
      asOf,
    );

    if (!estimatedToday) return;

    await this.estimateSnapshots.save(
      this.estimateSnapshots.create({
        gameId,
        estimatedTodayLow: Math.round(estimatedToday.low),
        estimatedTodayHigh: Math.round(estimatedToday.high),
        estimatedTodayUnits: Math.round(estimatedToday.units),
        reconciliation: reconciliation.map(serializeReconciliationEntry),
        computedAt: asOf ?? new Date(),
      }),
    );
  }

  /**
   * Replay the entire estimate history for a game using current
   * multipliers and constants. This is the canonical recompute pathway:
   * the refresh flow calls it after every scrape (so a freshly arrived
   * declared figure can recalibrate the multiplier and propagate
   * backwards in time), and the admin "Refresh & rebuild" button hits
   * the same code path through `IngestionService.refreshGame`.
   *
   * Pipeline:
   *  1. `recalibrateAll`: re-derive `Game.calibrated*Multiplier` from
   *     the latest declared figures. Idempotent when nothing changed.
   *  2. Find every distinct signal-capture moment (SignalSnapshot ∪
   *     AchievementSnapshot), dedup at minute granularity.
   *  3. Wipe all existing SalesEstimate + EstimateSnapshot rows for the
   *     game (clean slate; estimates are derivatives, never primary data).
   *  4. PERF: recompute only the latest capture moment T (was: every moment,
   *     to rebuild the whole estimate graph — that loop is kept commented out
   *     in the body for later). Runs `computeAndStoreAt(gameId, T)` then
   *     `snapshotReconcile(gameId, T)` using the multipliers **as they stand
   *     after step 1**. Leaves a single (latest) point until the full replay
   *     is restored.
   *
   * Returns the count of (estimate, snapshot) rows produced.
   */
  async rebuildEstimateHistory(
    gameId: string,
  ): Promise<{ points: number; estimates: number; snapshots: number }> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { platformReleaseDates: true },
    });
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);
    if (game.isFree) return { points: 0, estimates: 0, snapshots: 0 };

    const moments = await this.collectCaptureMoments(
      gameId,
      platformReleaseDate(game, Platform.PC),
    );
    this.logger.log(
      `[rebuild] "${game.name}" — ${moments.length} historical capture moments`,
    );

    await this.estimates.delete({ gameId });
    await this.estimateSnapshots.delete({ gameId });

    let estimates = 0;
    let snapshots = 0;

    // PERF: only recompute the most recent capture moment instead of replaying
    // the whole history. Replaying every moment is what populates the full
    // estimate time-series (the graph), but it costs O(moments) DB round-trips
    // per game and dominates refresh time. We keep the clean-slate delete above
    // so this leaves exactly one point (the latest); `persistEstimates` inserts
    // (not upserts), so skipping the wipe would duplicate rows on re-run.
    // The point-by-point replay is preserved (commented out) just below —
    // restore it to bring the historical graph back.
    const lastMoment = moments[moments.length - 1];
    if (lastMoment) {
      const inserted = await this.estimation.computeAndStoreAt(
        gameId,
        lastMoment,
      );
      estimates += inserted.length;
      if (inserted.length > 0) {
        const before = await this.estimateSnapshots.count({
          where: { gameId },
        });
        await this.snapshotReconcile(gameId, lastMoment);
        const after = await this.estimateSnapshots.count({ where: { gameId } });
        snapshots += after - before;
      }
    }

    // --- Full historical replay: recompute EVERY capture moment to rebuild the
    // --- estimate time-series (graph). Disabled for performance; re-enable
    // --- (and remove the single-point block above) to restore the graph.
    // for (const t of moments) {
    //   const inserted = await this.estimation.computeAndStoreAt(gameId, t);
    //   if (inserted.length === 0) continue;
    //   estimates += inserted.length;
    //
    //   const before = await this.estimateSnapshots.count({ where: { gameId } });
    //   await this.snapshotReconcile(gameId, t);
    //   const after = await this.estimateSnapshots.count({ where: { gameId } });
    //   snapshots += after - before;
    // }

    return { points: moments.length, estimates, snapshots };
  }

  /**
   * Distinct minute-aligned capture timestamps across SignalSnapshot for a
   * game, ascending. Dedup at minute granularity because a single cron run
   * writes several signals within the same second/minute — we want one rebuild
   * point per refresh, not one per signal.
   *
   * Daily `STEAM_CONCURRENT` points past the launch week are skipped: the
   * estimate only reads CCU as the all-time `STEAM_PEAK_CCU` (intersection)
   * and the week-1 `STEAM_CONCURRENT` max (first-week extrapolation), so a
   * post-launch daily reading never changes the result. Without this, a
   * SteamDB CSV import (years of daily rows) would generate thousands of
   * identical rebuild moments and make the rebuild crawl.
   *
   * Daily `STEAM_REVIEWS` points past the launch window are downsampled on
   * a progressive, age-tiered schedule. Reviews are the live Boxleiter
   * input so they DO move the estimate over time (unlike CCU) and can't be
   * dropped, but the mature sales curve needs less resolution as it flattens
   * — and a SteamDB review CSV import backfills a daily value from launch
   * (hundreds to thousands of rows). Tiers by age since release:
   *   - launch window (≤ `FIRST_WEEK_PEAK_CCU_WINDOW_DAYS`): daily (steep
   *     curve, feeds the first-week extrapolation);
   *   - launch window → `REVIEWS_REBUILD_MONTHLY_AFTER_DAYS`: one point per
   *     `REVIEWS_REBUILD_BUCKET_DAYS` (weekly);
   *   - beyond that: one point per `REVIEWS_REBUILD_MONTHLY_BUCKET_DAYS`
   *     (monthly).
   * Games with no release date can't be age-tiered and keep the weekly
   * bucket for everything past a (nonexistent) launch window.
   *
   * Milestone `reportedAt` dates are added too: the reconciled headline
   * also shifts when a declared figure becomes visible, independently of
   * any signal. Skipping the daily CCU moments removes the implicit
   * sampling clock those signals used to provide, so the milestone dates
   * are needed to still capture every headline change.
   */
  private async collectCaptureMoments(
    gameId: string,
    // The windows below gate STEAM_CONCURRENT / STEAM_REVIEWS only, so the
    // caller passes the PC-scoped release date (falls back to the game-wide
    // `releaseDate` when no per-platform date is known).
    releaseDate: Date | null,
  ): Promise<Date[]> {
    const signals = await this.signals.find({
      where: { gameId },
      select: { capturedAt: true, metric: true },
      order: { capturedAt: 'ASC' },
    });

    const milestones = await this.milestones.find({
      where: { gameId, isEngagement: false },
      select: { reportedAt: true },
    });

    const weekOneEnd = releaseDate
      ? releaseDate.getTime() +
        FIRST_WEEK_PEAK_CCU_WINDOW_DAYS * 24 * 3600 * 1000
      : null;

    const byMinute = new Map<number, Date>();
    const addMoment = (t: Date) => {
      const minuteKey = Math.floor(t.getTime() / 60_000);
      if (!byMinute.has(minuteKey)) byMinute.set(minuteKey, t);
    };

    const weeklyBucketMs = REVIEWS_REBUILD_BUCKET_DAYS * 24 * 3600 * 1000;
    const monthlyBucketMs =
      REVIEWS_REBUILD_MONTHLY_BUCKET_DAYS * 24 * 3600 * 1000;
    const monthlyThreshold = releaseDate
      ? releaseDate.getTime() +
        REVIEWS_REBUILD_MONTHLY_AFTER_DAYS * 24 * 3600 * 1000
      : null;
    const seenReviewBuckets = new Set<string>();

    for (const row of signals) {
      const t = row.capturedAt.getTime();
      const pastLaunchWindow = weekOneEnd === null || t > weekOneEnd;

      if (row.metric === SignalMetric.STEAM_CONCURRENT && pastLaunchWindow) {
        continue;
      }

      if (row.metric === SignalMetric.STEAM_REVIEWS && pastLaunchWindow) {
        const isMature = monthlyThreshold !== null && t > monthlyThreshold;
        const bucketMs = isMature ? monthlyBucketMs : weeklyBucketMs;
        const bucketKey = `${isMature ? 'm' : 'w'}:${Math.floor(t / bucketMs)}`;
        if (seenReviewBuckets.has(bucketKey)) continue;
        seenReviewBuckets.add(bucketKey);
      }

      addMoment(row.capturedAt);
    }

    for (const milestone of milestones) {
      if (milestone.reportedAt) addMoment(milestone.reportedAt);
    }

    return Array.from(byMinute.values()).sort(
      (a, b) => a.getTime() - b.getTime(),
    );
  }

  /**
   * Milestones visible at `asOf`. When `asOf` is undefined: all
   * milestones (live mode). When provided: milestones whose `reportedAt`
   * is before `asOf`, plus the rare legacy row with no `reportedAt`
   * (ingestion now rejects undated milestones, but pre-existing rows
   * may still be in the table).
   */
  private async milestonesAsOf(
    gameId: string,
    asOf?: Date,
  ): Promise<Milestone[]> {
    if (!asOf) {
      return this.milestones.find({
        where: {
          gameId,
          isEngagement: false,
          platform: Platform.GLOBAL,
        },
      });
    }
    return this.milestones.find({
      where: {
        gameId,
        isEngagement: false,
        platform: Platform.GLOBAL,
        reportedAt: Or(LessThanOrEqual(asOf), IsNull()),
      },
    });
  }

  /**
   * Build the per-platform breakdown and the headline total. For each
   * platform we keep the highest declared milestone (sales only grow, so a
   * later report below an earlier one is noise — enforcing monotonicity
   * prevents the headline from dropping when sources disagree), falling
   * back to an estimate when no concrete figure exists. A GLOBAL worldwide
   * figure (e.g. Wikipedia) is not a platform line: it only feeds `total`
   * (the reported cross-check), never the figure the site displays — that one
   * is always `estimatedToday`.
   */
  private aggregateSales(
    milestones: Milestone[],
    estimates: LatestEstimates,
    releaseDate: Date | null,
    asOf?: Date,
  ): {
    breakdown: PlatformSales[];
    total: TotalSales | null;
    reconciliation: ReconciliationEntry[];
    estimatedToday: EstimatedToday | null;
  } {
    // Milestones are worldwide totals only — there is no per-platform
    // declared figure anymore, so every milestone is a global milestone and
    // the per-platform declared map stays empty (platform lines are filled
    // from estimates below). Engagement rows ("players reached", subscription
    // users included) are dropped here: they are not copies sold and must
    // never anchor the headline total.
    const globalMilestones: Milestone[] = milestones.filter(
      (m) => !m.isEngagement,
    );
    const bestByPlatform = new Map<Platform, Milestone>();

    // Highest declared worldwide figure (if any) — used as a floor +
    // freshness-aware cap on the platform-summed estimate below. We pick the
    // largest declared value (not the most recent) so contradictory sources
    // can't drag the headline DOWN over time: declared sales are monotonic.
    const bestGlobal = globalMilestones.reduce<Milestone | null>(
      (best, m) => (!best || this.isMoreAuthoritative(m, best) ? m : best),
      null,
    );

    const { reconciliation, estimatedToday, usesMl } = this.reconcile(
      bestByPlatform,
      estimates,
      bestGlobal,
      releaseDate,
      asOf,
    );
    // Headline-level cross-check: how the Boxleiter-derived "today" estimate
    // sits relative to the most reliable global declared figure. Used to
    // adjust the headline confidence (boost when corroborated, drop on
    // conflict).
    const globalAgreement =
      reconciliation.find((r) => r.platform === Platform.GLOBAL)?.agreement ??
      null;

    // Declared figures are worldwide-only now, so the per-platform breakdown
    // is built entirely from estimates; the worldwide milestone anchors the
    // headline total via `buildTotal` below.
    const breakdown: PlatformSales[] = [];

    // When the headline is the ML estimate, the platform methods still give
    // the split: every platform range is scaled by the same factor, so the
    // platform figures (midpoints) add up to the headline.
    const platformRows = [...estimates.byPlatform].filter(
      ([platform]) => !bestByPlatform.has(platform),
    );
    const platformUnits = platformRows.reduce(
      (sum, [, e]) => sum + midpoint(e.estimatedLow, e.estimatedHigh),
      0,
    );
    const scale =
      usesMl && estimatedToday && platformUnits > 0
        ? estimatedToday.units / platformUnits
        : 1;

    for (const [platform, estimate] of platformRows) {
      breakdown.push({
        platform,
        low: Math.round(estimate.estimatedLow * scale),
        high: Math.round(estimate.estimatedHigh * scale),
        source: 'ESTIMATE',
        confidence: null,
        sourceUrl: null,
        agreement: null,
      });
    }

    breakdown.sort((a, b) => b.high - a.high);

    return {
      breakdown,
      total: this.buildTotal(breakdown, globalMilestones, globalAgreement),
      reconciliation,
      estimatedToday,
    };
  }

  /**
   * Cross-check each platform's declared figure against our independent
   * estimate. Produces a reconciliation entry per platform that has both, and
   * a single "today" estimate: per platform we take the live value, treating a
   * declared figure as a floor sales can only have grown past (Level 2).
   */
  private reconcile(
    bestByPlatform: Map<Platform, Milestone>,
    { byPlatform: estimates, ml }: LatestEstimates,
    globalDeclared: Milestone | null,
    releaseDate: Date | null,
    asOf?: Date,
  ): {
    reconciliation: ReconciliationEntry[];
    estimatedToday: EstimatedToday | null;
    usesMl: boolean;
  } {
    const reconciliation: ReconciliationEntry[] = [];
    let todayLow = 0;
    let todayHigh = 0;
    let hasToday = false;

    const platforms = new Set<Platform>([
      ...bestByPlatform.keys(),
      ...estimates.keys(),
    ]);

    // Console-weight evidence: sum of every declared console (PS/XBOX)
    // figure we have for this game. Used to detect when a Boxleiter PC
    // estimate alone would dramatically under-represent the title (PS
    // exclusive, console-heavy AAA with a tiny PC port…). When this evidence
    // dwarfs the PC estimate we drop the PC estimate's contribution to
    // `estimatedToday` rather than let it set the headline number.
    //
    // A GLOBAL worldwide figure is deliberately NOT counted here: it carries
    // no PC/console split, so on a PC-only title it would wrongly flag PC as
    // marginal and, since PC is the only contributor, leave the headline
    // empty. The worldwide figure still anchors the headline as a floor/cap
    // in the GLOBAL block below.
    let consoleEvidence = 0;
    for (const [platform, milestone] of bestByPlatform) {
      if (platform === Platform.PLAYSTATION || platform === Platform.XBOX) {
        consoleEvidence += milestone.units;
      }
    }

    for (const platform of platforms) {
      if (platform === Platform.GLOBAL) continue;
      const declared = bestByPlatform.get(platform);
      const estimate = estimates.get(platform);

      let low: number | null = null;
      let high: number | null = null;

      if (declared && estimate) {
        const cap = this.freshnessCap(declared, releaseDate, asOf);
        low = Math.max(declared.units, Math.min(estimate.estimatedLow, cap));
        high = Math.max(declared.units, Math.min(estimate.estimatedHigh, cap));

        const cls = this.classifyAgreement(
          declared.units,
          declared.reportedAt,
          estimate.estimatedLow,
          estimate.estimatedHigh,
          midpoint(estimate.estimatedLow, estimate.estimatedHigh),
          asOf,
        );
        reconciliation.push({
          platform,
          declaredUnits: declared.units,
          declaredSource: declared.source,
          declaredAt: declared.reportedAt,
          estimateLow: estimate.estimatedLow,
          estimateHigh: estimate.estimatedHigh,
          estimateMethod: estimate.method,
          agreement: cls.agreement,
          ratio: Math.round(cls.ratio * 100) / 100,
          detail: cls.detail,
        });
      } else if (declared) {
        low = declared.units;
        high = declared.units;
      } else if (estimate) {
        // Guardrail: Boxleiter PC estimates are unreliable when console
        // declared figures suggest PC is a marginal share of total sales
        // (PS-exclusive PC port, Switch first-party with a tiny PC release…).
        if (
          platform === Platform.PC &&
          consoleEvidence > 0 &&
          this.isPcMarginal(estimate, consoleEvidence)
        ) {
          continue;
        }
        low = estimate.estimatedLow;
        high = estimate.estimatedHigh;
      }

      if (low !== null && high !== null) {
        todayLow += low;
        todayHigh += high;
        hasToday = true;
      }
    }

    // The worldwide ML estimate, when the batch has one, replaces the platform
    // sum: it is only stored where the model was validated (see
    // `mlEstimateApplies`). Its single figure is the geometric midpoint of
    // estimate ÷/× factor, i.e. the estimate itself.
    const usesMl = hasToday && ml !== null;
    const today =
      usesMl && ml
        ? {
            low: ml.estimatedLow,
            high: ml.estimatedHigh,
            units: Math.sqrt(ml.estimatedLow * ml.estimatedHigh),
            method: ML_METHOD_CODE,
          }
        : hasToday
          ? {
              low: todayLow,
              high: todayHigh,
              units: midpoint(todayLow, todayHigh),
              method: 'platform-sum',
            }
          : null;

    // A worldwide declared figure (e.g. "30M copies sold worldwide") no longer
    // adjusts the headline estimate: the estimate reflects the corpus model
    // alone. The declared figure is surfaced purely as a reconciliation entry
    // (informational cross-check) and still drives `buildTotal`'s reported
    // headline, but it never floors or caps `estimatedToday`.
    if (globalDeclared && today) {
      const cls = this.classifyAgreement(
        globalDeclared.units,
        globalDeclared.reportedAt,
        today.low,
        today.high,
        today.units,
        asOf,
      );
      reconciliation.push({
        platform: Platform.GLOBAL,
        declaredUnits: globalDeclared.units,
        declaredSource: globalDeclared.source,
        declaredAt: globalDeclared.reportedAt,
        estimateLow: today.low,
        estimateHigh: today.high,
        estimateMethod: today.method,
        agreement: cls.agreement,
        ratio: Math.round(cls.ratio * 100) / 100,
        detail: cls.detail,
      });
    }

    reconciliation.sort((a, b) => b.declaredUnits - a.declaredUnits);

    return {
      reconciliation,
      estimatedToday: today && {
        low: today.low,
        high: today.high,
        units: today.units,
      },
      usesMl,
    };
  }

  /**
   * Build the upper bound for "today" derived from a dated declared figure.
   * Sales follow a front-loaded decay curve, so growth potential between the
   * declared date and today depends on where each falls on the game's
   * lifetime curve, not just on calendar time.
   *
   * Uses `lifetimeSalesPct` + buffers from `sales-modeling.constants.ts`.
   * Falls back to a flat annual-growth model when the release date is
   * unknown (older catalog entries).
   */
  /**
   * True when the Boxleiter PC estimate represents less than
   * PC_DOMINANCE_RATIO_THRESHOLD of the cross-checked PC + console total,
   * meaning PC is a marginal channel for this title (console-exclusive PC
   * port, Switch first-party port…). In that case the PC estimate can't be
   * trusted to drive the headline number on its own.
   */
  private isPcMarginal(
    estimate: SalesEstimate,
    consoleEvidence: number,
  ): boolean {
    const pcMid = (estimate.estimatedLow + estimate.estimatedHigh) / 2;
    if (pcMid <= 0) return true;
    const share = pcMid / (pcMid + consoleEvidence);
    return share < PC_DOMINANCE_RATIO_THRESHOLD;
  }

  private freshnessCap(
    declared: Milestone,
    releaseDate: Date | null,
    asOf: Date = new Date(),
  ): number {
    if (!declared.reportedAt) return Number.POSITIVE_INFINITY;

    if (releaseDate) {
      const declaredPct = lifetimeSalesPct(
        ageInDays(releaseDate, declared.reportedAt),
      );
      const todayPct = lifetimeSalesPct(ageInDays(releaseDate, asOf));

      // Pre-release declared shouldn't happen; fall through to the time-based
      // formula in that case.
      if (declaredPct > 0) {
        const expectedRatio = todayPct / declaredPct;
        const cap =
          declared.units *
          (1 + (expectedRatio - 1) * FRESHNESS_VARIANCE_BUFFER);
        return Math.max(cap, declared.units * FRESHNESS_MIN_HEADROOM);
      }
    }

    const ageYears = Math.max(0, ageInYears(declared.reportedAt, asOf));
    if (ageYears >= FALLBACK_GROWTH_CAP_YEARS) return Number.POSITIVE_INFINITY;
    return declared.units * (1 + FALLBACK_ANNUAL_GROWTH * ageYears);
  }

  /**
   * Classify how a dated declared figure sits relative to our estimate range,
   * accounting for the fact that sales only grow: an estimate above an old
   * declared figure is plausible growth, while a declared figure above our
   * whole range means the model undershoots a known number.
   */
  private classifyAgreement(
    declared: number,
    declaredAt: Date | null,
    estLow: number,
    estHigh: number,
    estUnits: number,
    asOf: Date = new Date(),
  ): { agreement: Agreement; ratio: number; detail: string } {
    const ratio = declared > 0 ? estUnits / declared : 0;

    if (declared >= estLow && declared <= estHigh) {
      return {
        agreement: 'strong',
        ratio,
        detail: 'Declared figure falls within the estimated range.',
      };
    }

    if (declared > estHigh) {
      const overshoot = estHigh > 0 ? declared / estHigh : Infinity;
      return overshoot <= AGREEMENT_OVERSHOOT_RATIO
        ? {
            agreement: 'weak',
            ratio,
            detail:
              'Declared figure sits just above the estimate; the model slightly undershoots.',
          }
        : {
            agreement: 'conflict',
            ratio,
            detail:
              'Declared figure is well above the estimate — the model undershoots or the figure may be mismatched.',
          };
    }

    // declared < estLow: we estimate more than was ever declared. Plausible if
    // the figure is old; relax the threshold with its age.
    const ageYears = declaredAt ? Math.max(0, ageInYears(declaredAt, asOf)) : 0;
    const growthBudget = 1 + AGREEMENT_GROWTH_PER_YEAR * ageYears;
    const over = declared > 0 ? estLow / declared : Infinity;

    if (over <= growthBudget) {
      return {
        agreement: 'weak',
        ratio,
        detail:
          'Estimate exceeds the older declared figure, consistent with sales growth since then.',
      };
    }
    if (over <= growthBudget * 2) {
      return {
        agreement: 'weak',
        ratio,
        detail:
          'Estimate is above the declared figure beyond typical growth; treat with caution.',
      };
    }
    return {
      agreement: 'conflict',
      ratio,
      detail:
        'Estimate is far above any declared figure even allowing for growth — likely an estimation outlier.',
    };
  }

  private buildTotal(
    breakdown: PlatformSales[],
    globalMilestones: Milestone[],
    globalAgreement: Agreement | null,
  ): TotalSales | null {
    const reported = globalMilestones.reduce<Milestone | null>(
      (best, m) => (!best || this.isLater(m, best) ? m : best),
      null,
    );

    if (reported) {
      const baseConfidence = scoreToLevel(reported.confidenceScore);
      return {
        low: reported.units,
        high: reported.units,
        basis: 'reported',
        sources: [reported.source],
        source: reported.source,
        sourceUrl: reported.sourceUrl,
        note: reported.note,
        reportedAt: reported.reportedAt,
        confidence: this.adjustConfidence(baseConfidence, globalAgreement),
      };
    }

    if (breakdown.length === 0) return null;

    return {
      low: breakdown.reduce((sum, p) => sum + p.low, 0),
      high: breakdown.reduce((sum, p) => sum + p.high, 0),
      basis: 'sum',
      sources: [...new Set(breakdown.map((p) => p.source))],
      source: null,
      sourceUrl: null,
      note: null,
      reportedAt: null,
      confidence: null,
    };
  }

  /**
   * Adjust the headline confidence based on how the Boxleiter-derived
   * estimate agrees with the declared figure:
   *   - strong: model brackets the declared figure → trust HIGH (the
   *     figure is independently corroborated).
   *   - weak: plausible but off → keep the milestone-derived default.
   *   - conflict: model strongly disagrees → drop one notch (figure or
   *     model is suspect).
   * `null` base means we have no milestone confidence to bootstrap from
   * — only `strong` agreement can promote it (to HIGH).
   */
  private adjustConfidence(
    base: ConfidenceLevel | null,
    agreement: Agreement | null,
  ): ConfidenceLevel | null {
    if (!agreement) return base;
    if (agreement === 'strong') return ConfidenceLevel.HIGH;
    if (agreement === 'conflict') {
      if (base === ConfidenceLevel.HIGH) return ConfidenceLevel.MEDIUM;
      return ConfidenceLevel.LOW;
    }
    return base;
  }

  /**
   * Latest-dated wins. Dated milestones always beat undated ones (dates
   * are essential for reconciliation); between two dated milestones, the
   * more recent reportedAt wins (sales only grow); between two undated
   * ones the larger units count is the proxy for "more recent".
   */
  /**
   * Pick the more authoritative of two declared milestones for the same
   * platform (or GLOBAL). Declared sales are monotonic non-decreasing, so a
   * later report announcing FEWER units than an earlier one is treated as
   * noise: the higher figure wins as the floor. Equal units fall back to the
   * most recent report (freshest date for the freshness cap).
   */
  private isMoreAuthoritative(
    candidate: Milestone,
    current: Milestone,
  ): boolean {
    if (candidate.units !== current.units) {
      return candidate.units > current.units;
    }
    return this.isLater(candidate, current);
  }

  private isLater(candidate: Milestone, current: Milestone): boolean {
    const cDated = candidate.reportedAt !== null;
    const xDated = current.reportedAt !== null;
    if (cDated !== xDated) return cDated;

    if (cDated && xDated) {
      const ct = candidate.reportedAt!.getTime();
      const xt = current.reportedAt!.getTime();
      if (ct !== xt) return ct > xt;
    }

    return candidate.units > current.units;
  }

  // Raw queries (getRawMany) don't hydrate enum arrays: node-postgres returns
  // a user-defined enum[] column as the Postgres array literal "{PC,SWITCH}".
  // Normalize it back to a string[] so consumers always get an array.
  private parsePlatforms(value: Platform[] | string | null): Platform[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return value
      .replace(/^{|}$/g, '')
      .split(',')
      .map((p) => p.replace(/^"|"$/g, '').trim())
      .filter(Boolean) as Platform[];
  }

  /**
   * Pick the estimate to feed into reconciliation, per platform. We
   * prefer the `aggregated` row (weighted combination of every enabled
   * method written at the same `computedAt`). If no aggregate exists yet
   * for a platform — historical rows produced before the registry
   * migration, or a platform with no method enabled — we fall back on
   * whatever row is most recent. This keeps the headline stable during
   * the rollout while encouraging the aggregate to take over once
   * `rebuildEstimateHistory` has been replayed.
   */
  private async latestEstimates(
    gameId: string,
    asOf?: Date,
    since?: Date,
  ): Promise<LatestEstimates> {
    const aggregateMethod = this.estimationMethods.findByCode(
      AGGREGATED_METHOD_CODE,
    );
    const mlMethod = this.estimationMethods.findByCode(ML_METHOD_CODE);

    const estimates = await this.estimates.find({
      where: {
        gameId,
        ...(asOf && since
          ? { computedAt: And(MoreThanOrEqual(since), LessThanOrEqual(asOf)) }
          : asOf
            ? { computedAt: LessThanOrEqual(asOf) }
            : since
              ? { computedAt: MoreThanOrEqual(since) }
              : {}),
      },
      order: { computedAt: 'DESC' },
    });

    const aggregateByPlatform = new Map<Platform, SalesEstimate>();
    const fallbackByPlatform = new Map<Platform, SalesEstimate>();
    let ml: SalesEstimate | null = null;
    for (const estimate of estimates) {
      if (mlMethod && estimate.methodId === mlMethod.id) {
        ml ??= estimate;
        continue;
      }
      if (
        aggregateMethod &&
        estimate.methodId === aggregateMethod.id &&
        !aggregateByPlatform.has(estimate.platform)
      ) {
        aggregateByPlatform.set(estimate.platform, estimate);
        continue;
      }
      if (!fallbackByPlatform.has(estimate.platform)) {
        fallbackByPlatform.set(estimate.platform, estimate);
      }
    }

    const byPlatform = new Map<Platform, SalesEstimate>();
    for (const [platform, estimate] of fallbackByPlatform) {
      byPlatform.set(platform, aggregateByPlatform.get(platform) ?? estimate);
    }
    // Only the ML row of the same batch: a platform batch newer than it (a
    // failed ML run) falls back to the platform sum rather than mixing runs.
    const newestPlatform = Math.max(
      ...[...byPlatform.values()].map((e) => e.computedAt.getTime()),
    );
    if (ml && ml.computedAt.getTime() < newestPlatform) ml = null;
    return { byPlatform, ml };
  }

  /**
   * Pull the latest reconciled "today" estimate per game from
   * `estimate_snapshot`. This is the same source the public detail page and
   * the chart consume, so the list cards and the detail headline always agree.
   * Games without any snapshot are simply absent from the map (the card
   * renders "no estimate yet" rather than falling back to a raw PC Boxleiter
   * figure that would diverge from the detail headline).
   */
  private async latestReconciledEstimates(
    gameIds: string[],
  ): Promise<Map<string, EstimatedToday>> {
    const map = new Map<string, EstimatedToday>();
    if (gameIds.length === 0) return map;

    const rows = await this.estimateSnapshots
      .createQueryBuilder('s')
      .distinctOn(['s.gameId'])
      .select('s.gameId', 'gameId')
      .addSelect('s.estimatedTodayLow', 'low')
      .addSelect('s.estimatedTodayHigh', 'high')
      .addSelect('s.estimatedTodayUnits', 'units')
      .innerJoin(Game, 'g', 'g.id = s.gameId')
      .where('s.gameId IN (:...gameIds)', { gameIds })
      .andWhere(
        estimatePublicSql('g'),
        { estimateMinRelease: ESTIMATE_MIN_RELEASE },
      )
      .andWhere(computedAfterReleaseSql('g', 's."computedAt"'))
      .orderBy('s.gameId')
      .addOrderBy('s.computedAt', 'DESC')
      .getRawMany<{
        gameId: string;
        low: number;
        high: number;
        units: number | null;
      }>();

    for (const row of rows) {
      const low = Number(row.low);
      const high = Number(row.high);
      const units =
        row.units !== null ? Number(row.units) : midpoint(low, high);
      map.set(row.gameId, { low, high, units });
    }
    return map;
  }
}

/** The most frequent non-null value, ties broken alphabetically. */
function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return ranked[0]?.[0] ?? null;
}

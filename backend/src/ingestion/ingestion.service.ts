import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  Game,
  GameSource,
  Milestone,
  Platform,
  PriceSnapshot,
  ProcessedArticle,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
  SourceType,
  TrustedSource,
} from '../entities';
import { EstimationService } from '../estimation/estimation.service';
import { GamesService } from '../games/games.service';
import { deriveFranchise, deriveLiveService } from '../games/game-features';
import { slugify } from '../common/slug';
import { SteamAppDetails, SteamClient } from './steam.client';
import { SteamChartsClient } from './steamcharts.client';
import { IgdbClient, IgdbGame } from './igdb.client';
import { StoreRatingsClient } from './store-ratings.client';
import { WikipediaClient } from './wikipedia.client';
import { ArticleClient, ArticleSales } from './article.client';
import { RssClient } from './rss.client';
import { TavilyClient, TavilyResult } from './tavily.client';
import { PerplexityClient } from './perplexity.client';
import { ExophaseClient } from './exophase.client';
import { SourcesService } from '../sources/sources.service';
import { PublishersService } from '../publishers/publishers.service';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_MIN_RATING_COUNT,
  STEAM_MIN_REVIEWS,
} from './discovery.constants';

const STORE_SOURCE_BY_PLATFORM: Partial<Record<Platform, SourceType>> = {
  [Platform.PLAYSTATION]: SourceType.PS_STORE,
  [Platform.XBOX]: SourceType.XBOX_STORE,
};

// Default `confidenceScore` (0–100) assigned to milestones when no
// TrustedSource weight is available (manual inputs, Wikipedia, or unknown
// hosts falling back to the MEDIA tier). For sources matched in the
// trusted-source registry, the source's `weight` is written directly to
// `confidenceScore`.
const DEFAULT_CONFIDENCE_SCORE: Record<SalesSource, number> = {
  [SalesSource.OFFICIAL]: 100,
  [SalesSource.ANNOUNCEMENT]: 70,
  [SalesSource.WIKIPEDIA]: 45,
  [SalesSource.MEDIA]: 40,
  // Measured ground-truth (real player counts), hence high — but it is an
  // engagement figure, so it never feeds calibration regardless of score.
  [SalesSource.STEAM_LEAK]: 90,
};

// Domains we never want Tavily backlog discovery to surface:
//  - sales-estimation aggregators (their numbers are themselves estimates and
//    citing them would create a feedback loop with our own pipeline)
//  - user-generated content / forums / social (no editorial accountability)
//  - data-vendor walls and review/score sites (no sales figures)
const TAVILY_EXCLUDED_DOMAINS = [
  // Sales-estimation / aggregators (similar to what we're building)
  'vginsights.com',
  'gamediscoverco.com',
  'gamediscovr.co',
  'newzoo.com',
  'steamdb.info',
  'steamspy.com',
  'gamerefinery.com',
  'statista.com',
  'similarweb.com',
  'rec0ded88.com',
  'raijin.gg',
  // Catalog / playtime / review trackers (no real sales data)
  'howlongtobeat.com',
  'backloggd.com',
  'metacritic.com',
  'opencritic.com',
  // User-generated content / social
  'reddit.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'quora.com',
  'medium.com',
  'tiktok.com',
];

export interface ManualSalesInput {
  gameId: string;
  units: number;
  source: SalesSource;
  publisher?: string;
  sourceUrl?: string;
  reportedAt?: string;
  region?: string;
}

export interface ArticleIngestResult {
  matchedSource: string | null;
  tier: SalesSource;
  milestonesStored: number;
}

/**
 * Extract the URL slug from a canonical IGDB game URL. Accepts both bare
 * slugs and full URLs (with or without protocol, query, hash, trailing slash).
 * Returns null when no slug can be identified.
 */
function parseIgdbSlug(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/games\/([^/?#\s]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();

  // Plain slug pasted without a URL prefix (alphanumerics + dashes).
  if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(GameSource)
    private readonly gameSources: Repository<GameSource>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
    @InjectRepository(PriceSnapshot)
    private readonly prices: Repository<PriceSnapshot>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(ProcessedArticle)
    private readonly processedArticles: Repository<ProcessedArticle>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    private readonly estimation: EstimationService,
    private readonly gamesService: GamesService,
    private readonly steam: SteamClient,
    private readonly steamCharts: SteamChartsClient,
    private readonly igdb: IgdbClient,
    private readonly storeRatings: StoreRatingsClient,
    private readonly wikipedia: WikipediaClient,
    private readonly article: ArticleClient,
    private readonly rss: RssClient,
    private readonly tavily: TavilyClient,
    private readonly perplexity: PerplexityClient,
    private readonly exophase: ExophaseClient,
    private readonly sources: SourcesService,
    private readonly publishers: PublishersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Discover catalog candidates from IGDB (popularity-ranked + fresh releases),
   * skip the ones we already track, and ingest the rest. Admission rule:
   *   - IGDB total_rating_count ≥ {@link IGDB_MIN_RATING_COUNT}, OR
   *   - live Steam reviews ≥ {@link STEAM_MIN_REVIEWS} (fast-moving fresh hits).
   * Every new game is ingested fully (store ratings + Wikipedia extraction) so
   * that console platforms are immediately available without waiting for the
   * nightly per-app refresh cron. Wikipedia LLM calls add ~$0.01/game;
   * acceptable given the daily incremental volume is typically 20–50 new titles.
   */
  async discoverIgdbGames(): Promise<{
    discovered: number;
    ingested: number;
    skipped: number;
  }> {
    const candidates = await this.igdb.discoverCandidates();

    const knownIgdbIds = new Set(
      (
        await this.games.find({
          where: { igdbId: Not(IsNull()) },
          select: ['igdbId'],
          withDeleted: true,
        })
      ).map((g) => g.igdbId),
    );
    const knownSteamIds = new Set(
      (
        await this.gameSources.find({
          where: { source: SourceType.STEAM },
          select: ['externalId'],
        })
      ).map((s) => s.externalId),
    );

    let ingested = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      if (knownIgdbIds.has(candidate.igdbId)) {
        skipped += 1;
        continue;
      }
      if (
        candidate.steamAppId &&
        knownSteamIds.has(String(candidate.steamAppId))
      ) {
        skipped += 1;
        continue;
      }

      try {
        const admitted = await this.admitCandidate(candidate);
        if (!admitted) {
          skipped += 1;
          continue;
        }

        // Fallback: IGDB doesn't always link a game to its Steam app (EA /
        // Ubisoft / Epic-exclusive titles that joined Steam late often miss
        // the external_games row). When the candidate is supposed to be on PC,
        // try to resolve the Steam appId from the game name. Found = treat as
        // a Steam candidate; not found = fall back to console-only.
        let steamAppId = candidate.steamAppId;
        if (!steamAppId && candidate.platforms.includes(Platform.PC)) {
          steamAppId = await this.steam.findAppIdByName(candidate.name);
          if (steamAppId) {
            this.logger.log(
              `[discovery] resolved Steam appId ${steamAppId} for "${candidate.name}" via name search`,
            );
            if (knownSteamIds.has(String(steamAppId))) {
              skipped += 1;
              continue;
            }
          }
        }

        if (steamAppId) {
          const id = await this.ingestSteamApp(steamAppId);
          if (id) {
            knownIgdbIds.add(candidate.igdbId);
            knownSteamIds.add(String(steamAppId));
            ingested += 1;
          }
        } else {
          await this.ingestIgdbGame(candidate);
          knownIgdbIds.add(candidate.igdbId);
          ingested += 1;
        }
      } catch (error) {
        this.logger.warn(
          `IGDB discovery ingest failed for "${candidate.name}" (igdb=${candidate.igdbId}): ${error}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    this.logger.log(
      `IGDB discovery: ${candidates.length} candidate(s), ${ingested} ingested, ${skipped} skipped.`,
    );
    return { discovered: candidates.length, ingested, skipped };
  }

  /**
   * Decide whether a discovery candidate is worth tracking. Established titles
   * pass on IGDB popularity alone; otherwise we only keep fresh releases whose
   * live Steam review count clears the bar (a Steam lookup is done only when
   * needed, to avoid one HTTP call per long-tail candidate).
   */
  private async admitCandidate(candidate: IgdbGame): Promise<boolean> {
    if (
      candidate.releaseDate &&
      candidate.releaseDate < DISCOVERY_RELEASE_FLOOR
    ) {
      // Pre-floor classics are already filtered in-query by their high rating
      // bar; anything reaching here below the floor is a popular landmark.
      return candidate.totalRatingCount >= IGDB_MIN_RATING_COUNT;
    }
    if (candidate.totalRatingCount >= IGDB_MIN_RATING_COUNT) return true;
    if (!candidate.steamAppId) return false;
    const reviews = await this.steam.getTotalReviews(candidate.steamAppId);
    return (reviews ?? 0) >= STEAM_MIN_REVIEWS;
  }

  /**
   * Manually add a game by IGDB URL (typically pasted from the admin UI).
   * Accepts the canonical `https://www.igdb.com/games/<slug>` form. When the
   * IGDB record links to a Steam app, runs the full Steam ingest path so the
   * new game ships with live signals; otherwise falls back to the console-only
   * IGDB ingest (store ratings + initial estimate). Idempotent: re-adding an
   * already-tracked game returns the existing row with `alreadyExisted=true`.
   */
  async addGameFromIgdbUrl(rawUrl: string): Promise<{
    gameId: string;
    name: string;
    alreadyExisted: boolean;
    steamLinked: boolean;
  }> {
    const slug = parseIgdbSlug(rawUrl);
    if (!slug) {
      throw new BadRequestException(
        'Invalid IGDB URL. Expected https://www.igdb.com/games/<slug>.',
      );
    }

    const candidate = await this.igdb.findBySlug(slug);
    if (!candidate) {
      throw new NotFoundException(`No IGDB game found for slug "${slug}".`);
    }

    const existing = await this.games.findOne({
      where: { igdbId: candidate.igdbId },
      withDeleted: true,
    });
    if (existing && !existing.deletedAt) {
      return {
        gameId: existing.id,
        name: existing.name,
        alreadyExisted: true,
        steamLinked: candidate.steamAppId != null,
      };
    }
    // A soft-deleted existing row is intentionally NOT returned here: we let
    // the ingest path below run with `restoreDeleted: true` so the row is
    // resurrected and refreshed in one go.

    // Mirror the discovery path: if no Steam external id is linked on IGDB but
    // the title ships on PC, try resolving the appId by name search.
    let steamAppId = candidate.steamAppId;
    if (!steamAppId && candidate.platforms.includes(Platform.PC)) {
      steamAppId = await this.steam.findAppIdByName(candidate.name);
      if (steamAppId) {
        this.logger.log(
          `[admin-add] resolved Steam appId ${steamAppId} for "${candidate.name}" via name search`,
        );
      }
    }

    let gameId: string | null = null;
    if (steamAppId) {
      gameId = await this.ingestSteamApp(steamAppId, { restoreDeleted: true });
    }
    if (!gameId) {
      await this.ingestIgdbGame(candidate, { restoreDeleted: true });
      const created = await this.games.findOne({
        where: { igdbId: candidate.igdbId },
      });
      gameId = created?.id ?? null;
    }

    if (!gameId) {
      throw new BadRequestException(
        `Failed to ingest IGDB game "${candidate.name}" (slug=${slug}).`,
      );
    }

    return {
      gameId,
      name: candidate.name,
      alreadyExisted: false,
      steamLinked: steamAppId != null,
    };
  }

  /**
   * Create a console-only game from IGDB data (no Steam source), seed its
   * console store ratings as signals, and compute an initial estimate via
   * the canonical rebuild path so the (single) point lands consistently
   * with later refreshes.
   */
  private async ingestIgdbGame(
    candidate: IgdbGame,
    options: { restoreDeleted?: boolean } = {},
  ): Promise<void> {
    const game = await this.upsertGameFromIgdb(candidate, options);
    if (!game) return;
    await this.scrapeStoreRatings(game.id, game.name, game.platforms);
    await this.gamesService.rebuildEstimateHistory(game.id);
  }

  private async upsertGameFromIgdb(
    candidate: IgdbGame,
    options: { restoreDeleted?: boolean } = {},
  ): Promise<Game | null> {
    const { restoreDeleted = false } = options;

    const existing = await this.games.findOne({
      where: { igdbId: candidate.igdbId },
      withDeleted: true,
    });
    if (existing) {
      if (existing.deletedAt) {
        if (!restoreDeleted) {
          this.logger.log(
            `[ingest-igdb] skipping soft-deleted game "${existing.name}" (igdb=${candidate.igdbId})`,
          );
          return null;
        }
        await this.games.restore(existing.id);
        existing.deletedAt = null;
      }
      return existing;
    }

    const entity = this.games.create({
      igdbId: candidate.igdbId,
      name: candidate.name,
      slug: await this.uniqueSlug(candidate.name),
      summary: candidate.summary,
      releaseDate: candidate.releaseDate,
      coverUrl: candidate.coverUrl,
      platforms:
        candidate.platforms.length > 0
          ? candidate.platforms
          : [Platform.PLAYSTATION],
      developer: candidate.developer,
      publisher: candidate.publisher,
      genres: candidate.genres.length > 0 ? candidate.genres : null,
    });
    const game = await this.games.save(entity);
    await this.publishers.resolveAndLink(game.id, game.publisher);
    return game;
  }

  /**
   * Ingest a single Steam app: upsert the game, capture fresh signals
   * (reviews + estimated owners), recompute the PC sales estimate, and pull
   * multi-platform figures from console stores and Wikipedia.
   *
   */
  async ingestSteamApp(
    appId: number,
    options: { restoreDeleted?: boolean } = {},
  ): Promise<string | null> {
    const details = await this.steam.getAppDetails(appId);
    if (!details) {
      this.logger.warn(`No Steam details for app ${appId}`);
      return null;
    }

    // Free-to-play titles have no meaningful "units sold" — reviews/owners are
    // not a proxy for sales — so we never track them. We skip both during the
    // bulk discovery cron and on any explicit ingestion call.
    if (details.isFree) {
      this.logger.log(`Skipping free-to-play app ${appId} (${details.name}).`);
      return null;
    }

    const game = await this.upsertGameFromSteam(appId, details, options);
    if (!game) return null;

    await this.pollSteamReviews(game.id, appId);
    await this.pollSteamCcu(game.id, appId);

    await this.scrapeStoreRatings(game.id, game.name, game.platforms);

    await Promise.all([
      this.scrapeAchievements(game.id, game.name, Platform.PC),
      this.scrapeAchievements(game.id, game.name, Platform.PLAYSTATION),
      this.scrapeAchievements(game.id, game.name, Platform.XBOX),
      this.scrapeSteamOfficialAchievements(game.id, game.name, appId),
    ]);

    // Canonical recompute path: rebuild the estimate history so the
    // freshly seeded signals + any declared figure pulled by the
    // enrichment steps above are reflected consistently with the
    // refresh flow.
    await this.gamesService.rebuildEstimateHistory(game.id);

    return game.id;
  }

  /**
   * Re-fetch a game's Steam store details and upsert every Steam-derived
   * column on the `Game` row (name, genres, categories, steamTags, dlc,
   * developer, publisher, release date, cover, summary, isFree) plus the
   * re-derived franchise / live-service features (via `applyDerivedFeatures`
   * inside the upsert). IGDB genre fallback is applied by the upsert itself.
   *
   * Metadata only: unlike `ingestSteamApp`, it does NOT poll reviews / CCU,
   * scrape ratings / achievements, or rebuild the estimate history — those
   * are separate, heavier flows. This is the single entry point for the
   * catalog-wide Steam metadata backfill.
   *
   * Returns the game id, or null when Steam has no usable details or the
   * game is soft-deleted (upsert skips it).
   */
  async refreshSteamMetadata(appId: number): Promise<string | null> {
    const details = await this.steam.getAppDetails(appId);
    if (!details) {
      this.logger.warn(`No Steam details for app ${appId}`);
      return null;
    }
    const game = await this.upsertGameFromSteam(appId, details);
    return game?.id ?? null;
  }

  /**
   * Import one row of the July 2018 Steam achievement-leak player counts as a
   * ground-truth snapshot for model validation/calibration (Phase 1).
   *
   * For the given Steam app it:
   *   - fetches Steam details (skips free-to-play and apps with no store page);
   *   - skips titles released before `minReleaseYear` (Steam reviews launched
   *     Nov 2013, so older games have no contemporaneous review base);
   *   - upserts the game with Steam + IGDB enrichment so it carries a genre
   *     profile for per-genre analysis (retrying with IGDB genres when the
   *     Steam genres don't resolve a profile);
   *   - persists the leak player count as a `STEAM_PLAYERS_LEAK` snapshot
   *     dated `leakDate` (idempotent: one leak row per game).
   *
   * Deliberately lean: it does NOT poll live signals or rebuild estimates.
   * The leak figure is a calibration target only and never feeds estimation;
   * the 2018-era review counts are backfilled separately.
   */
  async importLeakPlayerCount(
    appId: number,
    players: number,
    opts: { leakDate: Date; minReleaseYear: number },
  ): Promise<
    | 'imported'
    | 'skipped-free'
    | 'skipped-old'
    | 'skipped-no-details'
    | 'failed'
  > {
    if (!Number.isFinite(players) || players <= 0) return 'failed';

    // Don't re-fetch Steam/IGDB for a game we already track: the Steam source
    // (externalId = appId) already points at its game. Validate free / release
    // year from the stored record and just (re)write the leak snapshot.
    const existingSource = await this.gameSources.findOne({
      where: { source: SourceType.STEAM, externalId: String(appId) },
    });
    if (existingSource) {
      const existing = await this.games.findOne({
        where: { id: existingSource.gameId },
        withDeleted: true,
      });
      if (existing && !existing.deletedAt) {
        if (existing.isFree) return 'skipped-free';
        const existingYear = existing.releaseDate?.getFullYear() ?? null;
        if (existingYear !== null && existingYear < opts.minReleaseYear) {
          return 'skipped-old';
        }
        await this.persistLeakGroundTruth(existing.id, players, opts.leakDate);
        return 'imported';
      }
    }

    const details = await this.steam.getAppDetails(appId);
    if (!details) return 'skipped-no-details';
    if (details.isFree) return 'skipped-free';

    const steamYear = details.releaseDate?.getFullYear() ?? null;
    if (steamYear !== null && steamYear < opts.minReleaseYear) {
      return 'skipped-old';
    }

    const game = await this.upsertGameFromSteam(appId, details);
    if (!game) return 'failed';

    const year = steamYear ?? game.releaseDate?.getFullYear() ?? null;
    if (year !== null && year < opts.minReleaseYear) return 'skipped-old';

    // Steam genres are sparse; enrich the taxonomy with the IGDB genres
    // when the game carries none yet (classification/display metadata —
    // genres no longer feed the estimation model).
    if (!game.genres || game.genres.length === 0) {
      const igdb = await this.igdb.findBySteamAppId(appId);
      if (igdb && igdb.genres.length > 0) {
        game.genres = Array.from(
          new Set([...(game.genres ?? []), ...igdb.genres]),
        );
        await this.games.save(game);
      }
    }

    await this.persistLeakGroundTruth(game.id, players, opts.leakDate);

    return 'imported';
  }

  /**
   * Persist the leak player count twice: as a `STEAM_PLAYERS_LEAK` signal
   * snapshot AND as a milestone (so it shows up in the milestone workflow).
   */
  private async persistLeakGroundTruth(
    gameId: string,
    players: number,
    leakDate: Date,
  ): Promise<void> {
    await this.storeLeakSignal(gameId, players, leakDate);
    await this.storeLeakMilestone(gameId, players, leakDate);
  }

  /**
   * Idempotently persist a single `STEAM_PLAYERS_LEAK` snapshot for a game:
   * one leak row per game, so re-runs replace rather than accumulate.
   */
  private async storeLeakSignal(
    gameId: string,
    players: number,
    leakDate: Date,
  ): Promise<void> {
    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_PLAYERS_LEAK,
    });
    await this.signals.save(
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_PLAYERS_LEAK,
        value: players,
        capturedAt: leakDate,
      }),
    );
  }

  /**
   * Mirror the leak player count into the milestone table as a PC-region sales
   * figure. We only import paid games, so a Steam player is necessarily a
   * buyer — the count is effectively PC copies sold (owners), NOT an
   * engagement metric. It is tagged `region='PC'` (Steam-only, not worldwide),
   * which keeps it out of the GLOBAL calibration / breakdown headline /
   * discrepancy paths (all filter to region='GLOBAL'). Idempotent and
   * rejection-aware: a single active leak milestone per game, never
   * resurrected after an admin rejects it.
   */
  private async storeLeakMilestone(
    gameId: string,
    players: number,
    leakDate: Date,
  ): Promise<void> {
    const candidate = this.milestones.create({
      gameId,
      source: SalesSource.STEAM_LEAK,
      units: players,
      region: 'PC',
      isEngagement: false,
      confidenceScore: DEFAULT_CONFIDENCE_SCORE[SalesSource.STEAM_LEAK],
      sourceUrl: null,
      note:
        'July 2018 Steam achievement-data leak: unique players who launched ' +
        'the game (Steam/PC). Paid game, so this approximates PC copies sold.',
      reportedAt: leakDate,
    });

    const accepted = await this.filterOutRejected([candidate]);
    if (accepted.length === 0) return;

    await this.milestones.delete({
      gameId,
      source: SalesSource.STEAM_LEAK,
      rejectedAt: IsNull(),
    });
    await this.milestones.save(accepted);
  }

  /**
   * Have the LLM extract grounded sales figures from the game's Wikipedia
   * article: a dated worldwide total (stored as a milestone). Each carries
   * the verbatim source quote. Best-effort: failures are logged. Milestones
   * without `reportedAt` are rejected at extraction time — calibration needs
   * a date.
   */
  async scrapeWikipedia(gameId: string, name: string): Promise<void> {
    try {
      const sales = await this.wikipedia.getWorldwideSales(name);
      if (!sales) {
        this.logger.log(`[wikipedia] "${name}" — no usable figure extracted`);
        return;
      }

      const releaseDate = await this.getReleaseDate(gameId);
      const wikipediaScore = DEFAULT_CONFIDENCE_SCORE[SalesSource.WIKIPEDIA];

      await this.milestones.delete({
        gameId,
        source: SalesSource.WIKIPEDIA,
        rejectedAt: IsNull(),
      });

      const rows: Milestone[] = [];
      let undatedSkipped = 0;
      if (sales.global) {
        if (!sales.global.reportedAt) {
          undatedSkipped += 1;
        } else if (
          this.isReportedAfterRelease(sales.global.reportedAt, releaseDate)
        ) {
          rows.push(
            this.milestones.create({
              gameId,
              source: SalesSource.WIKIPEDIA,
              units: sales.global.units,
              confidenceScore: wikipediaScore,
              sourceUrl: sales.sourceUrl,
              note: sales.global.quote,
              reportedAt: sales.global.reportedAt,
              region: 'GLOBAL',
            }),
          );
        }
      }
      if (sales.pc) {
        if (!sales.pc.reportedAt) {
          undatedSkipped += 1;
        } else if (
          this.isReportedAfterRelease(sales.pc.reportedAt, releaseDate)
        ) {
          rows.push(
            this.milestones.create({
              gameId,
              source: SalesSource.WIKIPEDIA,
              units: sales.pc.units,
              confidenceScore: wikipediaScore,
              sourceUrl: sales.sourceUrl,
              note: sales.pc.quote,
              reportedAt: sales.pc.reportedAt,
              region: 'PC',
            }),
          );
        }
      }
      if (sales.engagement) {
        if (!sales.engagement.reportedAt) {
          undatedSkipped += 1;
        } else if (
          this.isReportedAfterRelease(sales.engagement.reportedAt, releaseDate)
        ) {
          rows.push(
            this.milestones.create({
              gameId,
              source: SalesSource.WIKIPEDIA,
              units: sales.engagement.units,
              confidenceScore: wikipediaScore,
              sourceUrl: sales.sourceUrl,
              note: sales.engagement.quote,
              reportedAt: sales.engagement.reportedAt,
              region: 'GLOBAL',
              isEngagement: true,
            }),
          );
        }
      }

      const accepted = await this.filterOutRejected(rows);
      if (accepted.length > 0) {
        await this.milestones.save(accepted);
        const globalLog = sales.global
          ? `global=${sales.global.units} (${sales.global.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : 'no global';
        const pcLog = sales.pc
          ? `, pc=${sales.pc.units} (${sales.pc.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : '';
        const engagementLog = sales.engagement
          ? `, engagement=${sales.engagement.units} (${sales.engagement.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : '';
        this.logger.log(
          `[wikipedia] "${name}" — stored ${accepted.length} milestone(s) (${rows.length - accepted.length} rejected-fingerprint skip, ${undatedSkipped} undated skip): ${globalLog}${pcLog}${engagementLog}`,
        );
      } else if (rows.length > 0) {
        this.logger.log(
          `[wikipedia] "${name}" — extracted ${rows.length} milestone(s) but all match an admin-rejected fingerprint, skipping`,
        );
      } else {
        this.logger.log(
          `[wikipedia] "${name}" — extraction returned but no milestone met date/grounding requirements (${undatedSkipped} undated)`,
        );
      }
    } catch (error) {
      this.logger.warn(`Wikipedia scrape failed for "${name}": ${error}`);
    }
  }

  /**
   * Look up console store rating counts, store them as signals, and turn each
   * into a per-platform sales estimate. Best-effort: failures are logged.
   */
  async scrapeStoreRatings(
    gameId: string,
    name: string,
    platforms: Platform[],
  ): Promise<void> {
    if (!this.hasConsolePlatform(platforms)) {
      this.logger.log(`[stores] "${name}" — skipping store ratings (PC-only)`);
      return;
    }

    try {
      const ratings = await this.storeRatings.getRatings(name);
      if (ratings.length === 0) {
        this.logger.log(`[stores] "${name}" — no ratings found on PS/Xbox`);
        return;
      }
      for (const rating of ratings) {
        const source = STORE_SOURCE_BY_PLATFORM[rating.platform];
        if (!source) continue;

        await this.signals.save(
          this.signals.create({
            gameId,
            source,
            metric: rating.metric,
            value: rating.ratingCount,
            averageRating: rating.averageRating,
          }),
        );
      }
      const summary = ratings
        .map((r) => `${r.platform}=${r.ratingCount}`)
        .join(', ');
      this.logger.log(`[stores] "${name}" — ${summary}`);
    } catch (error) {
      this.logger.warn(`Store ratings scrape failed for "${name}": ${error}`);
    }
  }

  /**
   * Capture achievement-unlock stats from Exophase for the given platform and
   * persist one row per achievement in `AchievementSnapshot`. Best-effort: a
   * silent skip on title mismatch, small sample, or HTTP error. Used later
   * for sales estimation via the most-common-achievement player count, once
   * the tracker→real coverage ratio is calibrated against publisher figures.
   *
   * Only persists when every validation check passes (see ExophaseClient).
   */
  /**
   * Capture unbiased achievement-unlock percentages from Steam's official
   * `GetGlobalAchievementPercentagesForApp` API and persist them with
   * `source = STEAM`. The Steam API is the ground truth (full playerbase,
   * no sample), used both as a per-game data point and to estimate
   * Exophase's completionist bias on the same game. Best-effort: a silent
   * skip on HTTP error or empty payload. No `playersTracked` is stored —
   * Steam does not expose an absolute count.
   */
  async scrapeSteamOfficialAchievements(
    gameId: string,
    name: string,
    appId: number,
  ): Promise<void> {
    try {
      const list = await this.steam.getGlobalAchievementPercentages(appId);
      if (!list || list.length === 0) return;

      const capturedAt = new Date();
      const rows = list.map((a) =>
        this.achievements.create({
          gameId,
          platform: Platform.PC,
          source: SourceType.STEAM,
          achievementSlug: a.apiName,
          // Steam's API does not return localized titles; keep the api name
          // as both slug and display name for symmetry with Exophase rows.
          achievementName: a.apiName,
          percentEarned: a.percent,
          playersTracked: null,
          playersWithAchievement: null,
          capturedAt,
        }),
      );

      await this.achievements.save(rows);

      const mostCommon = list.reduce((max, a) =>
        a.percent > max.percent ? a : max,
      );
      this.logger.log(
        `[achievements:steam-api] "${name}" (appId=${appId}) — ` +
          `count=${list.length}, mostCommon="${mostCommon.apiName}" ${mostCommon.percent}%`,
      );
    } catch (error) {
      this.logger.warn(
        `Steam official achievements scrape failed for "${name}" (appId=${appId}): ${error}`,
      );
    }
  }

  /**
   * Poll Steam's total review count and persist a `STEAM_REVIEWS` snapshot
   * (PC Boxleiter input). Called from the initial Steam ingest
   * (`ingestSteamApp`) and the daily refresh (`refreshGame`).
   *
   * Best-effort: a fetch failure leaves the value already on record in place.
   */
  private async pollSteamReviews(gameId: string, appId: number): Promise<void> {
    const reviews = await this.steam.getTotalReviews(appId);
    if (reviews === null) return;

    await this.signals.save(
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_REVIEWS,
        value: reviews,
      }),
    );
  }

  /**
   * Poll Steam's live concurrent-player count for this app and persist it.
   * Captured on a short cadence by the dedicated CCU cron (see
   * `pollAllSteamCcu`) so intra-day peaks aren't missed; also seeded once on
   * the initial Steam ingest (`ingestSteamApp`). Deliberately NOT called from
   * the nightly full refresh.
   *
   * Signals captured:
   *  - `STEAM_CONCURRENT`: one row per UTC day holding that day's highest
   *    reading. The hourly cron upserts: a higher value replaces the day's
   *    row, a lower one is ignored — so we keep the daily peak, not every
   *    hourly sample (matches the SteamDB CSV import granularity).
   *  - `STEAM_PEAK_CCU`: running all-time max of `STEAM_CONCURRENT`. A new
   *    row is written only when the latest reading strictly exceeds the
   *    prior peak. Query the current peak with `order: { value: 'DESC' }`
   *    (NOT capturedAt) because the historical-import path persists peaks
   *    with the SteamCharts month as `capturedAt`.
   *
   * Best-effort: a fetch failure leaves the value already on record in place.
   */
  async pollSteamCcu(gameId: string, appId: number): Promise<void> {
    const current = await this.steam.getCurrentPlayerCount(appId);
    if (current === null) return;

    // Keep a single STEAM_CONCURRENT row per UTC day = that day's peak.
    // Upsert: replace the day's row when the new reading is higher, do
    // nothing otherwise.
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1);
    const todayRow = await this.signals.findOne({
      where: {
        gameId,
        metric: SignalMetric.STEAM_CONCURRENT,
        capturedAt: Between(dayStart, dayEnd),
      },
      order: { value: 'DESC' },
    });

    if (!todayRow) {
      await this.signals.save(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_CONCURRENT,
          value: current,
          capturedAt: dayStart,
        }),
      );
    } else if (current > todayRow.value) {
      todayRow.value = current;
      todayRow.capturedAt = dayStart;
      await this.signals.save(todayRow);
    }

    // Order by value DESC (not capturedAt): the historical-import path
    // writes peak rows with an *old* capturedAt (the SteamCharts month of
    // the peak), so the row with the largest value — not the most recent
    // one — represents the true current all-time peak.
    const priorPeak = await this.signals.findOne({
      where: { gameId, metric: SignalMetric.STEAM_PEAK_CCU },
      order: { value: 'DESC' },
    });

    if (!priorPeak || current > priorPeak.value) {
      await this.signals.save(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_PEAK_CCU,
          value: current,
        }),
      );
      this.logger.log(
        `[ccu] gameId=${gameId} appId=${appId} new peak ${current.toLocaleString()} ` +
          `(prior ${priorPeak?.value.toLocaleString() ?? 'n/a'})`,
      );
    }
  }

  /**
   * Poll the live Steam concurrent-player count for every tracked Steam game
   * and persist CCU signals. Runs on a short cadence (dedicated cron) so
   * intra-day peaks are captured even though the full refresh only runs
   * nightly. Free-to-play titles are excluded (no sales estimate). Each game
   * is best-effort: a failure is logged and the loop continues.
   */
  async pollAllSteamCcu(): Promise<{ polled: number; failed: number }> {
    const steamSources = await this.gameSources.find({
      where: { source: SourceType.STEAM },
    });

    const gameIds = steamSources.map((source) => source.gameId);
    if (gameIds.length === 0) {
      this.logger.log('[ccu] no Steam-linked games to poll.');
      return { polled: 0, failed: 0 };
    }

    const trackedGames = await this.games.find({
      where: { id: In(gameIds), isFree: false },
    });
    const trackedIds = new Set(trackedGames.map((game) => game.id));

    let polled = 0;
    let failed = 0;
    for (const source of steamSources) {
      if (!trackedIds.has(source.gameId)) continue;

      const appId = Number(source.externalId);
      if (!Number.isFinite(appId)) continue;

      try {
        await this.pollSteamCcu(source.gameId, appId);
        polled++;
      } catch (error) {
        failed++;
        this.logger.warn(
          `[ccu] poll failed for game ${source.gameId}: ${error}`,
        );
      }
    }

    this.logger.log(`[ccu] poll complete: ${polled} polled, ${failed} failed.`);
    return { polled, failed };
  }

  /**
   * Capture a daily Steam price point for every tracked Steam game, building a
   * `price_snapshot` time series of regular/discounted prices. Free-to-play
   * titles are excluded (no price). Steam app details are re-fetched here, so
   * we also opportunistically refresh `categories` / `dlc` on the game (these
   * are otherwise only set on initial ingest). Each game is best-effort: a
   * failure is logged and the loop continues.
   */
  async captureAllSteamPrices(): Promise<{
    captured: number;
    skipped: number;
    failed: number;
  }> {
    const steamSources = await this.gameSources.find({
      where: { source: SourceType.STEAM },
    });

    const gameIds = steamSources.map((source) => source.gameId);
    if (gameIds.length === 0) {
      this.logger.log('[price] no Steam-linked games to poll.');
      return { captured: 0, skipped: 0, failed: 0 };
    }

    const trackedGames = await this.games.find({
      where: { id: In(gameIds), isFree: false },
    });
    const gamesById = new Map(trackedGames.map((game) => [game.id, game]));

    // Steam's store appdetails endpoint is rate-limited to ~200 requests /
    // 5 min per IP. Space calls out to stay under that ceiling and avoid the
    // 429 bursts a tight loop produces.
    const THROTTLE_MS = 1500;

    let captured = 0;
    let skipped = 0;
    let failed = 0;
    let first = true;
    for (const source of steamSources) {
      const game = gamesById.get(source.gameId);
      if (!game) continue;

      const appId = Number(source.externalId);
      if (!Number.isFinite(appId)) continue;

      if (!first) await new Promise((r) => setTimeout(r, THROTTLE_MS));
      first = false;

      try {
        const details = await this.steam.getAppDetails(appId);
        if (!details) {
          failed++;
          continue;
        }

        // Backfill metadata that only initial ingest used to set.
        let metadataChanged = false;
        if (details.categories.length > 0) {
          game.categories = details.categories;
          metadataChanged = true;
        }
        if (details.dlc.length > 0) {
          game.dlc = details.dlc;
          metadataChanged = true;
        }
        if (metadataChanged) {
          this.applyDerivedFeatures(game);
          await this.games.save(game);
        }

        if (!details.price) {
          skipped++;
          continue;
        }

        await this.prices.save(
          this.prices.create({
            gameId: game.id,
            currency: details.price.currency,
            initial: details.price.initial,
            final: details.price.final,
            discountPercent: details.price.discountPercent,
          }),
        );
        captured++;
      } catch (error) {
        failed++;
        this.logger.warn(
          `[price] capture failed for game ${source.gameId}: ${error}`,
        );
      }
    }

    this.logger.log(
      `[price] capture complete: ${captured} captured, ${skipped} skipped, ${failed} failed.`,
    );
    return { captured, skipped, failed };
  }

  /**
   * Import a SteamDB chart CSV (`"DateTime","Players","Average Players"`)
   * as the game's daily concurrent-player history. SteamDB is the only
   * source with day-by-day CCU back to launch; we can't scrape it
   * (Cloudflare), so the admin uploads the CSV manually for the titles
   * that matter.
   *
   * Granularity is normalized to one value per UTC day = that day's peak
   * concurrent count (the recent window of the export is sub-daily, older
   * history is already daily). Rows are persisted as `STEAM_CONCURRENT`
   * snapshots dated at 00:00:00 UTC of their day. Re-importing overwrites
   * existing rows in the CSV's date range only (upsert at day
   * granularity). The all-time `STEAM_PEAK_CCU` is refreshed to the CSV's
   * max when higher, so the first-week lifecycle estimate uses accurate data.
   */
  async importCcuCsv(
    gameId: string,
    csv: string,
  ): Promise<{
    daysImported: number;
    rowsParsed: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    peakValue: number;
    peakAt: string | null;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found.`);
    }

    // Drop rows before release: SteamDB sometimes reports 0 (or noise) on
    // the pre-launch days, which would otherwise pollute the week-1 window.
    const releaseDayKey = game.releaseDate
      ? game.releaseDate.toISOString().slice(0, 10)
      : null;

    const dailyMax = new Map<string, number>();
    let rowsParsed = 0;
    let skippedPreRelease = 0;
    for (const line of csv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase().startsWith('"datetime"')) continue;
      const cols = trimmed.split(',');
      if (cols.length < 2) continue;
      const rawDate = cols[0].replace(/"/g, '').trim();
      const dayKey = rawDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
      if (releaseDayKey && dayKey < releaseDayKey) {
        skippedPreRelease += 1;
        continue;
      }
      const value = Number(cols[1].replace(/"/g, '').trim());
      if (!Number.isFinite(value) || value < 0) continue;
      rowsParsed += 1;
      const prev = dailyMax.get(dayKey);
      if (prev === undefined || value > prev) dailyMax.set(dayKey, value);
    }

    if (dailyMax.size === 0) {
      throw new BadRequestException(
        'No valid data rows found in the CSV (expected SteamDB chart export).',
      );
    }

    const dayKeys = Array.from(dailyMax.keys()).sort();
    const firstDay = new Date(`${dayKeys[0]}T00:00:00.000Z`);
    const lastDay = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`);
    const lastDayEnd = new Date(lastDay.getTime() + 24 * 3600 * 1000 - 1);

    // Upsert at day granularity: drop existing STEAM_CONCURRENT rows in the
    // CSV's range (incl. sub-daily live-poll rows) then insert one per day.
    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_CONCURRENT,
      capturedAt: Between(firstDay, lastDayEnd),
    });

    const rows = dayKeys.map((day) =>
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_CONCURRENT,
        value: dailyMax.get(day)!,
        capturedAt: new Date(`${day}T00:00:00.000Z`),
      }),
    );
    await this.signals.save(rows, { chunk: 500 });

    let peakValue = 0;
    let peakDay = dayKeys[0];
    for (const [day, value] of dailyMax) {
      if (value > peakValue) {
        peakValue = value;
        peakDay = day;
      }
    }
    const peakAt = new Date(`${peakDay}T00:00:00.000Z`);
    const priorPeakRow = await this.signals.findOne({
      where: { gameId, metric: SignalMetric.STEAM_PEAK_CCU },
      order: { value: 'DESC' },
    });
    if (!priorPeakRow || peakValue > priorPeakRow.value) {
      await this.signals.save(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_PEAK_CCU,
          value: peakValue,
          capturedAt: peakAt,
        }),
      );
    }

    this.logger.log(
      `[ccu-csv] "${game.name}" — ${dailyMax.size} days ` +
        `(${dayKeys[0]} → ${dayKeys[dayKeys.length - 1]}), ` +
        `peak ${peakValue.toLocaleString()} at ${peakDay}` +
        (skippedPreRelease > 0
          ? ` (skipped ${skippedPreRelease} pre-release rows)`
          : ''),
    );

    return {
      daysImported: dailyMax.size,
      rowsParsed,
      rangeStart: dayKeys[0],
      rangeEnd: dayKeys[dayKeys.length - 1],
      peakValue,
      peakAt: peakAt.toISOString(),
    };
  }

  /**
   * Import a SteamDB review chart CSV
   * (`"DateTime","Positive reviews","Negative reviews"`) as the game's daily
   * total-review history. SteamDB exposes cumulative positive/negative review
   * counts day-by-day back to launch; we can't scrape it (Cloudflare), so the
   * admin uploads the CSV manually.
   *
   * Each row is cumulative, so granularity is normalized to one value per UTC
   * day = that day's highest cumulative count. Rows are persisted as
   * `STEAM_REVIEWS` snapshots dated at 00:00:00 UTC of their day, with
   * `value` = positive + negative and `averageRating` = positive / total.
   * Re-importing overwrites existing rows in the CSV's date range only (upsert
   * at day granularity). The negative column is exported as a negative number
   * (e.g. `-233`) so its absolute value is used.
   */
  async importReviewsCsv(
    gameId: string,
    csv: string,
  ): Promise<{
    daysImported: number;
    rowsParsed: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    latestTotal: number;
    latestRating: number | null;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found.`);
    }

    const releaseDayKey = game.releaseDate
      ? game.releaseDate.toISOString().slice(0, 10)
      : null;

    // Keep the highest cumulative total per UTC day (cumulative series, so the
    // day's max is its last reading), tracking the matching positive count for
    // the rating.
    const dailyTotal = new Map<string, number>();
    const dailyPositive = new Map<string, number>();
    let rowsParsed = 0;
    let skippedPreRelease = 0;
    for (const line of csv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase().startsWith('"datetime"')) continue;
      const cols = trimmed.split(',');
      if (cols.length < 3) continue;
      const rawDate = cols[0].replace(/"/g, '').trim();
      const dayKey = rawDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
      if (releaseDayKey && dayKey < releaseDayKey) {
        skippedPreRelease += 1;
        continue;
      }
      const positive = Number(cols[1].replace(/"/g, '').trim());
      const negative = Math.abs(Number(cols[2].replace(/"/g, '').trim()));
      if (!Number.isFinite(positive) || !Number.isFinite(negative)) continue;
      if (positive < 0 || negative < 0) continue;
      const total = positive + negative;
      rowsParsed += 1;
      const prev = dailyTotal.get(dayKey);
      if (prev === undefined || total > prev) {
        dailyTotal.set(dayKey, total);
        dailyPositive.set(dayKey, positive);
      }
    }

    if (dailyTotal.size === 0) {
      throw new BadRequestException(
        'No valid data rows found in the CSV (expected SteamDB review chart export).',
      );
    }

    const dayKeys = Array.from(dailyTotal.keys()).sort();
    const firstDay = new Date(`${dayKeys[0]}T00:00:00.000Z`);
    const lastDay = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`);
    const lastDayEnd = new Date(lastDay.getTime() + 24 * 3600 * 1000 - 1);

    // Upsert at day granularity: drop existing STEAM_REVIEWS rows in the CSV's
    // range (incl. live-poll rows) then insert one per day.
    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_REVIEWS,
      capturedAt: Between(firstDay, lastDayEnd),
    });

    const rows = dayKeys.map((day) => {
      const total = dailyTotal.get(day)!;
      const positive = dailyPositive.get(day)!;
      return this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_REVIEWS,
        value: total,
        averageRating: total > 0 ? positive / total : null,
        capturedAt: new Date(`${day}T00:00:00.000Z`),
      });
    });
    await this.signals.save(rows, { chunk: 500 });

    const latestDay = dayKeys[dayKeys.length - 1];
    const latestTotal = dailyTotal.get(latestDay)!;
    const latestPositive = dailyPositive.get(latestDay)!;
    const latestRating = latestTotal > 0 ? latestPositive / latestTotal : null;

    this.logger.log(
      `[reviews-csv] "${game.name}" — ${dailyTotal.size} days ` +
        `(${dayKeys[0]} → ${latestDay}), ` +
        `latest ${latestTotal.toLocaleString()} reviews` +
        (latestRating !== null
          ? ` (${(latestRating * 100).toFixed(1)}% positive)`
          : '') +
        (skippedPreRelease > 0
          ? ` (skipped ${skippedPreRelease} pre-release rows)`
          : ''),
    );

    return {
      daysImported: dailyTotal.size,
      rowsParsed,
      rangeStart: dayKeys[0],
      rangeEnd: latestDay,
      latestTotal,
      latestRating,
    };
  }

  /**
   * Reconstruct and persist a game's daily review history straight from
   * Steam's public `appreviews` API — the API-only equivalent of importing a
   * SteamDB review CSV. Paginates every individual review, aggregates new
   * positive/negative counts per UTC day, then accumulates them into the same
   * cumulative `STEAM_REVIEWS` daily series the CSV import produces (`value` =
   * cumulative total, `averageRating` = cumulative positive / total).
   *
   * Pre-release reviews still count toward the cumulative totals but never get
   * their own snapshot, so the first persisted day already includes them
   * (matching SteamDB's cumulative export). Re-running overwrites existing
   * rows in the covered date range only (upsert at day granularity). Large
   * games can span hundreds of throttled pages; rebuild estimates afterwards
   * to apply the refreshed history.
   */
  async backfillReviewsFromApi(gameId: string): Promise<{
    daysImported: number;
    reviewsFetched: number;
    reportedTotal: number | null;
    rangeStart: string | null;
    rangeEnd: string | null;
    latestTotal: number;
    latestRating: number | null;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found.`);
    }

    const steamSource = await this.gameSources.findOne({
      where: { gameId, source: SourceType.STEAM },
    });
    const appId = steamSource ? Number(steamSource.externalId) : NaN;
    if (!Number.isFinite(appId)) {
      throw new BadRequestException(
        `Game "${game.name}" is not linked to a Steam app.`,
      );
    }

    const history = await this.steam.fetchReviewHistory(appId);
    if (!history || history.daily.length === 0) {
      throw new BadRequestException(
        `No reviews returned by the Steam API for app ${appId}.`,
      );
    }

    const releaseDayKey = game.releaseDate
      ? game.releaseDate.toISOString().slice(0, 10)
      : null;

    // Accumulate over every day (incl. pre-release) so the first persisted day
    // carries the full cumulative total, but only emit snapshots from release
    // onward to avoid polluting the week-1 lifecycle window.
    let cumulativePositive = 0;
    let cumulativeNegative = 0;
    let skippedPreRelease = 0;
    const rows: SignalSnapshot[] = [];
    const emittedDays: string[] = [];
    for (const entry of history.daily) {
      cumulativePositive += entry.positive;
      cumulativeNegative += entry.negative;
      if (releaseDayKey && entry.day < releaseDayKey) {
        skippedPreRelease += 1;
        continue;
      }
      const total = cumulativePositive + cumulativeNegative;
      rows.push(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_REVIEWS,
          value: total,
          averageRating: total > 0 ? cumulativePositive / total : null,
          capturedAt: new Date(`${entry.day}T00:00:00.000Z`),
        }),
      );
      emittedDays.push(entry.day);
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        `All ${history.daily.length} review day(s) for app ${appId} predate ` +
          `the game's release date; nothing to import.`,
      );
    }

    const firstDay = new Date(`${emittedDays[0]}T00:00:00.000Z`);
    const lastDay = new Date(
      `${emittedDays[emittedDays.length - 1]}T00:00:00.000Z`,
    );
    const lastDayEnd = new Date(lastDay.getTime() + 24 * 3600 * 1000 - 1);

    // Upsert at day granularity: drop existing STEAM_REVIEWS rows in the
    // covered range (incl. live-poll rows) then insert one per day.
    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_REVIEWS,
      capturedAt: Between(firstDay, lastDayEnd),
    });
    await this.signals.save(rows, { chunk: 500 });

    const latestDay = emittedDays[emittedDays.length - 1];
    const latestTotal = cumulativePositive + cumulativeNegative;
    const latestRating =
      latestTotal > 0 ? cumulativePositive / latestTotal : null;

    this.logger.log(
      `[reviews-api] "${game.name}" — ${rows.length} days ` +
        `(${emittedDays[0]} → ${latestDay}), ` +
        `fetched ${history.totalFetched.toLocaleString()} reviews ` +
        `(reported ${history.reportedTotal?.toLocaleString() ?? 'n/a'}), ` +
        `latest ${latestTotal.toLocaleString()} reviews` +
        (latestRating !== null
          ? ` (${(latestRating * 100).toFixed(1)}% positive)`
          : '') +
        (skippedPreRelease > 0
          ? ` (skipped ${skippedPreRelease} pre-release days)`
          : ''),
    );

    return {
      daysImported: rows.length,
      reviewsFetched: history.totalFetched,
      reportedTotal: history.reportedTotal,
      rangeStart: emittedDays[0],
      rangeEnd: latestDay,
      latestTotal,
      latestRating,
    };
  }

  /**
   * Backfill the full `STEAM_REVIEWS` cumulative series from the public review
   * histogram (`appreviewhistogram`) — one cheap request that returns monthly
   * buckets back to launch for high-volume games. When Steam only returns
   * recent weekly buckets (low-volume games) or the buckets don't reach the
   * release month, we fall back to `backfillReviewsFromApi` (the per-review
   * enumeration, which is cheap precisely because such games have few reviews).
   *
   * Monthly granularity is sufficient for historical calibration/validation;
   * the live poll keeps the current value fresh at finer granularity.
   */
  async backfillReviewsFromHistogram(gameId: string): Promise<{
    method: 'histogram' | 'enumeration';
    rollupType: string | null;
    pointsImported: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    latestTotal: number;
    latestRating: number | null;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found.`);
    }

    const steamSource = await this.gameSources.findOne({
      where: { gameId, source: SourceType.STEAM },
    });
    const appId = steamSource ? Number(steamSource.externalId) : NaN;
    if (!Number.isFinite(appId)) {
      throw new BadRequestException(
        `Game "${game.name}" is not linked to a Steam app.`,
      );
    }

    const releaseMonthStart = game.releaseDate
      ? `${game.releaseDate.toISOString().slice(0, 7)}-01`
      : null;

    const hist = await this.steam.fetchReviewHistogram(appId);

    // The histogram is only trustworthy as a full series when it's a monthly
    // rollup that reaches back to (around) the release month. Otherwise fall
    // back to the per-review enumeration.
    const reachesRelease =
      hist !== null &&
      hist.rollupType === 'month' &&
      (releaseMonthStart === null ||
        hist.buckets[0].day <= this.addMonths(releaseMonthStart, 2));

    if (!reachesRelease) {
      const api = await this.backfillReviewsFromApi(gameId);
      return {
        method: 'enumeration',
        rollupType: hist?.rollupType ?? null,
        pointsImported: api.daysImported,
        rangeStart: api.rangeStart,
        rangeEnd: api.rangeEnd,
        latestTotal: api.latestTotal,
        latestRating: api.latestRating,
      };
    }

    let cumulativePositive = 0;
    let cumulativeNegative = 0;
    let skippedPreRelease = 0;
    const rows: SignalSnapshot[] = [];
    const emittedDays: string[] = [];
    for (const bucket of hist.buckets) {
      cumulativePositive += bucket.positive;
      cumulativeNegative += bucket.negative;
      if (releaseMonthStart && bucket.day < releaseMonthStart) {
        skippedPreRelease += 1;
        continue;
      }
      const total = cumulativePositive + cumulativeNegative;
      rows.push(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_REVIEWS,
          value: total,
          averageRating: total > 0 ? cumulativePositive / total : null,
          capturedAt: new Date(`${bucket.day}T00:00:00.000Z`),
        }),
      );
      emittedDays.push(bucket.day);
    }

    if (rows.length === 0) {
      // All buckets predate release: fall back rather than import nothing.
      const api = await this.backfillReviewsFromApi(gameId);
      return {
        method: 'enumeration',
        rollupType: hist.rollupType,
        pointsImported: api.daysImported,
        rangeStart: api.rangeStart,
        rangeEnd: api.rangeEnd,
        latestTotal: api.latestTotal,
        latestRating: api.latestRating,
      };
    }

    const firstDay = new Date(`${emittedDays[0]}T00:00:00.000Z`);
    const lastDay = new Date(
      `${emittedDays[emittedDays.length - 1]}T00:00:00.000Z`,
    );
    const lastDayEnd = new Date(lastDay.getTime() + 24 * 3600 * 1000 - 1);

    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_REVIEWS,
      capturedAt: Between(firstDay, lastDayEnd),
    });
    await this.signals.save(rows, { chunk: 500 });

    const latestTotal = cumulativePositive + cumulativeNegative;
    const latestRating =
      latestTotal > 0 ? cumulativePositive / latestTotal : null;

    this.logger.log(
      `[reviews-histogram] "${game.name}" — ${rows.length} months ` +
        `(${emittedDays[0]} → ${emittedDays[emittedDays.length - 1]}), ` +
        `latest ${latestTotal.toLocaleString()} reviews` +
        (latestRating !== null
          ? ` (${(latestRating * 100).toFixed(1)}% positive)`
          : '') +
        (skippedPreRelease > 0
          ? ` (skipped ${skippedPreRelease} pre-release months)`
          : ''),
    );

    return {
      method: 'histogram',
      rollupType: hist.rollupType,
      pointsImported: rows.length,
      rangeStart: emittedDays[0],
      rangeEnd: emittedDays[emittedDays.length - 1],
      latestTotal,
      latestRating,
    };
  }

  /**
   * Backfill historical monthly concurrent-player data from SteamCharts into
   * `STEAM_CONCURRENT` (one row per completed month, holding that month's peak)
   * plus the all-time `STEAM_PEAK_CCU`. Mirrors `importCcuCsv` but sources the
   * data automatically instead of a manual SteamDB export. Months before
   * release are dropped; the current partial month ("Last 30 Days") is skipped
   * so live-poll rows are left untouched.
   */
  async backfillCcuFromSteamCharts(gameId: string): Promise<{
    monthsImported: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    peakValue: number;
    peakAt: string | null;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found.`);
    }

    const steamSource = await this.gameSources.findOne({
      where: { gameId, source: SourceType.STEAM },
    });
    const appId = steamSource ? Number(steamSource.externalId) : NaN;
    if (!Number.isFinite(appId)) {
      throw new BadRequestException(
        `Game "${game.name}" is not linked to a Steam app.`,
      );
    }

    const months = await this.steamCharts.fetchMonthlyCcu(appId);
    if (!months || months.length === 0) {
      throw new BadRequestException(
        `No SteamCharts data returned for app ${appId}.`,
      );
    }

    const releaseMonthStart = game.releaseDate
      ? `${game.releaseDate.toISOString().slice(0, 7)}-01`
      : null;

    const usable = months.filter(
      (m) =>
        m.peakPlayers > 0 &&
        (releaseMonthStart === null || m.monthStart >= releaseMonthStart),
    );
    if (usable.length === 0) {
      throw new BadRequestException(
        `All SteamCharts months for app ${appId} predate release or are empty.`,
      );
    }

    const firstMonth = new Date(`${usable[0].monthStart}T00:00:00.000Z`);
    const lastMonth = new Date(
      `${usable[usable.length - 1].monthStart}T00:00:00.000Z`,
    );
    // Cover the whole last month so a previous monthly row for it is replaced,
    // but stop short of the current (skipped) month's live-poll rows.
    const lastMonthEnd = new Date(
      Date.UTC(
        lastMonth.getUTCFullYear(),
        lastMonth.getUTCMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ),
    );

    await this.signals.delete({
      gameId,
      metric: SignalMetric.STEAM_CONCURRENT,
      capturedAt: Between(firstMonth, lastMonthEnd),
    });

    const rows = usable.map((m) =>
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_CONCURRENT,
        value: m.peakPlayers,
        capturedAt: new Date(`${m.monthStart}T00:00:00.000Z`),
      }),
    );
    await this.signals.save(rows, { chunk: 500 });

    let peakValue = 0;
    let peakMonth = usable[0].monthStart;
    for (const m of usable) {
      if (m.peakPlayers > peakValue) {
        peakValue = m.peakPlayers;
        peakMonth = m.monthStart;
      }
    }
    const peakAt = new Date(`${peakMonth}T00:00:00.000Z`);
    const priorPeakRow = await this.signals.findOne({
      where: { gameId, metric: SignalMetric.STEAM_PEAK_CCU },
      order: { value: 'DESC' },
    });
    if (!priorPeakRow || peakValue > priorPeakRow.value) {
      await this.signals.save(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_PEAK_CCU,
          value: peakValue,
          capturedAt: peakAt,
        }),
      );
    }

    this.logger.log(
      `[ccu-steamcharts] "${game.name}" — ${usable.length} months ` +
        `(${usable[0].monthStart} → ${usable[usable.length - 1].monthStart}), ` +
        `peak ${peakValue.toLocaleString()} at ${peakMonth}`,
    );

    return {
      monthsImported: usable.length,
      rangeStart: usable[0].monthStart,
      rangeEnd: usable[usable.length - 1].monthStart,
      peakValue,
      peakAt: peakAt.toISOString(),
    };
  }

  /** Add `count` months to a `YYYY-MM-01` key, returning the same format. */
  private addMonths(monthStart: string, count: number): string {
    const [y, m] = monthStart.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + count, 1));
    return `${d.toISOString().slice(0, 7)}-01`;
  }

  /**
   * Recompute the matcher's derived per-game features (franchise
   * identity + live-service flag) from the game's current name and
   * categories, mutating the entity in place. Idempotent and pure —
   * safe to call before every save. Kept here (not in the entity) so
   * the derivation lives in one place shared with the backfill scripts
   * (`game-features.ts`).
   */
  private applyDerivedFeatures(game: Game): void {
    const franchise = deriveFranchise(game.name);
    game.franchiseSlug = franchise.franchiseSlug;
    game.isAnnualIteration = franchise.isAnnualIteration;
    game.iterationNumber = franchise.iterationNumber;
    game.liveService = deriveLiveService(game.name, game.categories);
  }

  async scrapeAchievements(
    gameId: string,
    name: string,
    platform: Platform,
  ): Promise<void> {
    try {
      const result = await this.exophase.getAchievements(name, platform);
      if (!result) return;

      const capturedAt = new Date();
      const rows = result.achievements.map((a) =>
        this.achievements.create({
          gameId,
          platform,
          source: SourceType.EXOPHASE,
          achievementSlug: a.slug,
          achievementName: a.name,
          percentEarned: a.percentEarned,
          playersTracked: result.playersTracked,
          playersWithAchievement: Math.round(
            (result.playersTracked * a.percentEarned) / 100,
          ),
          capturedAt,
        }),
      );

      await this.achievements.save(rows);

      const mostCommon = result.achievements.reduce((max, a) =>
        a.percentEarned > max.percentEarned ? a : max,
      );
      const mostCommonPlayers = Math.round(
        (result.playersTracked * mostCommon.percentEarned) / 100,
      );
      this.logger.log(
        `[achievements] "${name}" (${platform}) — tracked=${result.playersTracked.toLocaleString()}, ` +
          `achievements=${result.achievements.length}/${result.totalAchievements}, ` +
          `mostCommon="${mostCommon.name}" ${mostCommon.percentEarned}% (${mostCommonPlayers.toLocaleString()} players on Exophase)`,
      );
    } catch (error) {
      this.logger.warn(
        `Achievement scrape failed for "${name}" (${platform}): ${error}`,
      );
    }
  }

  async discoverBacklogByGameId(gameId: string): Promise<{
    found: boolean;
    checked?: number;
    ingested?: number;
    records?: number;
  }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return { found: false };
    const result = await this.discoverBacklog(gameId, game.name);
    return { found: true, ...result };
  }

  /**
   * Backlog discovery via web search (Tavily and/or Perplexity, controlled by
   * the `BACKLOG_SEARCH_ENGINE` env var): find sales articles (typically older
   * coverage that predates our RSS polling), then run the same grounded LLM
   * extraction on each result's page text. The host is matched against the
   * trusted-source registry to pick the sales tier/confidence; unknown hosts
   * fall back to a low-confidence MEDIA figure. Already-processed URLs are
   * skipped. Best-effort: each step logs and continues.
   */
  async discoverBacklog(
    gameId: string,
    name: string,
  ): Promise<{ checked: number; ingested: number; records: number }> {
    let checked = 0;
    let ingested = 0;
    let records = 0;

    const engine = this.resolveBacklogEngine();
    if (engine === null) {
      this.logger.log(
        `[backlog] "${name}" — no backlog search engine configured (set TAVILY_API_KEY and/or PERPLEXITY_API_KEY)`,
      );
      return { checked, ingested, records };
    }

    try {
      // Multiple query phrasings catch different headline patterns:
      //   - "X copies sold / units shipped" → traditional sales coverage
      //   - "X million players reached" → engagement milestones (often the only
      //     public number for subscription-led launches like Ubisoft+/Game Pass)
      //   - "sales milestone / announcement" → PR-style coverage with vague titles
      const queries = [
        `${name} total copies sold lifetime`,
        `${name} million players reached milestone`,
        `${name} units shipped sold to date`,
        `${name} sales figures announcement`,
        `${name} total copies sold reached milestone`,
      ];

      const results = await this.runBacklogSearch(engine, name, queries);
      if (results.length === 0) {
        return { checked, ingested, records };
      }

      for (const result of results) {
        if (
          await this.processedArticles.findOne({ where: { url: result.url } })
        ) {
          this.logger.debug(
            `[backlog] "${name}" — skip (already processed): ${result.url}`,
          );
          continue;
        }
        checked += 1;

        const pubDate = result.publishedDate
          ? new Date(result.publishedDate)
          : null;

        const stored = await this.ingestArticleFromText(
          gameId,
          name,
          result.url,
          result.rawContent ?? result.content,
          pubDate,
        );

        await this.processedArticles.save(
          this.processedArticles.create({
            url: result.url,
            matchedGameId: gameId,
            hadFigure: stored > 0,
          }),
        );

        if (stored > 0) {
          ingested += 1;
          records += stored;
          this.logger.log(
            `[backlog] "${name}" — ${stored} record(s) from ${result.url}`,
          );
        } else {
          this.logger.log(
            `[backlog] "${name}" — no figure extracted from ${result.url}`,
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (error) {
      this.logger.warn(`Backlog discovery failed for "${name}": ${error}`);
    }
    return { checked, ingested, records };
  }

  /**
   * Resolve which backlog search engine(s) to use based on the
   * `BACKLOG_SEARCH_ENGINE` env var and whichever API keys are configured.
   * Returns `null` when no engine is usable.
   */
  private resolveBacklogEngine(): 'tavily' | 'perplexity' | 'both' | null {
    const raw = (
      this.config.get<string>('BACKLOG_SEARCH_ENGINE') ?? 'tavily'
    ).toLowerCase();
    const requested: 'tavily' | 'perplexity' | 'both' =
      raw === 'perplexity' || raw === 'both' ? raw : 'tavily';

    const tavily = this.tavily.enabled;
    const perplexity = this.perplexity.enabled;

    if (requested === 'both') {
      if (tavily && perplexity) return 'both';
      if (tavily) return 'tavily';
      if (perplexity) return 'perplexity';
      return null;
    }
    if (requested === 'perplexity') return perplexity ? 'perplexity' : null;
    return tavily ? 'tavily' : null;
  }

  /**
   * Run the multi-query backlog search against the chosen engine(s) and return
   * a deduplicated list of results (URL-keyed) capped to a safe LLM budget.
   */
  private async runBacklogSearch(
    engine: 'tavily' | 'perplexity' | 'both',
    name: string,
    queries: string[],
  ): Promise<TavilyResult[]> {
    const merged = new Map<string, TavilyResult>();
    const addAll = (list: TavilyResult[]) => {
      for (const r of list) {
        const prev = merged.get(r.url);
        if (!prev || prev.score < r.score) merged.set(r.url, r);
      }
    };

    const tavilyJob = async (): Promise<number> => {
      // Tavily takes a single query per call, so we fan out one HTTP request
      // per variant and merge.
      const perQuery = await Promise.all(
        queries.map((q) =>
          this.tavily.search(q, {
            maxResults: 12,
            excludeDomains: TAVILY_EXCLUDED_DOMAINS,
          }),
        ),
      );
      let count = 0;
      for (const list of perQuery) {
        addAll(list);
        count += list.length;
      }
      return count;
    };

    const perplexityJob = async (): Promise<number> => {
      // Perplexity's Search API accepts multi-query natively (up to 5 queries
      // per HTTP call); our 4 variants fit in a single billed request.
      const list = await this.perplexity.search(queries, {
        maxResults: 12,
        excludeDomains: TAVILY_EXCLUDED_DOMAINS,
      });
      addAll(list);
      return list.length;
    };

    if (engine === 'tavily') {
      const total = await tavilyJob();
      this.logger.log(
        `[backlog] "${name}" — Tavily returned ${total} raw / ${merged.size} unique result(s) across ${queries.length} queries`,
      );
    } else if (engine === 'perplexity') {
      const total = await perplexityJob();
      this.logger.log(
        `[backlog] "${name}" — Perplexity returned ${total} raw / ${merged.size} unique result(s) across ${queries.length} queries`,
      );
    } else {
      const [tavilyCount, perplexityCount] = await Promise.all([
        tavilyJob(),
        perplexityJob(),
      ]);
      this.logger.log(
        `[backlog] "${name}" — Tavily=${tavilyCount} + Perplexity=${perplexityCount} raw → ${merged.size} unique URL(s) after cross-engine dedupe`,
      );
    }

    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 24);
  }

  /**
   * Extract and store sales figures from page text already in hand (e.g. a
   * Tavily result's raw content), falling back to fetching the URL when the
   * provided text is too short. Tier/confidence come from the trusted-source
   * registry. Returns the number of records stored.
   */
  private async ingestArticleFromText(
    gameId: string,
    gameName: string,
    url: string,
    text: string,
    fallbackDate: Date | null = null,
  ): Promise<number> {
    // Read-only lookup here: a fresh host has no entry yet, so we use the
    // MEDIA / weight=40 fallback. The actual TrustedSource row is created
    // only once we know the URL produced a usable record (in
    // `storeArticleSales`), so unknown hosts that yield nothing never pollute
    // the registry.
    const trusted = await this.sources.findByUrl(url);
    const tier = trusted?.salesSource ?? SalesSource.MEDIA;
    const confidenceScore = trusted?.weight ?? DEFAULT_CONFIDENCE_SCORE[tier];

    let sales =
      text && text.length >= 200
        ? await this.article.extractFromText(text, url, gameName, {
            fallbackDate,
          })
        : null;
    if (!sales) sales = await this.article.extract(url, gameName);
    if (!sales) return 0;

    return this.storeArticleSales(gameId, url, tier, confidenceScore, sales);
  }

  /**
   * Manually record a milestone (e.g. from an official report or a press
   * announcement) until automated discovery covers those sources. A
   * `reportedAt` is required: undated milestones cannot calibrate.
   */
  async addMilestone(input: ManualSalesInput): Promise<Milestone> {
    if (!input.reportedAt) {
      throw new BadRequestException(
        'reportedAt is required: a milestone without a date cannot be ingested.',
      );
    }
    return this.milestones.save(
      this.milestones.create({
        gameId: input.gameId,
        source: input.source,
        units: input.units,
        confidenceScore: DEFAULT_CONFIDENCE_SCORE[input.source],
        publisher: input.publisher ?? null,
        sourceUrl: input.sourceUrl ?? null,
        region: input.region ?? 'GLOBAL',
        reportedAt: new Date(input.reportedAt),
      }),
    );
  }

  /**
   * Re-run the automatic source discovery for an existing game: Wikipedia
   * (LLM), trusted press articles (web search + LLM) and console store
   * ratings. Used by the "search sources" button on the detail page.
   * Best-effort: each source logs and continues.
   */
  async refreshGame(
    gameId: string,
  ): Promise<{ found: boolean; articlesIngested: number }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) {
      this.logger.warn(`refreshGame: game ${gameId} not found`);
      return { found: false, articlesIngested: 0 };
    }

    const startedAt = Date.now();
    this.logger.log(`[refresh] "${game.name}" (${gameId}) — starting`);

    await this.ensureSteamSource(game);

    this.logger.log(`[refresh] "${game.name}" — Wikipedia LLM extraction…`);
    await this.scrapeWikipedia(game.id, game.name);

    this.logger.log(`[refresh] "${game.name}" — store ratings (PS/Xbox)…`);
    await this.scrapeStoreRatings(game.id, game.name, game.platforms);

    this.logger.log(
      `[refresh] "${game.name}" — achievements (Exophase Steam / PSN / Xbox + Steam official %)…`,
    );
    const steamSource = await this.gameSources.findOne({
      where: { gameId: game.id, source: SourceType.STEAM },
    });
    const steamAppId = steamSource ? Number(steamSource.externalId) : NaN;
    await Promise.all([
      this.scrapeAchievements(game.id, game.name, Platform.PC),
      this.scrapeAchievements(game.id, game.name, Platform.PLAYSTATION),
      this.scrapeAchievements(game.id, game.name, Platform.XBOX),
      Number.isFinite(steamAppId)
        ? this.scrapeSteamOfficialAchievements(game.id, game.name, steamAppId)
        : Promise.resolve(),
      // CCU is intentionally excluded here: live concurrent players are polled
      // on a short cadence by the dedicated CCU cron (`pollAllSteamCcu`), not
      // during the nightly full refresh. Reviews remain on the refresh chain.
      Number.isFinite(steamAppId)
        ? this.pollSteamReviews(game.id, steamAppId)
        : Promise.resolve(),
    ]);

    this.logger.log(`[refresh] "${game.name}" — running backlog discovery…`);
    const backlog = await this.discoverBacklog(game.id, game.name);
    this.logger.log(
      `[refresh] "${game.name}" — backlog checked=${backlog.checked} ingested=${backlog.ingested} records=${backlog.records}`,
    );

    this.logger.log(`[refresh] "${game.name}" — rebuilding estimate history…`);
    const rebuild = await this.gamesService.rebuildEstimateHistory(game.id);
    this.logger.log(
      `[refresh] "${game.name}" — rebuilt ${rebuild.points} point(s): ${rebuild.estimates} estimates, ${rebuild.snapshots} snapshots`,
    );

    await this.games.update(game.id, { lastRefreshedAt: new Date() });

    const totalIngested = backlog.ingested;
    this.logger.log(
      `[refresh] "${game.name}" — done in ${Date.now() - startedAt}ms, ${totalIngested} article(s) ingested with figures`,
    );

    return { found: true, articlesIngested: 0 };
  }

  /**
   * Ingest sales figures from a press/news article URL. The article's host is
   * matched against the trusted-source registry to pick the sales tier and
   * confidence; unknown hosts fall back to a low-confidence MEDIA figure. The
   * LLM extracts only grounded figures (verbatim quotes) for the target game.
   * Re-ingesting the same URL replaces its previous records.
   */
  async ingestArticle(
    url: string,
    gameId: string,
  ): Promise<ArticleIngestResult | null> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return null;

    // See `ingestArticleFromText`: registry insertion is deferred until we
    // know the article produced at least one accepted milestone.
    const trusted = await this.sources.findByUrl(url);
    const tier = trusted?.salesSource ?? SalesSource.MEDIA;
    const confidenceScore = trusted?.weight ?? DEFAULT_CONFIDENCE_SCORE[tier];

    const sales = await this.article.extract(url, game.name);
    if (!sales) {
      return {
        matchedSource: trusted?.name ?? null,
        tier,
        milestonesStored: 0,
      };
    }

    const milestonesStored = await this.storeArticleSales(
      gameId,
      url,
      tier,
      confidenceScore,
      sales,
    );
    return { matchedSource: trusted?.name ?? null, tier, milestonesStored };
  }

  /**
   * Poll every trusted source's RSS feed, match each new article to a tracked
   * game by title, and run the grounded LLM extraction on the feed content.
   * Already-seen URLs are skipped so the LLM only runs once per article.
   * Best-effort: each feed/article logs and continues.
   */
  async pollFeeds(): Promise<{
    feeds: number;
    seen: number;
    ingested: number;
    records: number;
  }> {
    const sources = await this.sources.feedSources();
    let seen = 0;
    let ingested = 0;
    let records = 0;

    for (const source of sources) {
      if (!source.feedUrl) continue;
      const articles = await this.rss.fetchArticles(source.feedUrl);
      for (const item of articles) {
        if (
          await this.processedArticles.findOne({ where: { url: item.url } })
        ) {
          continue;
        }
        seen += 1;

        let matchedGameId: string | null = null;
        let hadFigure = false;
        try {
          const result = await this.processFeedArticle(item, source);
          matchedGameId = result.gameId;
          if (result.records > 0) {
            hadFigure = true;
            ingested += 1;
            records += result.records;
          }
        } catch (error) {
          this.logger.warn(`Feed article failed (${item.url}): ${error}`);
        }

        await this.processedArticles.save(
          this.processedArticles.create({
            url: item.url,
            matchedGameId,
            hadFigure,
          }),
        );
      }
    }

    this.logger.log(
      `Feed poll: ${sources.length} feed(s), ${seen} new, ${ingested} ingested, ${records} record(s).`,
    );
    return { feeds: sources.length, seen, ingested, records };
  }

  private async processFeedArticle(
    item: {
      title: string;
      url: string;
      contentHtml: string;
      publishedAt?: Date | null;
    },
    source: TrustedSource,
  ): Promise<{ gameId: string | null; records: number }> {
    const game = await this.gamesService.matchByTitle(item.title);
    if (!game) return { gameId: null, records: 0 };

    const fallbackDate = item.publishedAt ?? null;
    const text = item.contentHtml
      ? this.article.htmlToText(item.contentHtml)
      : '';
    let sales =
      text.length >= 200
        ? await this.article.extractFromText(text, item.url, game.name, {
            fallbackDate,
          })
        : null;
    // Feeds that only carry a short summary: fall back to fetching the page.
    if (!sales) sales = await this.article.extract(item.url, game.name);
    if (!sales) return { gameId: game.id, records: 0 };

    const records = await this.storeArticleSales(
      game.id,
      item.url,
      source.salesSource,
      source.weight,
      sales,
    );
    return { gameId: game.id, records };
  }

  // Replace a game's milestones for one source URL with the freshly extracted
  // figures (a worldwide total). Milestones dated before the game's release
  // date are dropped (they are almost always referring to an earlier title in
  // the same series). Milestones without `reportedAt` are also dropped —
  // calibration needs a date.
  private async storeArticleSales(
    gameId: string,
    url: string,
    tier: SalesSource,
    confidenceScore: number,
    sales: ArticleSales,
  ): Promise<number> {
    // Preserve admin-rejected fingerprints: a rejected milestone stays in
    // place so the fingerprint guard below can skip the matching re-extract.
    await this.milestones.delete({
      gameId,
      sourceUrl: url,
      rejectedAt: IsNull(),
    });

    const releaseDate = await this.getReleaseDate(gameId);

    const rows: Milestone[] = [];
    let undatedSkipped = 0;
    if (sales.global) {
      if (!sales.global.reportedAt) {
        undatedSkipped += 1;
      } else if (
        this.isReportedAfterRelease(sales.global.reportedAt, releaseDate)
      ) {
        rows.push(
          this.milestones.create({
            gameId,
            source: tier,
            units: sales.global.units,
            confidenceScore,
            publisher: sales.attribution,
            sourceUrl: url,
            note: sales.global.quote,
            reportedAt: sales.global.reportedAt,
            region: 'GLOBAL',
          }),
        );
      }
    }
    if (sales.pc) {
      if (!sales.pc.reportedAt) {
        undatedSkipped += 1;
      } else if (
        this.isReportedAfterRelease(sales.pc.reportedAt, releaseDate)
      ) {
        rows.push(
          this.milestones.create({
            gameId,
            source: tier,
            units: sales.pc.units,
            confidenceScore,
            publisher: sales.attribution,
            sourceUrl: url,
            note: sales.pc.quote,
            reportedAt: sales.pc.reportedAt,
            region: 'PC',
          }),
        );
      }
    }
    if (sales.engagement) {
      if (!sales.engagement.reportedAt) {
        undatedSkipped += 1;
      } else if (
        this.isReportedAfterRelease(sales.engagement.reportedAt, releaseDate)
      ) {
        rows.push(
          this.milestones.create({
            gameId,
            source: tier,
            units: sales.engagement.units,
            confidenceScore,
            publisher: sales.attribution,
            sourceUrl: url,
            note: sales.engagement.quote,
            reportedAt: sales.engagement.reportedAt,
            region: 'GLOBAL',
            isEngagement: true,
          }),
        );
      }
    }

    const accepted = await this.filterOutRejected(rows);
    if (accepted.length > 0) {
      await this.milestones.save(accepted);
      // The article actually produced usable milestone(s) — register the
      // hostname in the trusted-source registry if it isn't already. This is
      // the *only* path through which the registry auto-grows: hosts that
      // never yield an accepted figure never make it in.
      await this.sources.ensureForUrl(url);
    }
    const skipped = rows.length - accepted.length;
    if (skipped > 0) {
      this.logger.log(
        `[article] ${url} — ${skipped} milestone(s) match an admin-rejected fingerprint, skipping reinsert`,
      );
    }
    if (undatedSkipped > 0) {
      this.logger.log(
        `[article] ${url} — ${undatedSkipped} undated milestone(s) skipped (date required)`,
      );
    }
    return accepted.length;
  }

  /**
   * Drop the candidate rows whose strict fingerprint matches an existing
   * admin-rejected milestone (so a refresh can never resurrect a milestone
   * the admin manually deleted). Fingerprint:
   *   (gameId, source, sourceUrl, units, reportedAt).
   * `null` values are compared as equal (both null = same fingerprint).
   */
  private async filterOutRejected(rows: Milestone[]): Promise<Milestone[]> {
    if (rows.length === 0) return rows;
    const gameIds = [...new Set(rows.map((r) => r.gameId))];
    const rejected = await this.milestones.find({
      where: { gameId: In(gameIds), rejectedAt: Not(IsNull()) },
      select: {
        gameId: true,
        source: true,
        sourceUrl: true,
        units: true,
        reportedAt: true,
      },
    });
    if (rejected.length === 0) return rows;
    const fingerprint = (r: {
      gameId: string;
      source: SalesSource;
      sourceUrl: string | null;
      units: number;
      reportedAt: Date | null;
    }): string =>
      [
        r.gameId,
        r.source,
        r.sourceUrl ?? '',
        r.units,
        r.reportedAt ? r.reportedAt.getTime() : '',
      ].join('|');
    const blocked = new Set(rejected.map((r) => fingerprint(r)));
    return rows.filter((r) => !blocked.has(fingerprint(r)));
  }

  private async getReleaseDate(gameId: string): Promise<Date | null> {
    const game = await this.games.findOne({
      where: { id: gameId },
      select: { id: true, releaseDate: true },
    });
    return game?.releaseDate ?? null;
  }

  // A reported sales date older than the game's release date almost always
  // means the figure refers to a previous title in the same series. When the
  // game has no known release date we keep the record (cannot tell).
  private isReportedAfterRelease(
    reportedAt: Date | null | undefined,
    releaseDate: Date | null,
  ): boolean {
    if (!reportedAt || !releaseDate) return true;
    return new Date(reportedAt) >= releaseDate;
  }

  /**
   * Search IGDB and upsert the resulting games. When a Steam app id is linked,
   * trigger a full Steam ingestion to attach live signals.
   */
  async importFromIgdb(query: string): Promise<number> {
    const results = await this.igdb.searchGames(query);

    for (const g of results) {
      const existing = await this.games.findOne({
        where: { igdbId: g.igdbId },
        withDeleted: true,
      });

      if (existing?.deletedAt) {
        this.logger.log(
          `[import-igdb] skipping soft-deleted game "${existing.name}" (igdb=${g.igdbId})`,
        );
        continue;
      }

      if (existing) {
        existing.name = g.name;
        existing.summary = g.summary;
        existing.releaseDate = g.releaseDate;
        existing.coverUrl = g.coverUrl;
        if (g.platforms.length > 0) existing.platforms = g.platforms;
        if (g.developer) existing.developer = g.developer;
        if (g.publisher) existing.publisher = g.publisher;
        if (g.genres.length > 0) existing.genres = g.genres;
        const saved = await this.games.save(existing);
        await this.publishers.resolveAndLink(saved.id, saved.publisher);
      } else {
        const entity = this.games.create({
          igdbId: g.igdbId,
          name: g.name,
          slug: await this.uniqueSlug(g.name),
          summary: g.summary,
          releaseDate: g.releaseDate,
          coverUrl: g.coverUrl,
          platforms: g.platforms.length > 0 ? g.platforms : [Platform.PC],
          developer: g.developer,
          publisher: g.publisher,
          genres: g.genres.length > 0 ? g.genres : null,
        });
        const saved = await this.games.save(entity);
        await this.publishers.resolveAndLink(saved.id, saved.publisher);
      }

      if (g.steamAppId) {
        await this.ingestSteamApp(g.steamAppId);
      }
    }

    return results.length;
  }

  /**
   * Retroactively attach a Steam source to an already-tracked game that ships
   * on PC but had no Steam app linked on IGDB at ingestion time. Resolves the
   * appId from the game name (Steam community search) and runs the full Steam
   * ingest path, which our upsert recognizes via igdbId and attaches to the
   * existing game rather than creating a duplicate.
   */
  private async ensureSteamSource(game: Game): Promise<void> {
    if (!game.platforms?.includes(Platform.PC)) return;

    const existing = await this.gameSources.findOne({
      where: { gameId: game.id, source: SourceType.STEAM },
    });
    if (existing) return;

    const appId = await this.steam.findAppIdByName(game.name);
    if (!appId) return;

    this.logger.log(
      `[refresh] "${game.name}" — resolved Steam appId ${appId} via name search, attaching`,
    );
    await this.ingestSteamApp(appId);
  }

  private async upsertGameFromSteam(
    appId: number,
    details: SteamAppDetails,
    options: { restoreDeleted?: boolean } = {},
  ): Promise<Game | null> {
    const { restoreDeleted = false } = options;

    const existingSource = await this.gameSources.findOne({
      where: {
        source: SourceType.STEAM,
        externalId: String(appId),
      },
    });
    // Reload the game via its id with `withDeleted` so a soft-deleted game
    // is still found (the eager join used previously hides soft-deleted
    // related rows). We need to see it to know whether to skip or restore.
    const existingGame = existingSource
      ? await this.games.findOne({
          where: { id: existingSource.gameId },
          withDeleted: true,
        })
      : null;

    // IGDB enrichment: best-effort lookup that gives us the real platforms
    // list (Steam ingestion alone can't tell us if a title also ships on
    // PS/Xbox/Switch), the IGDB pivot id, and fallback metadata when the
    // Steam payload is missing publisher / developer / cover.
    const igdb = await this.igdb.findBySteamAppId(appId);

    // Community tags scraped from the store page — the matcher's richest
    // gameplay-type axis. Best-effort (null on failure); only overwrite when
    // we actually got tags so a transient scrape failure never wipes them.
    const steamTags = await this.steam.getStoreTags(appId);

    if (existingGame) {
      if (existingGame.deletedAt) {
        if (!restoreDeleted) {
          this.logger.log(
            `[ingest-steam] skipping soft-deleted game "${existingGame.name}" (app=${appId})`,
          );
          return null;
        }
        await this.games.restore(existingGame.id);
        existingGame.deletedAt = null;
      }
      const game = existingGame;
      game.releaseDate = details.releaseDate ?? game.releaseDate;
      game.coverUrl = details.headerImage ?? igdb?.coverUrl ?? game.coverUrl;
      game.summary = details.shortDescription ?? game.summary;
      game.isFree = details.isFree;
      if (details.developers.length > 0) {
        game.developer = details.developers[0];
      } else if (igdb?.developer) {
        game.developer = igdb.developer;
      }
      if (details.publishers.length > 0) {
        game.publisher = details.publishers[0];
      } else if (igdb?.publisher) {
        game.publisher = igdb.publisher;
      }
      if (details.genres.length > 0) game.genres = details.genres;
      else if (igdb?.genres.length) game.genres = igdb.genres;
      if (details.categories.length > 0) game.categories = details.categories;
      if (steamTags) game.steamTags = steamTags;
      if (details.dlc.length > 0) game.dlc = details.dlc;
      if (igdb) {
        if (game.igdbId == null) game.igdbId = igdb.igdbId;
        if (igdb.platforms.length > 0) game.platforms = igdb.platforms;
      }
      this.applyDerivedFeatures(game);
      const saved = await this.games.save(game);
      await this.publishers.resolveAndLink(saved.id, saved.publisher);
      return saved;
    }

    // When IGDB resolves a game id we already track (via the IGDB-first
    // discovery path), just attach the Steam source to it instead of creating
    // a duplicate game. This is what makes the Steam-by-name fallback work
    // for titles IGDB hadn't linked to Steam (Battlefield 4 et al.).
    if (igdb) {
      const existingByIgdb = await this.games.findOne({
        where: { igdbId: igdb.igdbId },
        withDeleted: true,
      });
      if (existingByIgdb) {
        if (existingByIgdb.deletedAt) {
          if (!restoreDeleted) {
            this.logger.log(
              `[ingest-steam] skipping soft-deleted game "${existingByIgdb.name}" (igdb=${igdb.igdbId})`,
            );
            return null;
          }
          await this.games.restore(existingByIgdb.id);
          existingByIgdb.deletedAt = null;
        }
        await this.gameSources.save(
          this.gameSources.create({
            gameId: existingByIgdb.id,
            source: SourceType.STEAM,
            externalId: String(appId),
            url: `https://store.steampowered.com/app/${appId}`,
          }),
        );
        existingByIgdb.releaseDate =
          details.releaseDate ?? existingByIgdb.releaseDate;
        existingByIgdb.coverUrl =
          details.headerImage ?? existingByIgdb.coverUrl;
        existingByIgdb.summary =
          details.shortDescription ?? existingByIgdb.summary;
        existingByIgdb.isFree = details.isFree;
        if (details.developers.length > 0 && !existingByIgdb.developer) {
          existingByIgdb.developer = details.developers[0];
        }
        if (details.publishers.length > 0 && !existingByIgdb.publisher) {
          existingByIgdb.publisher = details.publishers[0];
        }
        if (
          details.genres.length > 0 &&
          (!existingByIgdb.genres || existingByIgdb.genres.length === 0)
        ) {
          existingByIgdb.genres = details.genres;
        }
        if (details.categories.length > 0) {
          existingByIgdb.categories = details.categories;
        }
        if (steamTags) existingByIgdb.steamTags = steamTags;
        if (details.dlc.length > 0) existingByIgdb.dlc = details.dlc;
        this.applyDerivedFeatures(existingByIgdb);
        const saved = await this.games.save(existingByIgdb);
        await this.publishers.resolveAndLink(saved.id, saved.publisher);
        return saved;
      }
    }

    const platforms =
      igdb && igdb.platforms.length > 0 ? igdb.platforms : [Platform.PC];

    const entity = this.games.create({
      igdbId: igdb?.igdbId ?? null,
      name: details.name,
      slug: await this.uniqueSlug(details.name),
      releaseDate: details.releaseDate,
      coverUrl: details.headerImage ?? igdb?.coverUrl ?? null,
      summary: details.shortDescription,
      isFree: details.isFree,
      platforms,
      developer: details.developers[0] ?? igdb?.developer ?? null,
      publisher: details.publishers[0] ?? igdb?.publisher ?? null,
      genres:
        details.genres.length > 0
          ? details.genres
          : igdb?.genres.length
            ? igdb.genres
            : null,
      categories: details.categories.length > 0 ? details.categories : null,
      steamTags,
      dlc: details.dlc.length > 0 ? details.dlc : null,
    });
    this.applyDerivedFeatures(entity);
    const game = await this.games.save(entity);

    await this.gameSources.save(
      this.gameSources.create({
        gameId: game.id,
        source: SourceType.STEAM,
        externalId: String(appId),
        url: `https://store.steampowered.com/app/${appId}`,
      }),
    );

    await this.publishers.resolveAndLink(game.id, game.publisher);
    return game;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'game';
    let candidate = base;
    let suffix = 1;
    // `withDeleted` because the `slug` column has a DB-level unique index that
    // also covers soft-deleted rows. Without it we'd happily return a slug
    // already held by a soft-deleted game and crash on insert.
    while (
      await this.games.findOne({
        where: { slug: candidate },
        withDeleted: true,
      })
    ) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
  private hasConsolePlatform(
    platforms: Platform[] | null | undefined,
  ): boolean {
    return (
      platforms?.some(
        (p) => p === Platform.PLAYSTATION || p === Platform.XBOX,
      ) ?? false
    );
  }
}

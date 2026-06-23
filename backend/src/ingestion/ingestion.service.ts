import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AchievementSnapshot,
  ConfidenceLevel,
  Game,
  GameSource,
  Platform,
  ProcessedArticle,
  SalesRecord,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
  SourceType,
  TrustedSource,
} from '../entities';
import { EstimationService } from '../estimation/estimation.service';
import { GamesService } from '../games/games.service';
import { slugify } from '../common/slug';
import { SteamAppDetails, SteamClient } from './steam.client';
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
  platform: Platform;
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
  recordsStored: number;
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
    @InjectRepository(SalesRecord)
    private readonly salesRecords: Repository<SalesRecord>,
    @InjectRepository(ProcessedArticle)
    private readonly processedArticles: Repository<ProcessedArticle>,
    @InjectRepository(AchievementSnapshot)
    private readonly achievements: Repository<AchievementSnapshot>,
    private readonly estimation: EstimationService,
    private readonly gamesService: GamesService,
    private readonly steam: SteamClient,
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

  // ───── IGDB backfill state (in-memory, single-instance) ─────────────────
  //
  // Backfilling the whole catalog against IGDB takes minutes (rate-limited
  // at ~4 req/s by Twitch). Rather than block an HTTP request that long, the
  // job runs fire-and-forget on the Node process and exposes a polled status
  // so the admin UI can show progress. State lives in memory; on backend
  // restart, an in-flight backfill is lost and must be restarted.

  private igdbBackfillState: {
    running: boolean;
    total: number;
    processed: number;
    updated: number;
    skipped: number;
    startedAt: Date | null;
    finishedAt: Date | null;
    lastError: string | null;
  } = {
    running: false,
    total: 0,
    processed: 0,
    updated: 0,
    skipped: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
  };

  /**
   * Kick off a full IGDB backfill against the catalog (re-enriches platforms
   * / publisher / developer / genres / igdbId on every game where IGDB has
   * something to say). Returns immediately; progress is tracked on the
   * service singleton and surfaced through `getIgdbBackfillStatus`. No-op if
   * a backfill is already running.
   */
  async startIgdbBackfill(): Promise<{ started: boolean; total: number }> {
    if (!this.igdb.isConfigured()) {
      throw new Error('IGDB is not configured (missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET).');
    }
    if (this.igdbBackfillState.running) {
      return { started: false, total: this.igdbBackfillState.total };
    }

    const total = await this.games.count();
    this.igdbBackfillState = {
      running: true,
      total,
      processed: 0,
      updated: 0,
      skipped: 0,
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
    };

    // Fire-and-forget: never await this from the request handler.
    void this.runIgdbBackfill().catch((err) => {
      this.igdbBackfillState.lastError =
        err instanceof Error ? err.message : String(err);
      this.igdbBackfillState.running = false;
      this.igdbBackfillState.finishedAt = new Date();
      this.logger.error(`IGDB backfill failed: ${err}`);
    });

    return { started: true, total };
  }

  getIgdbBackfillStatus() {
    return { ...this.igdbBackfillState };
  }

  private async runIgdbBackfill(): Promise<void> {
    const BATCH_SIZE = 100;
    // ~4 req/s allowed by Twitch app credentials. 280ms keeps us well under.
    const THROTTLE_MS = 280;

    let offset = 0;
    while (true) {
      const batch = await this.games.find({
        order: { createdAt: 'ASC' },
        take: BATCH_SIZE,
        skip: offset,
        relations: { sources: true },
      });
      if (batch.length === 0) break;

      for (const game of batch) {
        try {
          const enriched = await this.enrichGameFromIgdb(game);
          if (enriched) this.igdbBackfillState.updated += 1;
          else this.igdbBackfillState.skipped += 1;
        } catch (err) {
          this.igdbBackfillState.skipped += 1;
          this.logger.warn(
            `IGDB backfill skipped "${game.name}": ${err instanceof Error ? err.message : err}`,
          );
        }
        this.igdbBackfillState.processed += 1;
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }

      offset += BATCH_SIZE;
    }

    this.igdbBackfillState.running = false;
    this.igdbBackfillState.finishedAt = new Date();
    this.logger.log(
      `IGDB backfill done: ${this.igdbBackfillState.updated}/${this.igdbBackfillState.processed} updated.`,
    );
  }

  /**
   * Resolve a single game on IGDB (preferring a Steam app-id lookup when
   * available, falling back to a name match) and merge in any new
   * information. Returns true when at least one field was updated, false
   * when IGDB had nothing actionable or the game was already in sync.
   */
  private async enrichGameFromIgdb(game: Game): Promise<boolean> {
    const steamSource = game.sources?.find(
      (s) => s.source === SourceType.STEAM,
    );
    const steamAppId = steamSource
      ? Number(steamSource.externalId) || null
      : null;

    // Try the precise Steam-app-id pivot first when available, falling back to
    // a name match when IGDB hasn't indexed the external_game for that title
    // (still very common for older Source / Steam-classic games).
    let lookup = steamAppId
      ? await this.igdb.findBySteamAppId(steamAppId)
      : null;
    if (!lookup) lookup = await this.igdb.findByName(game.name);
    if (!lookup) return false;

    let changed = false;
    if (game.igdbId == null) {
      game.igdbId = lookup.igdbId;
      changed = true;
    }
    if (lookup.platforms.length > 0) {
      const same =
        game.platforms.length === lookup.platforms.length &&
        game.platforms.every((p) => lookup.platforms.includes(p));
      if (!same) {
        game.platforms = lookup.platforms;
        changed = true;
      }
    }
    if (!game.coverUrl && lookup.coverUrl) {
      game.coverUrl = lookup.coverUrl;
      changed = true;
    }
    if (!game.summary && lookup.summary) {
      game.summary = lookup.summary;
      changed = true;
    }
    if (!game.releaseDate && lookup.releaseDate) {
      game.releaseDate = lookup.releaseDate;
      changed = true;
    }
    if (!game.developer && lookup.developer) {
      game.developer = lookup.developer;
      changed = true;
    }
    if (!game.publisher && lookup.publisher) {
      game.publisher = lookup.publisher;
      changed = true;
    }
    if ((!game.genres || game.genres.length === 0) && lookup.genres.length > 0) {
      game.genres = lookup.genres;
      changed = true;
    }

    if (changed) {
      await this.games.save(game);
      await this.publishers.resolveAndLink(game.id, game.publisher);
    }
    return changed;
  }

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
    if (candidate.releaseDate && candidate.releaseDate < DISCOVERY_RELEASE_FLOOR) {
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
      throw new NotFoundException(
        `No IGDB game found for slug "${slug}".`,
      );
    }

    const existing = await this.games.findOne({
      where: { igdbId: candidate.igdbId },
    });
    if (existing) {
      return {
        gameId: existing.id,
        name: existing.name,
        alreadyExisted: true,
        steamLinked: candidate.steamAppId != null,
      };
    }

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
      gameId = await this.ingestSteamApp(steamAppId);
    }
    if (!gameId) {
      await this.ingestIgdbGame(candidate);
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
  private async ingestIgdbGame(candidate: IgdbGame): Promise<void> {
    const game = await this.upsertGameFromIgdb(candidate);
    await this.scrapeStoreRatings(game.id, game.name);
    await this.gamesService.rebuildEstimateHistory(game.id);
  }

  private async upsertGameFromIgdb(candidate: IgdbGame): Promise<Game> {
    const existing = await this.games.findOne({
      where: { igdbId: candidate.igdbId },
    });
    if (existing) return existing;

    const game = await this.games.save(
      this.games.create({
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
      }),
    );
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
      this.logger.log(
        `Skipping free-to-play app ${appId} (${details.name}).`,
      );
      return null;
    }

    const game = await this.upsertGameFromSteam(appId, details);

    await this.pollSteamSignals(game.id, appId);

    await this.scrapeStoreRatings(game.id, game.name);

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
   * Have the LLM extract grounded sales figures from the game's Wikipedia
   * article: a dated worldwide total (stored as a GLOBAL record) plus any
   * per-platform figures the article states. Each carries the verbatim source
   * quote. Best-effort: failures are logged.
   */
  async scrapeWikipedia(gameId: string, name: string): Promise<void> {
    try {
      const sales = await this.wikipedia.getWorldwideSales(name);
      if (!sales) {
        this.logger.log(`[wikipedia] "${name}" — no usable figure extracted`);
        return;
      }

      const releaseDate = await this.getReleaseDate(gameId);

      // Only sweep the records we previously inserted from Wikipedia — never
      // the ones an admin has soft-deleted, which we keep as fingerprints.
      await this.salesRecords.delete({
        gameId,
        source: SalesSource.WIKIPEDIA,
        rejectedAt: IsNull(),
      });

      const rows = [];
      if (sales.global && this.isReportedAfterRelease(sales.global.reportedAt, releaseDate)) {
        rows.push(
          this.salesRecords.create({
            gameId,
            platform: Platform.GLOBAL,
            source: SalesSource.WIKIPEDIA,
            units: sales.global.units,
            confidence: ConfidenceLevel.MEDIUM,
            sourceUrl: sales.sourceUrl,
            note: sales.global.quote,
            reportedAt: sales.global.reportedAt,
            region: 'GLOBAL',
          }),
        );
      }
      for (const { platform, figure } of sales.perPlatform) {
        if (!this.isReportedAfterRelease(figure.reportedAt, releaseDate)) continue;
        rows.push(
          this.salesRecords.create({
            gameId,
            platform,
            source: SalesSource.WIKIPEDIA,
            units: figure.units,
            confidence: ConfidenceLevel.MEDIUM,
            sourceUrl: sales.sourceUrl,
            note: figure.quote,
            reportedAt: figure.reportedAt,
            region: 'GLOBAL',
          }),
        );
      }
      if (
        sales.engagement &&
        this.isReportedAfterRelease(sales.engagement.reportedAt, releaseDate)
      ) {
        rows.push(
          this.salesRecords.create({
            gameId,
            platform: Platform.GLOBAL,
            source: SalesSource.WIKIPEDIA,
            units: sales.engagement.units,
            confidence: ConfidenceLevel.LOW,
            sourceUrl: sales.sourceUrl,
            note: sales.engagement.quote,
            reportedAt: sales.engagement.reportedAt,
            region: 'GLOBAL',
            isEngagement: true,
          }),
        );
      }

      const accepted = await this.filterOutRejected(rows);
      if (accepted.length > 0) {
        await this.salesRecords.save(accepted);
        const globalLog = sales.global
          ? `global=${sales.global.units} (${sales.global.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : 'no global';
        const engagementLog = sales.engagement
          ? `, engagement=${sales.engagement.units} (${sales.engagement.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : '';
        this.logger.log(
          `[wikipedia] "${name}" — stored ${accepted.length} record(s) (${rows.length - accepted.length} rejected-fingerprint skip): ${globalLog}, ${sales.perPlatform.length} per-platform${engagementLog}`,
        );
      } else if (rows.length > 0) {
        this.logger.log(
          `[wikipedia] "${name}" — extracted ${rows.length} record(s) but all match an admin-rejected fingerprint, skipping`,
        );
      } else {
        this.logger.log(`[wikipedia] "${name}" — extraction returned but no record met date/grounding requirements`);
      }
    } catch (error) {
      this.logger.warn(`Wikipedia scrape failed for "${name}": ${error}`);
    }
  }

  /**
   * Look up console store rating counts, store them as signals, and turn each
   * into a per-platform sales estimate. Best-effort: failures are logged.
   */
  async scrapeStoreRatings(gameId: string, name: string): Promise<void> {
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
   * Poll every live Steam signal for this app and persist a snapshot per
   * metric. Called from both the initial Steam ingest (`ingestSteamApp`)
   * and the daily refresh (`refreshGame`) so all tracked games stay fresh
   * on the same cadence.
   *
   * Signals captured:
   *  - `STEAM_REVIEWS`: total review count (PC Boxleiter input).
   *  - `STEAM_CONCURRENT`: current concurrent player count at poll time
   *    (raw time series, useful for decay analysis).
   *  - `STEAM_PEAK_CCU`: running all-time max of `STEAM_CONCURRENT`. A new
   *    row is written only when the latest reading strictly exceeds the
   *    prior peak. Query the current peak with `order: { value: 'DESC' }`
   *    (NOT capturedAt) because the historical-import path persists peaks
   *    with the SteamCharts month as `capturedAt`.
   *
   * Best-effort: any individual signal that fails to fetch is silently
   * skipped — the value already on record stays in place.
   */
  private async pollSteamSignals(gameId: string, appId: number): Promise<void> {
    const reviews = await this.steam.getTotalReviews(appId);
    if (reviews !== null) {
      await this.signals.save(
        this.signals.create({
          gameId,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_REVIEWS,
          value: reviews,
        }),
      );
    }

    const current = await this.steam.getCurrentPlayerCount(appId);
    if (current === null) return;

    await this.signals.save(
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_CONCURRENT,
        value: current,
      }),
    );

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
   * Seed the `STEAM_PEAK_CCU` signal from SteamCharts' historical "All-
   * time peak" stat. Daily polling via `pollSteamSignals` only captures
   * peaks reached after we started tracking the game — for hits that
   * already spiked (Palworld in Jan 2024, Helldivers 2 in early 2024, …),
   * the live current-players value vastly understates the true peak.
   * This admin-triggered import closes that gap by pulling the all-time
   * peak from SteamCharts and persisting it as a `STEAM_PEAK_CCU` snapshot
   * if higher than what we already have.
   *
   * Returns the imported value (or `null` if no Steam source is linked or
   * SteamCharts had nothing to scrape) and whether a new snapshot was
   * written. The existing peak is never overwritten downwards.
   */
  async importSteamPeakCcuHistory(gameId: string): Promise<{
    appId: number | null;
    importedPeak: number | null;
    peakAt: string | null;
    priorPeak: number | null;
    persisted: boolean;
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
      this.logger.warn(
        `[ccu-history] "${game.name}" (${gameId}) — no Steam appId linked, skipping`,
      );
      return {
        appId: null,
        importedPeak: null,
        peakAt: null,
        priorPeak: null,
        persisted: false,
      };
    }

    const scraped = await this.steam.getAllTimePeakCcu(appId);
    const priorPeakRow = await this.signals.findOne({
      where: { gameId, metric: SignalMetric.STEAM_PEAK_CCU },
      order: { value: 'DESC' },
    });
    const priorPeak = priorPeakRow?.value ?? null;

    if (scraped === null) {
      this.logger.warn(
        `[ccu-history] "${game.name}" (appId=${appId}) — SteamCharts returned no peak`,
      );
      return {
        appId,
        importedPeak: null,
        peakAt: null,
        priorPeak,
        persisted: false,
      };
    }

    const { peak: imported, peakAt } = scraped;

    if (priorPeak !== null && imported <= priorPeak) {
      this.logger.log(
        `[ccu-history] "${game.name}" (appId=${appId}) — SteamCharts peak ` +
          `${imported.toLocaleString()} <= existing ${priorPeak.toLocaleString()}, no-op`,
      );
      return {
        appId,
        importedPeak: imported,
        peakAt: peakAt?.toISOString() ?? null,
        priorPeak,
        persisted: false,
      };
    }

    // Setting capturedAt to the historical peak month (when available)
    // means the imported snapshot reflects WHEN the peak actually
    // happened, so the historical rebuild path (`computeAndStoreAt`)
    // correctly applies the CCU intersection only from that date onward.
    // Without a known month, we fall back to "now" via the entity's
    // default @CreateDateColumn.
    await this.signals.save(
      this.signals.create({
        gameId,
        source: SourceType.STEAM,
        metric: SignalMetric.STEAM_PEAK_CCU,
        value: imported,
        ...(peakAt ? { capturedAt: peakAt } : {}),
      }),
    );
    this.logger.log(
      `[ccu-history] "${game.name}" (appId=${appId}) — imported peak ` +
        `${imported.toLocaleString()} at ${peakAt?.toISOString() ?? 'unknown date'} ` +
        `(prior ${priorPeak?.toLocaleString() ?? 'n/a'})`,
    );
    return {
      appId,
      importedPeak: imported,
      peakAt: peakAt?.toISOString() ?? null,
      priorPeak,
      persisted: true,
    };
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
      ];

      const results = await this.runBacklogSearch(engine, name, queries);
      if (results.length === 0) {
        return { checked, ingested, records };
      }

      for (const result of results) {
        if (await this.processedArticles.findOne({ where: { url: result.url } })) {
          this.logger.debug(`[backlog] "${name}" — skip (already processed): ${result.url}`);
          continue;
        }
        checked += 1;

        const pubDate = result.publishedDate ? new Date(result.publishedDate) : null;
        this.logger.log(
          `[backlog] "${name}" — extracting (pubDate=${result.publishedDate ?? 'unknown'}): ${result.url}`,
        );
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
          this.logger.log(`[backlog] "${name}" — ${stored} record(s) from ${result.url}`);
        } else {
          this.logger.log(`[backlog] "${name}" — no figure extracted from ${result.url}`);
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

    return [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);
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
    const confidence = this.confidenceFromWeight(trusted?.weight ?? 40);

    let sales =
      text && text.length >= 200
        ? await this.article.extractFromText(text, url, gameName, { fallbackDate })
        : null;
    if (!sales) sales = await this.article.extract(url, gameName);
    if (!sales) return 0;

    return this.storeArticleSales(gameId, url, tier, confidence, sales);
  }

  /**
   * Manually record a sales figure (e.g. from an official report or a press
   * announcement) until automated discovery covers those sources.
   */
  async addSalesRecord(input: ManualSalesInput): Promise<SalesRecord> {
    return this.salesRecords.save(
      this.salesRecords.create({
        gameId: input.gameId,
        platform: input.platform,
        source: input.source,
        units: input.units,
        publisher: input.publisher ?? null,
        sourceUrl: input.sourceUrl ?? null,
        region: input.region ?? 'GLOBAL',
        reportedAt: input.reportedAt ? new Date(input.reportedAt) : null,
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

    this.logger.log(`[refresh] "${game.name}" — store ratings (PS/Xbox/Switch)…`);
    await this.scrapeStoreRatings(game.id, game.name);

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
      Number.isFinite(steamAppId)
        ? this.pollSteamSignals(game.id, steamAppId)
        : Promise.resolve(),
    ]);

    this.logger.log(`[refresh] "${game.name}" — running backlog discovery…`);
    const backlog = await this.discoverBacklog(game.id, game.name);
    this.logger.log(
      `[refresh] "${game.name}" — backlog checked=${backlog.checked} ingested=${backlog.ingested} records=${backlog.records}`,
    );

    // Single canonical recompute path: rebuild the full estimate
    // history with the (possibly just-updated) multipliers. This
    // automatically includes the capture moment we wrote a few lines
    // above (deduplicated by minute) and re-evaluates discrepancies at
    // the end, so a declared figure that lands 4 weeks after release
    // propagates back through the entire chart.
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

    return { found: true, articlesIngested: totalIngested };
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
    // know the article produced at least one accepted sales record.
    const trusted = await this.sources.findByUrl(url);
    const tier = trusted?.salesSource ?? SalesSource.MEDIA;
    const confidence = this.confidenceFromWeight(trusted?.weight ?? 40);

    const sales = await this.article.extract(url, game.name);
    if (!sales) {
      return { matchedSource: trusted?.name ?? null, tier, recordsStored: 0 };
    }

    const recordsStored = await this.storeArticleSales(
      gameId,
      url,
      tier,
      confidence,
      sales,
    );
    return { matchedSource: trusted?.name ?? null, tier, recordsStored };
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
        if (await this.processedArticles.findOne({ where: { url: item.url } })) {
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
    item: { title: string; url: string; contentHtml: string; publishedAt?: Date | null },
    source: TrustedSource,
  ): Promise<{ gameId: string | null; records: number }> {
    const game = await this.gamesService.matchByTitle(item.title);
    if (!game) return { gameId: null, records: 0 };

    const fallbackDate = item.publishedAt ?? null;
    const text = item.contentHtml ? this.article.htmlToText(item.contentHtml) : '';
    let sales =
      text.length >= 200
        ? await this.article.extractFromText(text, item.url, game.name, { fallbackDate })
        : null;
    // Feeds that only carry a short summary: fall back to fetching the page.
    if (!sales) sales = await this.article.extract(item.url, game.name);
    if (!sales) return { gameId: game.id, records: 0 };

    const records = await this.storeArticleSales(
      game.id,
      item.url,
      source.salesSource,
      this.confidenceFromWeight(source.weight),
      sales,
    );
    return { gameId: game.id, records };
  }

  // Replace a game's records for one source URL with the freshly extracted
  // figures (a worldwide total as GLOBAL plus any per-platform figures).
  // Records dated before the game's release date are dropped (they are
  // almost always referring to an earlier title in the same series).
  private async storeArticleSales(
    gameId: string,
    url: string,
    tier: SalesSource,
    confidence: ConfidenceLevel,
    sales: ArticleSales,
  ): Promise<number> {
    // Preserve admin-rejected fingerprints: a rejected record stays in place
    // so the fingerprint guard below can skip the matching re-extract.
    await this.salesRecords.delete({
      gameId,
      sourceUrl: url,
      rejectedAt: IsNull(),
    });

    const releaseDate = await this.getReleaseDate(gameId);

    const rows: SalesRecord[] = [];
    if (sales.global && this.isReportedAfterRelease(sales.global.reportedAt, releaseDate)) {
      rows.push(
        this.salesRecords.create({
          gameId,
          platform: Platform.GLOBAL,
          source: tier,
          units: sales.global.units,
          confidence,
          publisher: sales.attribution,
          sourceUrl: url,
          note: sales.global.quote,
          reportedAt: sales.global.reportedAt,
          region: 'GLOBAL',
        }),
      );
    }
    for (const { platform, figure } of sales.perPlatform) {
      if (!this.isReportedAfterRelease(figure.reportedAt, releaseDate)) continue;
      rows.push(
        this.salesRecords.create({
          gameId,
          platform,
          source: tier,
          units: figure.units,
          confidence,
          publisher: sales.attribution,
          sourceUrl: url,
          note: figure.quote,
          reportedAt: figure.reportedAt,
          region: 'GLOBAL',
        }),
      );
    }
    if (
      sales.engagement &&
      this.isReportedAfterRelease(sales.engagement.reportedAt, releaseDate)
    ) {
      rows.push(
        this.salesRecords.create({
          gameId,
          platform: Platform.GLOBAL,
          source: tier,
          units: sales.engagement.units,
          // Engagement is always low-confidence regardless of the source tier:
          // even publisher-reported "X million players" mixes subscription
          // users (Ubisoft+, Game Pass) with purchased copies.
          confidence: ConfidenceLevel.LOW,
          publisher: sales.attribution,
          sourceUrl: url,
          note: sales.engagement.quote,
          reportedAt: sales.engagement.reportedAt,
          region: 'GLOBAL',
          isEngagement: true,
        }),
      );
    }

    const accepted = await this.filterOutRejected(rows);
    if (accepted.length > 0) {
      await this.salesRecords.save(accepted);
      // The article actually produced usable record(s) — register the
      // hostname in the trusted-source registry if it isn't already. This is
      // the *only* path through which the registry auto-grows: hosts that
      // never yield an accepted figure never make it in.
      await this.sources.ensureForUrl(url);
    }
    const skipped = rows.length - accepted.length;
    if (skipped > 0) {
      this.logger.log(
        `[article] ${url} — ${skipped} record(s) match an admin-rejected fingerprint, skipping reinsert`,
      );
    }
    return accepted.length;
  }

  /**
   * Drop the candidate rows whose strict fingerprint matches an existing
   * admin-rejected sales record (so a refresh can never resurrect a record
   * the admin manually deleted). Fingerprint:
   *   (gameId, platform, source, sourceUrl, units, reportedAt).
   * `null` values are compared as equal (both null = same fingerprint).
   */
  private async filterOutRejected(
    rows: SalesRecord[],
  ): Promise<SalesRecord[]> {
    if (rows.length === 0) return rows;
    const gameIds = [...new Set(rows.map((r) => r.gameId))];
    const rejected = await this.salesRecords.find({
      where: { gameId: In(gameIds), rejectedAt: Not(IsNull()) },
      select: {
        gameId: true,
        platform: true,
        source: true,
        sourceUrl: true,
        units: true,
        reportedAt: true,
      },
    });
    if (rejected.length === 0) return rows;
    const fingerprint = (r: {
      gameId: string;
      platform: Platform;
      source: SalesSource;
      sourceUrl: string | null;
      units: number;
      reportedAt: Date | null;
    }): string =>
      [
        r.gameId,
        r.platform,
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

  private confidenceFromWeight(weight: number): ConfidenceLevel {
    if (weight >= 85) return ConfidenceLevel.HIGH;
    if (weight >= 60) return ConfidenceLevel.MEDIUM;
    return ConfidenceLevel.LOW;
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
      });

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
        const saved = await this.games.save(
          this.games.create({
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
          }),
        );
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
  ): Promise<Game> {
    const existingSource = await this.gameSources.findOne({
      where: {
        source: SourceType.STEAM,
        externalId: String(appId),
      },
      relations: { game: true },
    });

    // IGDB enrichment: best-effort lookup that gives us the real platforms
    // list (Steam ingestion alone can't tell us if a title also ships on
    // PS/Xbox/Switch), the IGDB pivot id, and fallback metadata when the
    // Steam payload is missing publisher / developer / cover.
    const igdb = await this.igdb.findBySteamAppId(appId);

    if (existingSource) {
      const game = existingSource.game;
      game.releaseDate = details.releaseDate ?? game.releaseDate;
      game.coverUrl =
        details.headerImage ?? igdb?.coverUrl ?? game.coverUrl;
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
      if (igdb) {
        if (game.igdbId == null) game.igdbId = igdb.igdbId;
        if (igdb.platforms.length > 0) game.platforms = igdb.platforms;
      }
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
      });
      if (existingByIgdb) {
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
        const saved = await this.games.save(existingByIgdb);
        await this.publishers.resolveAndLink(saved.id, saved.publisher);
        return saved;
      }
    }

    const platforms =
      igdb && igdb.platforms.length > 0 ? igdb.platforms : [Platform.PC];

    const game = await this.games.save(
      this.games.create({
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
      }),
    );

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
    while (await this.games.findOne({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
}

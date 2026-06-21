import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
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
import { DiscoveryClient } from './discovery.client';
import { RssClient } from './rss.client';
import { TavilyClient } from './tavily.client';
import { SourcesService } from '../sources/sources.service';
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
  'vgchartz.com',
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
    private readonly estimation: EstimationService,
    private readonly gamesService: GamesService,
    private readonly steam: SteamClient,
    private readonly igdb: IgdbClient,
    private readonly storeRatings: StoreRatingsClient,
    private readonly wikipedia: WikipediaClient,
    private readonly article: ArticleClient,
    private readonly discovery: DiscoveryClient,
    private readonly rss: RssClient,
    private readonly tavily: TavilyClient,
    private readonly sources: SourcesService,
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
      await new Promise((r) => setTimeout(r, 300));
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
   * Create a console-only game from IGDB data (no Steam source), seed its
   * console store ratings as signals, and compute an initial estimate.
   */
  private async ingestIgdbGame(candidate: IgdbGame): Promise<void> {
    const game = await this.upsertGameFromIgdb(candidate);
    await this.scrapeStoreRatings(game.id, game.name);
    await this.estimation.computeAndStore(game.id);
  }

  private async upsertGameFromIgdb(candidate: IgdbGame): Promise<Game> {
    const existing = await this.games.findOne({
      where: { igdbId: candidate.igdbId },
    });
    if (existing) return existing;

    return this.games.save(
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
  }

  /**
   * Ingest a single Steam app: upsert the game, capture fresh signals
   * (reviews + estimated owners), recompute the PC sales estimate, and pull
   * multi-platform figures from console stores and Wikipedia.
   *
   * Options:
   *   skipStoreRatings — skip PS/Xbox store scraping (default false)
   *   skipWikipedia    — skip Wikipedia LLM extraction (default false).
   *                      Set true in automated crons to avoid per-game LLM
   *                      costs; Wikipedia is then fetched on-demand via
   *                      refreshGame (the "Search trusted sources" button).
   */
  async ingestSteamApp(
    appId: number,
    options: { skipStoreRatings?: boolean; skipWikipedia?: boolean } = {},
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

    const reviews = await this.steam.getTotalReviews(appId);
    if (reviews !== null) {
      await this.signals.save(
        this.signals.create({
          gameId: game.id,
          source: SourceType.STEAM,
          metric: SignalMetric.STEAM_REVIEWS,
          value: reviews,
        }),
      );
    }

    if (!options.skipStoreRatings) {
      await this.scrapeStoreRatings(game.id, game.name);
    }
    if (!options.skipWikipedia) {
      await this.scrapeWikipedia(game.id, game.name);
    }

    // Compute the PC estimate last so calibration can use any declared figure
    // pulled by the enrichment steps above.
    await this.estimation.computeAndStore(game.id);

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

      await this.salesRecords.delete({
        gameId,
        source: SalesSource.WIKIPEDIA,
      });

      const rows = [];
      if (sales.global) {
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

      if (rows.length > 0) {
        await this.salesRecords.save(rows);
        const globalLog = sales.global
          ? `global=${sales.global.units} (${sales.global.reportedAt?.toISOString().slice(0, 10) ?? 'no-date'})`
          : 'no global';
        this.logger.log(
          `[wikipedia] "${name}" — stored ${rows.length} record(s): ${globalLog}, ${sales.perPlatform.length} per-platform`,
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
   * Fetch all external URLs cited in this game's Wikipedia article and ingest
   * any that are hosted on a trusted source. Wikipedia references are the
   * primary backlog solution: they contain exactly the press/IR articles that
   * originally reported the sales figures cited on Wikipedia, including old
   * announcements no longer in any RSS window. Best-effort.
   */
  async mineBibliographyByGameId(
    gameId: string,
  ): Promise<{ found: boolean; checked?: number; ingested?: number; records?: number }> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return { found: false };
    const result = await this.mineBibliography(gameId, game.name);
    return { found: true, ...result };
  }

  async mineBibliography(
    gameId: string,
    name: string,
  ): Promise<{ checked: number; ingested: number; records: number }> {
    let checked = 0;
    let ingested = 0;
    let records = 0;
    try {
      const urls = await this.wikipedia.getReferencedUrls(name);
      this.logger.log(
        `[bibliography] "${name}" — Wikipedia references: ${urls.length} URL(s)`,
      );
      const trustedUrls: string[] = [];
      for (const url of urls) {
        const source = await this.sources.findByUrl(url);
        if (!source) continue;
        trustedUrls.push(url);
      }
      this.logger.log(
        `[bibliography] "${name}" — ${trustedUrls.length} URL(s) on trusted hosts`,
      );

      for (const url of trustedUrls) {
        checked += 1;
        // Skip already-processed URLs to avoid redundant LLM calls.
        if (await this.processedArticles.findOne({ where: { url } })) {
          this.logger.debug(`[bibliography] "${name}" — skip (already processed): ${url}`);
          continue;
        }
        this.logger.log(`[bibliography] "${name}" — extracting: ${url}`);
        const result = await this.ingestArticle(url, gameId);
        const stored = result?.recordsStored ?? 0;
        await this.processedArticles.save(
          this.processedArticles.create({
            url,
            matchedGameId: gameId,
            hadFigure: stored > 0,
          }),
        );
        if (stored > 0) {
          ingested += 1;
          records += stored;
          this.logger.log(`[bibliography] "${name}" — ${stored} record(s) from ${url}`);
        } else {
          this.logger.log(`[bibliography] "${name}" — no figure extracted from ${url}`);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (error) {
      this.logger.warn(`Bibliography mining failed for "${name}": ${error}`);
    }
    return { checked, ingested, records };
  }

  /**
   * Search the web for press articles about this game restricted to the
   * trusted-source registry's hosts, then run the grounded LLM extraction on
   * each discovered URL. Best-effort: each step logs and continues.
   */
  async discoverArticles(
    gameId: string,
    name: string,
  ): Promise<{ ingested: number; records: number }> {
    let ingested = 0;
    let records = 0;
    try {
      const sources = await this.sources.searchableSources();
      if (sources.length === 0) {
        this.logger.log(`[trusted-search] "${name}" — no searchable sources configured`);
        return { ingested, records };
      }

      const urls = await this.discovery.findArticles(name, sources);
      this.logger.log(
        `[trusted-search] "${name}" — searched ${sources.length} source(s), found ${urls.length} candidate URL(s)`,
      );
      for (const url of urls) {
        this.logger.log(`[trusted-search] "${name}" — extracting: ${url}`);
        const result = await this.ingestArticle(url, gameId);
        if (result && result.recordsStored > 0) {
          ingested += 1;
          records += result.recordsStored;
          this.logger.log(
            `[trusted-search] "${name}" — ${result.recordsStored} record(s) from ${url}`,
          );
        } else {
          this.logger.log(`[trusted-search] "${name}" — no figure extracted from ${url}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Article discovery failed for "${name}": ${error}`);
    }
    return { ingested, records };
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
   * Backlog discovery via Tavily web search: find sales articles (typically
   * older coverage that predates our RSS polling), then run the same grounded
   * LLM extraction on each result's page text. The host is matched against the
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
    if (!this.tavily.enabled) {
      this.logger.log(`[backlog] "${name}" — Tavily disabled (TAVILY_API_KEY missing)`);
      return { checked, ingested, records };
    }

    try {
      const query = `${name} total copies sold sales figures`;
      this.logger.log(`[backlog] "${name}" — Tavily query: "${query}"`);
      const results = await this.tavily.search(query, {
        maxResults: 8,
        excludeDomains: TAVILY_EXCLUDED_DOMAINS,
      });
      this.logger.log(
        `[backlog] "${name}" — Tavily returned ${results.length} result(s)`,
      );

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
      `[refresh] "${game.name}" — running 3 discovery channels in parallel (trusted-search, Wikipedia bibliography, Tavily backlog)…`,
    );
    const [discovery, bib, backlog] = await Promise.all([
      this.discoverArticles(game.id, game.name),
      this.mineBibliography(game.id, game.name),
      this.discoverBacklog(game.id, game.name),
    ]);

    this.logger.log(
      `[refresh] "${game.name}" — channel results: trusted-search ingested=${discovery.ingested} records=${discovery.records}; bibliography checked=${bib.checked} ingested=${bib.ingested} records=${bib.records}; backlog checked=${backlog.checked} ingested=${backlog.ingested} records=${backlog.records}`,
    );

    // Recompute the PC estimate so a freshly scraped declared figure
    // recalibrates the multiplier.
    this.logger.log(`[refresh] "${game.name}" — recomputing estimates…`);
    await this.estimation.computeAndStore(game.id);

    const totalIngested = discovery.ingested + bib.ingested + backlog.ingested;
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
  private async storeArticleSales(
    gameId: string,
    url: string,
    tier: SalesSource,
    confidence: ConfidenceLevel,
    sales: ArticleSales,
  ): Promise<number> {
    await this.salesRecords.delete({ gameId, sourceUrl: url });

    const rows: SalesRecord[] = [];
    if (sales.global) {
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

    if (rows.length > 0) await this.salesRecords.save(rows);
    return rows.length;
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
        await this.games.save(existing);
      } else {
        await this.games.save(
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
      return this.games.save(game);
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
        return this.games.save(existingByIgdb);
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

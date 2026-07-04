import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { isDueForRefresh } from './refresh-interval';

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    private readonly ingestion: IngestionService,
  ) {}

  /**
   * Periodic full refresh of tracked games. Runs the same end-to-end chain as
   * the admin "Refresh data" button (Steam details + reviews, Wikipedia LLM
   * extraction, store ratings, trusted-search / Tavily backlog
   * discovery, and estimation). Each game has its own cadence based on its
   * release date (newer titles refreshed more often; games older than 5 years
   * still refresh every 180 days rather than stopping); games with no known
   * release date are skipped entirely. The cron may not finish all eligible
   * games in a single run — leftovers will be picked up by the next nightly
   * execution.
   *
   * Covers every tracked game (PC + console-only) and excludes free-to-play
   * titles, for which we don't compute sales estimates.
   */
  async refreshAllGames() {
    // Wall-clock cap per invocation, with headroom under the 800s Vercel
    // `maxDuration` so the in-flight game can finish (and stamp
    // `lastRefreshedAt`) before the function is killed mid-run.
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    const startedAt = Date.now();

    // Stalest first: never-refreshed games (`lastRefreshedAt IS NULL`) sort
    // ahead of everything else. Combined with the always-on stamp in
    // `refreshGame`, this guarantees forward progress — the large backlog of
    // never-refreshed (often old) titles drains before we re-refresh recent
    // ones, instead of starving at the tail of an unordered scan.
    const games = await this.games.find({
      where: { isFree: false },
      order: { lastRefreshedAt: { direction: 'ASC', nulls: 'FIRST' } },
    });

    const now = new Date();
    const eligible = games.filter((game) =>
      isDueForRefresh(game.releaseDate, game.lastRefreshedAt, now),
    );

    this.logger.log(
      `Refreshing up to ${eligible.length} due game(s) of ${games.length} ` +
        `(stalest first), budget ${RUN_BUDGET_MS / 1000}s.`,
    );

    let processed = 0;
    for (const game of eligible) {
      if (Date.now() - startedAt >= RUN_BUDGET_MS) {
        this.logger.log(
          `Run budget reached after ${processed} game(s); ` +
            `${eligible.length - processed} left for the next run.`,
        );
        break;
      }
      try {
        await this.ingestion.refreshGame(game.id);
      } catch (error) {
        this.logger.warn(`Refresh failed for game ${game.id}: ${error}`);
      }
      processed += 1;
    }

    this.logger.log(`Refresh complete: ${processed} game(s) processed.`);
  }

  /**
   * Poll live Steam concurrent players for every tracked Steam game on a
   * short cadence (every 30 minutes) so intra-day peaks are captured. This is
   * intentionally separate from the nightly full refresh, which no longer
   * fetches CCU.
   */
  async refreshAllCcu() {
    try {
      const result = await this.ingestion.pollAllSteamCcu();
      this.logger.log(
        `CCU poll done: ${result.polled} polled, ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.warn(`CCU poll failed: ${error}`);
    }
  }

  /**
   * Capture a daily Steam price point for every tracked Steam game so price
   * changes (sales, permanent drops) accumulate into a time series.
   */
  async captureSteamPrices() {
    try {
      const result = await this.ingestion.captureAllSteamPrices();
      this.logger.log(
        `Price capture done: ${result.captured} captured, ${result.skipped} skipped, ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.warn(`Price capture failed: ${error}`);
    }
  }

  /**
   * Continuously monitor trusted-source RSS feeds: every 30 minutes, ingest
   * any new article that mentions a tracked game and reports a sales figure.
   */
  async pollTrustedFeeds() {
    try {
      await this.ingestion.pollFeeds();
    } catch (error) {
      this.logger.warn(`Feed poll failed: ${error}`);
    }
  }

  /**
   * Weekly refresh of Steam followers + top-seller rank from
   * games-popularity.com. Recent-window only (the multi-year history is seeded
   * once by the backfill script); a wall-clock budget keeps the run under the
   * Vercel `maxDuration`, and stalest-first ordering drains any leftover on the
   * next weekly run.
   */
  async captureGamesPopularity() {
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    try {
      const result = await this.ingestion.syncAllGamesPopularity({
        fullHistory: false,
        budgetMs: RUN_BUDGET_MS,
      });
      this.logger.log(
        `Games-popularity capture done: ${result.processed} game(s), ` +
          `${result.followers} followers, ${result.ranks} ranks, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Games-popularity capture failed: ${error}`);
    }
  }

  /**
   * Nightly catalog discovery via IGDB (popularity-ranked + fresh releases,
   * admitted by IGDB rating or live Steam reviews). Runs at 2 AM, ahead of the
   * 3 AM per-app refresh.
   */
  async discoverNewGames() {
    try {
      const result = await this.ingestion.discoverIgdbGames();
      this.logger.log(
        `IGDB discovery done: ${result.discovered} found, ${result.ingested} ingested, ${result.skipped} skipped.`,
      );
    } catch (error) {
      this.logger.warn(`IGDB discovery failed: ${error}`);
    }
  }
}

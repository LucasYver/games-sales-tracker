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
   * release date (newer titles refreshed more often); games older than 5 years
   * are skipped entirely. The cron may not finish all eligible games in a
   * single run — leftovers will be picked up by the next nightly execution.
   *
   * Covers every tracked game (PC + console-only) and excludes free-to-play
   * titles, for which we don't compute sales estimates.
   */
  async refreshAllGames() {
    const games = await this.games.find({ where: { isFree: false } });

    const now = new Date();
    const eligible = games.filter((game) =>
      isDueForRefresh(game.releaseDate, game.lastRefreshedAt, now),
    );

    this.logger.log(
      `Refreshing ${eligible.length} of ${games.length} game(s) (others not yet due).`,
    );

    for (const game of eligible) {
      try {
        await this.ingestion.refreshGame(game.id);
      } catch (error) {
        this.logger.warn(`Refresh failed for game ${game.id}: ${error}`);
      }
    }

    this.logger.log('Refresh complete.');
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

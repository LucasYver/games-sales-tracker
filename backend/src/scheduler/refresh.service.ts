import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game, GameSource, SourceType } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { getRefreshIntervalDays, isDueForRefresh } from './refresh-interval';

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    @InjectRepository(GameSource)
    private readonly gameSources: Repository<GameSource>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    private readonly ingestion: IngestionService,
  ) {}

  /**
   * Periodic refresh of tracked Steam apps. Each game has its own cadence
   * based on its release date (newer titles refreshed more often). Games
   * older than 5 years are skipped entirely. Wikipedia LLM extraction is
   * intentionally skipped here to keep per-game cost low.
   */
  async refreshAllSteamApps() {
    const sources = await this.gameSources.find({
      where: { source: SourceType.STEAM },
      relations: { game: true },
    });

    const now = new Date();
    const eligible = sources.filter((source) =>
      isDueForRefresh(source.game?.releaseDate, source.game?.lastRefreshedAt, now),
    );

    this.logger.log(
      `Refreshing ${eligible.length} of ${sources.length} Steam app(s) (others not yet due).`,
    );

    for (const source of eligible) {
      const appId = Number(source.externalId);
      if (Number.isNaN(appId)) continue;
      try {
        await this.ingestion.ingestSteamApp(appId);
        await this.games.update(source.gameId, { lastRefreshedAt: new Date() });
      } catch (error) {
        this.logger.warn(`Refresh failed for app ${appId}: ${error}`);
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

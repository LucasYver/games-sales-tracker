import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameSource, SourceType } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    @InjectRepository(GameSource)
    private readonly gameSources: Repository<GameSource>,
    private readonly ingestion: IngestionService,
  ) {}

  /**
   * Daily refresh of every tracked Steam app so that signal snapshots build
   * up a time series and estimates stay current. Wikipedia LLM extraction is
   * intentionally skipped here — it is triggered on-demand via the
   * "Search trusted sources" button (refreshGame) to avoid per-game LLM costs
   * on every nightly cycle.
   */
  async refreshAllSteamApps() {
    const sources = await this.gameSources.find({
      where: { source: SourceType.STEAM },
    });

    this.logger.log(`Refreshing ${sources.length} Steam app(s)...`);

    for (const source of sources) {
      const appId = Number(source.externalId);
      if (Number.isNaN(appId)) continue;
      try {
        await this.ingestion.ingestSteamApp(appId, { skipWikipedia: true });
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

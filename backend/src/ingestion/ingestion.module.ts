import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Game,
  GameSource,
  ProcessedArticle,
  SalesRecord,
  SignalSnapshot,
} from '../entities';
import { EstimationModule } from '../estimation/estimation.module';
import { GamesModule } from '../games/games.module';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { SteamClient } from './steam.client';
import { IgdbClient } from './igdb.client';
import { StoreRatingsClient } from './store-ratings.client';
import { WikipediaClient } from './wikipedia.client';
import { ArticleClient } from './article.client';
import { DiscoveryClient } from './discovery.client';
import { RssClient } from './rss.client';
import { TavilyClient } from './tavily.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameSource,
      SignalSnapshot,
      SalesRecord,
      ProcessedArticle,
    ]),
    EstimationModule,
    GamesModule,
    LlmModule,
    SourcesModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    SteamClient,
    IgdbClient,
    StoreRatingsClient,
    WikipediaClient,
    ArticleClient,
    DiscoveryClient,
    RssClient,
    TavilyClient,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}

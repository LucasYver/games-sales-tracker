import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  Game,
  GameSource,
  Milestone,
  PriceSnapshot,
  ProcessedArticle,
  SignalSnapshot,
} from '../entities';
import { EstimationModule } from '../estimation/estimation.module';
import { GamesModule } from '../games/games.module';
import { GenresModule } from '../genres/genres.module';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { PublishersModule } from '../publishers/publishers.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { SteamClient } from './steam.client';
import { IgdbClient } from './igdb.client';
import { StoreRatingsClient } from './store-ratings.client';
import { WikipediaClient } from './wikipedia.client';
import { ArticleClient } from './article.client';
import { RssClient } from './rss.client';
import { TavilyClient } from './tavily.client';
import { PerplexityClient } from './perplexity.client';
import { ExophaseClient } from './exophase.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameSource,
      SignalSnapshot,
      PriceSnapshot,
      Milestone,
      ProcessedArticle,
      AchievementSnapshot,
    ]),
    EstimationModule,
    GamesModule,
    GenresModule,
    LlmModule,
    SourcesModule,
    PublishersModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    SteamClient,
    IgdbClient,
    StoreRatingsClient,
    WikipediaClient,
    ArticleClient,
    RssClient,
    TavilyClient,
    PerplexityClient,
    ExophaseClient,
  ],
  exports: [IngestionService, IgdbClient],
})
export class IngestionModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  Game,
  GameIngestionState,
  GamePlatformReleaseDate,
  GameEdition,
  GameSource,
  Milestone,
  PriceSnapshot,
  ProcessedArticle,
  ProviderCooldown,
  SignalSnapshot,
} from '../entities';
import { EstimationModule } from '../estimation/estimation.module';
import { GamesModule } from '../games/games.module';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { PublishersModule } from '../publishers/publishers.module';
import { DevelopersModule } from '../developers/developers.module';
import { IngestionService } from './ingestion.service';
import { SteamClient } from './steam.client';
import { SteamChartsClient } from './steamcharts.client';
import { IgdbClient } from './igdb.client';
import { StoreRatingsClient } from './store-ratings.client';
import { XboxCatalogClient } from './xbox-catalog.client';
import { PlaystationCatalogClient } from './playstation-catalog.client';
import { WikipediaClient } from './wikipedia.client';
import { ArticleClient } from './article.client';
import { TavilyClient } from './tavily.client';
import { PerplexityClient } from './perplexity.client';
import { ExophaseClient } from './exophase.client';
import { GamesPopularityClient } from './games-popularity.client';
import { TwitchClient } from './twitch.client';
import { IngestionStateService } from './ingestion-state.service';
import { IgdbRefreshService } from './igdb-refresh.service';
import { InstantGamingLinksService } from './instant-gaming-links.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameIngestionState,
      GameSource,
      SignalSnapshot,
      PriceSnapshot,
      Milestone,
      ProcessedArticle,
      AchievementSnapshot,
      GamePlatformReleaseDate,
      GameEdition,
      ProviderCooldown,
    ]),
    EstimationModule,
    GamesModule,
    LlmModule,
    SourcesModule,
    PublishersModule,
    DevelopersModule,
  ],
  providers: [
    IngestionService,
    SteamClient,
    SteamChartsClient,
    IgdbClient,
    StoreRatingsClient,
    XboxCatalogClient,
    PlaystationCatalogClient,
    WikipediaClient,
    ArticleClient,
    TavilyClient,
    PerplexityClient,
    ExophaseClient,
    GamesPopularityClient,
    TwitchClient,
    IngestionStateService,
    IgdbRefreshService,
    InstantGamingLinksService,
  ],
  exports: [
    IngestionService,
    IgdbClient,
    IngestionStateService,
    SteamClient,
    IgdbRefreshService,
    InstantGamingLinksService,
  ],
})
export class IngestionModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimateSnapshot,
  EstimationDiscrepancy,
  Game,
  GameRank,
  GameSource,
  Milestone,
  PriceSnapshot,
  ProcessedArticle,
  SalesEstimate,
  SignalSnapshot,
  TrustedSource,
} from '../entities';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MilestoneConsistencyService } from './milestone-consistency.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { GamesModule } from '../games/games.module';
import { PublishersModule } from '../publishers/publishers.module';
import { GenresModule } from '../genres/genres.module';
import { EstimationModule } from '../estimation/estimation.module';
import { ReferenceProfilesModule } from '../reference-profiles/reference-profiles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameRank,
      GameSource,
      SignalSnapshot,
      PriceSnapshot,
      SalesEstimate,
      Milestone,
      TrustedSource,
      ProcessedArticle,
      AchievementSnapshot,
      EstimateSnapshot,
      EstimationDiscrepancy,
    ]),
    IngestionModule,
    GamesModule,
    PublishersModule,
    GenresModule,
    EstimationModule,
    ReferenceProfilesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, MilestoneConsistencyService],
})
export class AdminModule {}

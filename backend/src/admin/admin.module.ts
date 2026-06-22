import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimateSnapshot,
  EstimationDiscrepancy,
  Game,
  GameSource,
  ProcessedArticle,
  SalesEstimate,
  SalesRecord,
  SignalSnapshot,
  TrustedSource,
} from '../entities';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { GamesModule } from '../games/games.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameSource,
      SignalSnapshot,
      SalesEstimate,
      SalesRecord,
      TrustedSource,
      ProcessedArticle,
      AchievementSnapshot,
      EstimateSnapshot,
      EstimationDiscrepancy,
    ]),
    IngestionModule,
    GamesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

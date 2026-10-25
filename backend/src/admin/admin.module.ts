import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  AdminUser,
  EstimateSnapshot,
  Game,
  GameIngestionState,
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
import { AdminAuthController } from './admin-auth.controller';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminMailService } from './admin-mail.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { GamesModule } from '../games/games.module';
import { PublishersModule } from '../publishers/publishers.module';
import { GenresModule } from '../genres/genres.module';
import { EstimationModule } from '../estimation/estimation.module';
import { ReferenceProfilesModule } from '../reference-profiles/reference-profiles.module';
import { BlogModule } from '../blog/blog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameIngestionState,
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
      AdminUser,
    ]),
    IngestionModule,
    GamesModule,
    PublishersModule,
    GenresModule,
    EstimationModule,
    ReferenceProfilesModule,
    BlogModule,
  ],
  controllers: [AdminController, AdminAuthController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminAuthGuard,
    AdminMailService,
  ],
  exports: [AdminAuthService, AdminMailService],
})
export class AdminModule {}

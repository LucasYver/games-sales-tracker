import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
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
    ]),
    IngestionModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

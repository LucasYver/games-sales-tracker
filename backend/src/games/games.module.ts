import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimateSnapshot,
  EstimationDiscrepancy,
  Game,
  Milestone,
  SalesEstimate,
  SignalSnapshot,
} from '../entities';
import { EstimationModule } from '../estimation/estimation.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      SignalSnapshot,
      AchievementSnapshot,
      SalesEstimate,
      EstimateSnapshot,
      EstimationDiscrepancy,
      Milestone,
    ]),
    EstimationModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}

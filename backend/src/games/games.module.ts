import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimateSnapshot,
  Game,
  GameRank,
  Milestone,
  PriceSnapshot,
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
      Milestone,
      PriceSnapshot,
      GameRank,
    ]),
    EstimationModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}

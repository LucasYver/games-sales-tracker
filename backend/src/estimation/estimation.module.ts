import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  Game,
  SalesEstimate,
  SalesRecord,
  SignalSnapshot,
} from '../entities';
import { EstimationService } from './estimation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      SignalSnapshot,
      SalesRecord,
      SalesEstimate,
      AchievementSnapshot,
    ]),
  ],
  providers: [EstimationService],
  exports: [EstimationService],
})
export class EstimationModule {}

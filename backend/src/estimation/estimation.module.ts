import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimationMethod,
  Game,
  SalesEstimate,
  SalesRecord,
  SignalSnapshot,
} from '../entities';
import { EstimationMethodService } from './estimation-method.service';
import { EstimationService } from './estimation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      SignalSnapshot,
      SalesRecord,
      SalesEstimate,
      AchievementSnapshot,
      EstimationMethod,
    ]),
  ],
  providers: [EstimationService, EstimationMethodService],
  exports: [EstimationService, EstimationMethodService],
})
export class EstimationModule {}

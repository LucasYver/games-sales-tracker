import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AchievementSnapshot,
  EstimationMethod,
  Game,
  Milestone,
  SalesEstimate,
  SignalSnapshot,
} from '../entities';
import { EstimationMethodService } from './estimation-method.service';
import { EstimationService } from './estimation.service';
import { GenresModule } from '../genres/genres.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      SignalSnapshot,
      Milestone,
      SalesEstimate,
      AchievementSnapshot,
      EstimationMethod,
    ]),
    GenresModule,
  ],
  providers: [EstimationService, EstimationMethodService],
  exports: [EstimationService, EstimationMethodService],
})
export class EstimationModule {}

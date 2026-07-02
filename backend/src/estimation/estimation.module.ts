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
import { ReferenceProfilesModule } from '../reference-profiles/reference-profiles.module';

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
    // Resolver facade — transitively re-exports GenresService via
    // GenresModule for the baseline path.
    ReferenceProfilesModule,
  ],
  providers: [EstimationService, EstimationMethodService],
  exports: [EstimationService, EstimationMethodService],
})
export class EstimationModule {}

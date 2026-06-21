import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game, SalesEstimate, SalesRecord, SignalSnapshot } from '../entities';
import { EstimationService } from './estimation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      SignalSnapshot,
      SalesRecord,
      SalesEstimate,
    ]),
  ],
  providers: [EstimationService],
  exports: [EstimationService],
})
export class EstimationModule {}

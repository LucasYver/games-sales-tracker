import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameSource } from '../entities';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RefreshService } from './refresh.service';
import { CronController } from './cron.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GameSource]), IngestionModule],
  providers: [RefreshService],
  controllers: [CronController],
})
export class SchedulerModule {}

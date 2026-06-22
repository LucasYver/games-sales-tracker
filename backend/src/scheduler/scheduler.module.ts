import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from '../entities';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RefreshService } from './refresh.service';
import { CronController } from './cron.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Game]), IngestionModule],
  providers: [RefreshService],
  controllers: [CronController],
})
export class SchedulerModule {}

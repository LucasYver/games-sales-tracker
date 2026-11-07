import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game, GameRank } from '../entities';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ReferenceProfilesModule } from '../reference-profiles/reference-profiles.module';
import { BlogModule } from '../blog/blog.module';
import { AdminModule } from '../admin/admin.module';
import { RefreshService } from './refresh.service';
import { CronController } from './cron.controller';
import { AdminCronController } from './admin-cron.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Game, GameRank]),
    IngestionModule,
    ReferenceProfilesModule,
    BlogModule,
    AdminModule,
  ],
  providers: [RefreshService],
  // AdminCronController lives here, not in AdminModule: it needs RefreshService
  // and AdminModule cannot import this module (this module imports it).
  controllers: [CronController, AdminCronController],
})
export class SchedulerModule {}

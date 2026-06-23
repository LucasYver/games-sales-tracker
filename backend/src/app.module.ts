import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { GamesModule } from './games/games.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { EstimationModule } from './estimation/estimation.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SourcesModule } from './sources/sources.module';
import { PublishersModule } from './publishers/publishers.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    GamesModule,
    IngestionModule,
    EstimationModule,
    SchedulerModule,
    SourcesModule,
    PublishersModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

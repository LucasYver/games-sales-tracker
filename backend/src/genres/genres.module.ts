import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Genre, GenreProfile } from '../entities';
import { GenresService } from './genres.service';
import { IgdbClient } from '../ingestion/igdb.client';

/**
 * `IgdbClient` is provided locally here (instead of pulled from
 * `IngestionModule`) on purpose: importing `IngestionModule` would
 * create a cycle (`IngestionModule → EstimationModule → GenresModule`
 * once `EstimationService` injects `GenresService`). The client is
 * stateless apart from a per-instance OAuth token cache, so a
 * second instance is harmless.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GenreProfile, Genre])],
  providers: [GenresService, IgdbClient],
  exports: [GenresService],
})
export class GenresModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Genre, GenreProfile } from '../entities';
import { GenresService } from './genres.service';
import { IngestionModule } from '../ingestion/ingestion.module';

@Module({
  imports: [TypeOrmModule.forFeature([GenreProfile, Genre]), IngestionModule],
  providers: [GenresService],
  exports: [GenresService],
})
export class GenresModule {}

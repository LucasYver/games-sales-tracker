import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Developer, Game } from '../entities';
import { DevelopersService } from './developers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Developer, Game])],
  providers: [DevelopersService],
  exports: [DevelopersService],
})
export class DevelopersModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game, Publisher } from '../entities';
import { PublishersService } from './publishers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Publisher, Game])],
  providers: [PublishersService],
  exports: [PublishersService],
})
export class PublishersModule {}

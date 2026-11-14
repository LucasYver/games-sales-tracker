import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialCredential, SocialPost } from '../entities';
import { GamesModule } from '../games/games.module';
import { SocialService } from './social.service';
import { SocialWriterService } from './social-writer.service';
import { ThreadsClient } from './threads.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialPost, SocialCredential]),
    GamesModule,
  ],
  providers: [SocialService, SocialWriterService, ThreadsClient],
  exports: [SocialService],
})
export class SocialModule {}

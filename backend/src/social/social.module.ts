import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialCredential, SocialPost } from '../entities';
import { GamesModule } from '../games/games.module';
import { SocialService } from './social.service';
import { SocialWriterService } from './social-writer.service';
import { ThreadsClient } from './threads.client';
import { XClient } from './x.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialPost, SocialCredential]),
    GamesModule,
  ],
  providers: [SocialService, SocialWriterService, ThreadsClient, XClient],
  exports: [SocialService],
})
export class SocialModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BlogPost,
  BlogPostTranslation,
  Game,
  GameRank,
  Milestone,
  SignalSnapshot,
} from '../entities';
import { BlogCandidateService } from './blog-candidate.service';
import { BlogFactPackService } from './blog-fact-pack.service';
import { BlogWriterService } from './blog-writer.service';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BlogPost,
      BlogPostTranslation,
      Game,
      GameRank,
      Milestone,
      SignalSnapshot,
    ]),
  ],
  controllers: [BlogController],
  providers: [
    BlogFactPackService,
    BlogCandidateService,
    BlogWriterService,
    BlogService,
  ],
  exports: [BlogService],
})
export class BlogModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from '../entities/game.entity';
import { Milestone } from '../entities/milestone.entity';
import { MilestoneAudit } from '../entities/milestone-audit.entity';
import { LlmModule } from '../llm/llm.module';
import { MilestoneAuditService } from './milestone-audit.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Milestone, Game, MilestoneAudit]),
    LlmModule,
  ],
  providers: [MilestoneAuditService],
  exports: [MilestoneAuditService],
})
export class MilestoneAuditModule {}

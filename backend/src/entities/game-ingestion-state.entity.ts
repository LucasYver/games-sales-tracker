import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Game } from './game.entity';

export const INGESTION_PIPELINES = [
  'DISCOVERY',
  'STEAM_REVIEWS',
  'STEAM_REVIEWER_PLAYTIME',
  'STORE_RATINGS',
  'ACHIEVEMENTS',
  'ESTIMATE_REBUILD',
  'STEAM_CCU',
  'STEAM_PRICE',
  'TWITCH_VIEWERS',
  'STEAM_POPULARITY',
  'MILESTONE_HARVEST',
] as const;

export type IngestionPipeline = (typeof INGESTION_PIPELINES)[number];

@Entity('game_ingestion_state')
@Index(['pipeline', 'lastAttemptAt'])
export class GameIngestionState {
  @PrimaryColumn('uuid')
  gameId: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  pipeline: IngestionPipeline;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}

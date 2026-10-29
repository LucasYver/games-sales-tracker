import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Agreement, Platform, SalesSource } from './enums';
import { Game } from './game.entity';

/**
 * Reconciliation entry frozen at snapshot time. Mirrors the runtime
 * ReconciliationEntry in GamesService but with ISO dates so the row
 * round-trips cleanly through jsonb.
 */
export interface SerializedReconciliationEntry {
  platform: Platform;
  declaredUnits: number;
  declaredSource: SalesSource;
  declaredAt: string | null;
  estimateLow: number;
  estimateHigh: number;
  estimateMethod: string;
  agreement: Agreement;
  ratio: number;
  detail: string;
}

/**
 * Persisted snapshot of the headline "today" range and the per-platform
 * reconciliation as they were at `computedAt`. Written every time
 * `EstimationService.computeAndStore` runs (cron refresh, manual refresh,
 * historical rebuild), so we can later draw a sales-over-time chart
 * without having to replay `GamesService.compose` from scratch.
 *
 * `computedAt` is a plain timestamp column (no @CreateDateColumn) so
 * historical rebuilds can backfill it to a past date.
 */
@Entity('estimate_snapshot')
@Index(['gameId', 'computedAt'])
export class EstimateSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column('int')
  estimatedTodayLow: number;

  @Column('int')
  estimatedTodayHigh: number;

  // The single figure displayed for this range: its midpoint for the
  // platform sum, the model's own estimate for the ML range (estimate ÷/× a
  // factor, whose midpoint would overstate it). Null only on rows written
  // before the column existed and never backfilled.
  @Column('int', { nullable: true })
  estimatedTodayUnits: number | null;

  @Column('jsonb', { default: () => "'[]'::jsonb" })
  reconciliation: SerializedReconciliationEntry[];

  @Column('timestamp', { default: () => 'now()' })
  computedAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

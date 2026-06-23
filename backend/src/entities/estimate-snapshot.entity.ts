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

  // "Pure algo" headline: same range but computed by re-running the
  // estimation pipeline as if no declared sales record existed for
  // this game. Bypasses the calibrated Boxleiter multipliers (forces
  // defaults) AND the declared-figure-aided floor/cap inside
  // `aggregateSales`. Lets us measure how strong the model is on its
  // own, independent of any external help.
  //
  // Nullable because legacy rows produced before the column existed
  // can't be re-derived without re-running the full rebuild path.
  @Column('int', { nullable: true })
  pureEstimatedTodayLow: number | null;

  @Column('int', { nullable: true })
  pureEstimatedTodayHigh: number | null;

  @Column('jsonb', { default: () => "'[]'::jsonb" })
  reconciliation: SerializedReconciliationEntry[];

  @Column('timestamp', { default: () => 'now()' })
  computedAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

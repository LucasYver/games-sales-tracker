import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConfidenceLevel, Platform } from './enums';
import { EstimationMethod } from './estimation-method.entity';
import { Game } from './game.entity';

@Entity('sales_estimate')
@Index(['gameId', 'platform', 'computedAt'])
@Index(['gameId', 'platform', 'methodId', 'computedAt'])
export class SalesEstimate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column('int')
  estimatedLow: number;

  @Column('int')
  estimatedHigh: number;

  @Column({ type: 'enum', enum: ConfidenceLevel })
  confidence: ConfidenceLevel;

  // Canonical method this estimate was produced by, looked up by `code`
  // in `estimation_method`. The legacy free-form `method` string below
  // remains for backward compatibility and carries dynamic modifier
  // suffixes (e.g. `+ccu-intersect`, `+launcher-primary`) that aren't
  // yet first-class methods. The string column will be dropped in a
  // follow-up migration once nothing reads it anymore.
  @Column('uuid')
  methodId: string;

  @ManyToOne(() => EstimationMethod, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'methodId' })
  estimationMethod: EstimationMethod;

  @Column()
  method: string;

  // Reference rows are produced for diagnostic purposes only
  // (alternative variants of the main method: e.g. boxleiter-default
  // alongside boxleiter-calibrated-X, first-week with vs without
  // genre profile, with vs without ccu-intersect). They are excluded
  // from `aggregateMethodsForPlatform` so they never bias the
  // consensus, but persisted so the admin UI can show side-by-side
  // comparisons of every estimation path.
  @Column('boolean', { default: false })
  isReference: boolean;

  // Plain timestamp (not @CreateDateColumn) so historical rebuilds can
  // backfill it to a past date when replaying estimates against the
  // current multipliers.
  @Column('timestamp', { default: () => 'now()' })
  computedAt: Date;

  @ManyToOne(() => Game, (game) => game.estimates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

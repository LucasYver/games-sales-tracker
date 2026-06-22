import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Platform, SalesSource } from './enums';
import { Game } from './game.entity';
import { SalesRecord } from './sales-record.entity';

/**
 * One row each time an incoming `SalesRecord` reveals that our prior
 * estimate for the same game/platform was significantly off (ratio
 * outside [DISCREPANCY_RATIO_LOW, DISCREPANCY_RATIO_HIGH]). Created at
 * record ingestion time and **never updated** afterwards — even if we
 * later recalibrate and the live `agreement` flips to `strong`, the
 * frozen miss stays as evidence of the model's past error.
 *
 * Unique on `recordId`: each record produces at most one discrepancy.
 * Re-evaluation is a no-op for already-evaluated records, so the
 * historical truth is stable.
 */
@Entity('estimation_discrepancy')
@Index(['gameId', 'detectedAt'])
@Index(['recordId'], { unique: true })
export class EstimationDiscrepancy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column('uuid')
  recordId: string;

  @Column('int')
  declaredUnits: number;

  @Column({ type: 'enum', enum: SalesSource })
  declaredSource: SalesSource;

  @Column({ type: 'timestamp', nullable: true })
  declaredAt: Date | null;

  @Column('int')
  priorEstimateLow: number;

  @Column('int')
  priorEstimateHigh: number;

  @Column('timestamp')
  priorEstimateAt: Date;

  // declaredUnits / midPriorEstimate. >1 = the model underestimated;
  // <1 = the model overestimated. Stored so we can sort/filter without
  // dividing again.
  @Column('float')
  ratio: number;

  @Column('timestamp', { default: () => 'now()' })
  detectedAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @ManyToOne(() => SalesRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recordId' })
  record: SalesRecord;
}

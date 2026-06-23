import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EstimationMethodFamily } from './enums';

/**
 * Registry of estimation methods recognised by `EstimationService`.
 *
 * Acts as a single source of truth for:
 *  - which methods may produce a `SalesEstimate` row (`isEnabled`);
 *  - how their bounds are weighted when `aggregateMethods` combines
 *    several methods into the headline `aggregated` row (`defaultWeight`);
 *  - whether the row is itself an aggregate (`isAggregate`) and must
 *    therefore be excluded from the aggregation's input.
 *
 * `code` is the stable identifier used everywhere in code (e.g.
 * `boxleiter-calibrated-official`, `achievements-exophase-pc`). The
 * `id` (uuid) is only used as the FK target from `SalesEstimate`.
 */
@Entity('estimation_method')
@Index(['family'])
export class EstimationMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: EstimationMethodFamily })
  family: EstimationMethodFamily;

  // Weight used by `aggregateMethods` when combining methods that share
  // the same `(gameId, platform, computedAt)`. A weight of 0 effectively
  // disables the method as an aggregation input without removing the row.
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 1 })
  defaultWeight: number;

  // Methods with `isEnabled = false` should not be produced by the
  // estimation pipeline. Kept as a soft flag so historical rows remain
  // valid even after a method is retired.
  @Column({ default: true })
  isEnabled: boolean;

  // Marks rows that represent an aggregated output. Excluded from
  // `aggregateMethods` inputs to avoid feeding the aggregate back into
  // itself.
  @Column({ default: false })
  isAggregate: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

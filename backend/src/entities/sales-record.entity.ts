import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConfidenceLevel, Platform, SalesSource } from './enums';
import { Game } from './game.entity';

// A point-in-time sales figure for a game on one platform, from a single
// source. Official figures are exact; media/announcements come from press and
// PR/social. Provenance is kept so we can pick the most reliable number per
// platform and never mix exact with estimated.
@Entity('sales_record')
@Index(['gameId', 'platform', 'source'])
export class SalesRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column({ type: 'enum', enum: SalesSource })
  source: SalesSource;

  @Column('int')
  units: number;

  @Column({ type: 'varchar', default: 'GLOBAL' })
  region: string;

  @Column({ type: 'enum', enum: ConfidenceLevel, nullable: true })
  confidence: ConfidenceLevel | null;

  @Column({ type: 'varchar', nullable: true })
  publisher: string | null;

  @Column({ type: 'varchar', nullable: true })
  sourceUrl: string | null;

  // Verbatim quote the figure was extracted from, kept for grounding so a
  // reported number can always be traced back to its exact wording.
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reportedAt: Date | null;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, (game) => game.salesRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

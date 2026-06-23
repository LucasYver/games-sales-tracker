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

  // Marks "engagement" figures (e.g. "1.17M players reached" — typically
  // including subscription-service users like Ubisoft+/Game Pass) that are
  // adjacent to sales but NOT a copies-sold count. Kept on the same table so
  // they share the provenance/quote/rejection workflow, but they are excluded
  // from estimation calibration, the per-platform breakdown headline total and
  // discrepancy evaluation — they exist purely as an informational signal.
  @Column({ type: 'boolean', default: false })
  isEngagement: boolean;

  @CreateDateColumn()
  capturedAt: Date;

  // Set when an admin manually drops the record. We keep the row (soft-delete)
  // so the ingestion pipeline can recognize it on subsequent refreshes and
  // refuse to re-insert the same figure (matched by gameId + platform + source
  // + sourceUrl + units + reportedAt). All reads exclude rejected rows.
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @ManyToOne(() => Game, (game) => game.salesRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

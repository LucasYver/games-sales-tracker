import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Platform, SalesSource } from './enums';
import { Game } from './game.entity';

// A dated sales-related figure for a game, coming from a single source.
// Officially-declared totals, press announcements, Wikipedia citations all
// share this row — the source is kept for traceability and the
// `confidenceScore` (derived from the trusted source's weight) is purely
// informational. `platform` scopes the figure: `GLOBAL` is a worldwide,
// all-platforms-combined total; `PC`/`PLAYSTATION`/`XBOX`/`SWITCH` are
// single-platform totals used to learn the PC-vs-console split.
//
// Calibration always picks the most recent milestone (by `reportedAt`),
// regardless of source. `confidenceScore` does NOT influence the
// calibration — it is exposed verbatim so the operator can judge.
@Entity('milestone')
@Index(['gameId', 'source'])
@Index(['gameId', 'platform'])
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: SalesSource })
  source: SalesSource;

  @Column('int')
  units: number;

  // Platform the figure is scoped to. `GLOBAL` = worldwide all-platforms
  // total (the historical default); the single-platform values feed the
  // learned PC-vs-console split. Calibration paths filter on this.
  @Column({ type: 'enum', enum: Platform, default: Platform.GLOBAL })
  platform: Platform;

  // Marks a modeled/estimated figure (e.g. a third-party estimate source)
  // rather than a sourced actual, so low-trust numbers can be down-weighted
  // or excluded from the split-learning corpus. Sourced actuals are false.
  @Column({ type: 'boolean', default: false })
  isEstimate: boolean;

  // 0–100 numeric score derived from the trusted source's weight. Purely
  // informational: never used to weight calibration, spread, or aggregation.
  // Surfaced verbatim in the admin so an operator can judge a figure's
  // trustworthiness at a glance.
  @Column({ type: 'int', nullable: true })
  confidenceScore: number | null;

  @Column({ type: 'varchar', nullable: true })
  publisher: string | null;

  @Column({ type: 'varchar', nullable: true })
  sourceUrl: string | null;

  // Verbatim quote the figure was extracted from, kept for grounding so a
  // reported number can always be traced back to its exact wording.
  @Column({ type: 'text', nullable: true })
  note: string | null;

  // A milestone without a date cannot calibrate the model and is dropped at
  // extraction time (see ingestion.service). The column stays nullable to
  // accommodate any legacy rows imported before the date became mandatory.
  @Column({ type: 'timestamptz', nullable: true })
  reportedAt: Date | null;

  // Marks "engagement" figures (e.g. "1.17M players reached" — typically
  // including subscription-service users like Ubisoft+/Game Pass) that are
  // adjacent to sales but NOT a copies-sold count. Kept on the same table so
  // they share the provenance/quote/rejection workflow, but excluded from
  // calibration, the breakdown headline and discrepancy evaluation — they
  // exist purely as an informational signal.
  @Column({ type: 'boolean', default: false })
  isEngagement: boolean;

  @CreateDateColumn()
  capturedAt: Date;

  // Set when an admin manually drops the row. We keep it (soft-delete) so
  // the ingestion pipeline can recognize it on subsequent refreshes and
  // refuse to re-insert the same figure (matched by gameId + source +
  // sourceUrl + units + reportedAt). All reads exclude rejected rows.
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @ManyToOne(() => Game, (game) => game.milestones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

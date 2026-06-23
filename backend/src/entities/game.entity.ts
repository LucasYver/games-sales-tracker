import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform, SalesSource } from './enums';
import { GameSource } from './game-source.entity';
import { SignalSnapshot } from './signal-snapshot.entity';
import { SalesEstimate } from './sales-estimate.entity';
import { SalesRecord } from './sales-record.entity';
import { Publisher } from './publisher.entity';

@Entity('game')
// GIN trigram index for fuzzy game-name search. Created (and refreshed)
// imperatively by `DatabaseInitService` because TypeORM decorators can't
// express the `gin_trgm_ops` operator class. Declared here purely so the
// schema-diff engine knows it exists and doesn't try to drop it on every
// `migration:generate` / sync cycle.
@Index('game_name_trgm_idx', { synchronize: false })
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'int', nullable: true })
  igdbId: number | null;

  @Index()
  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'timestamptz', nullable: true })
  releaseDate: Date | null;

  @Column({ type: 'varchar', nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  // Free-to-play games have no meaningful "units sold", so we never estimate
  // sales for them.
  @Column({ default: false })
  isFree: boolean;

  @Column({ type: 'enum', enum: Platform, array: true, default: '{}' })
  platforms: Platform[];

  @Column({ type: 'varchar', nullable: true })
  developer: string | null;

  // Raw publisher name as reported by IGDB (or Steam fallback). Kept as a
  // plain string so a game still has *some* publisher info even when not
  // linked to a curated `Publisher` row. The FK `publisherId` is set only
  // for the curated big-publisher list — see `PublishersService`.
  @Column({ type: 'varchar', nullable: true })
  publisher: string | null;

  @Column({ type: 'uuid', nullable: true })
  publisherId: string | null;

  @ManyToOne(() => Publisher, (p) => p.games, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'publisherId' })
  publisherRecord: Publisher | null;

  @Column({ type: 'simple-array', nullable: true })
  genres: string[] | null;

  // Per-platform Boxleiter multipliers (signal → units) derived from this
  // game's most reliable declared figure for each platform. When set, they
  // replace the generic default ranges so per-platform estimates are
  // calibrated to this specific title. Null until a trustworthy declared
  // figure with a contemporaneous signal snapshot exists for that platform.
  //   - calibratedMultiplier:     PC, units per Steam review
  //   - calibratedPsMultiplier:   PlayStation, units per PS Store rating
  //   - calibratedXboxMultiplier: Xbox, units per Xbox Store rating
  @Column({ type: 'float', nullable: true })
  calibratedMultiplier: number | null;

  @Column({ type: 'float', nullable: true })
  calibratedPsMultiplier: number | null;

  @Column({ type: 'float', nullable: true })
  calibratedXboxMultiplier: number | null;

  // SalesSource of the record that produced each calibrated multiplier
  // above. Drives the per-source spread in
  // `CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE`: an OFFICIAL-derived
  // multiplier gets a tight ±20 %, a MEDIA-derived one a looser ±45 %.
  // Always populated when the corresponding `calibrated*Multiplier` is.
  @Column({ type: 'enum', enum: SalesSource, nullable: true })
  calibrationSourcePc: SalesSource | null;

  @Column({ type: 'enum', enum: SalesSource, nullable: true })
  calibrationSourcePs: SalesSource | null;

  @Column({ type: 'enum', enum: SalesSource, nullable: true })
  calibrationSourceXbox: SalesSource | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Timestamp of the last successful Steam ingestion refresh. Used by the
  // periodic refresh cron to skip games that were updated recently. The
  // refresh cadence depends on the game's age (see refresh-interval.ts).
  @Column({ type: 'timestamptz', nullable: true })
  lastRefreshedAt: Date | null;

  @OneToMany(() => GameSource, (source) => source.game)
  sources: GameSource[];

  @OneToMany(() => SignalSnapshot, (signal) => signal.game)
  signals: SignalSnapshot[];

  @OneToMany(() => SalesEstimate, (estimate) => estimate.game)
  estimates: SalesEstimate[];

  @OneToMany(() => SalesRecord, (record) => record.game)
  salesRecords: SalesRecord[];
}

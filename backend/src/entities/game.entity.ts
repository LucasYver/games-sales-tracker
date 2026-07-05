import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
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
import { Milestone } from './milestone.entity';
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

  // Steam store "categories" (e.g. "Single-player", "Multi-player", "Co-op").
  // Distinct from `genres`: categories describe play modes / features.
  @Column({ type: 'simple-array', nullable: true })
  categories: string[] | null;

  // Steam community tags (e.g. "Grand Strategy", "4X", "Roguelike"), the
  // richest gameplay-type signal we have — far finer than the ~5 coarse
  // Steam `genres`. Sourced from SteamSpy (top tags by vote), used by the
  // data-driven matcher as its dominant similarity axis. `null` until a
  // tag fetch/backfill has run for the game.
  @Column({ type: 'simple-array', nullable: true })
  steamTags: string[] | null;

  // appIds of this game's Steam DLC.
  @Column({ type: 'int', array: true, nullable: true })
  dlc: number[] | null;

  // Franchise identity, used by the data-driven matcher as a strong
  // similarity axis: two entries of the same franchise (e.g. successive
  // "FIFA" or "Call of Duty" releases) behave far more alike than two
  // unrelated games sharing a genre. `null` when the game isn't
  // recognised as part of a tracked franchise. Derived by
  // `backfill-franchise.ts` (curated annual-franchise dictionary + name
  // normalisation); never hand-edited per game.
  @Column({ type: 'varchar', nullable: true })
  franchiseSlug: string | null;

  // True for annually-iterated titles (sports sims, yearly shooters).
  // Their lifecycle is sharply different from one-shot games — a big
  // week-1 spike then fast decay as the next iteration supersedes them.
  // Independent of `franchiseSlug` so an annual game with an unknown
  // franchise still carries the signal.
  @Column({ type: 'boolean', default: false })
  isAnnualIteration: boolean;

  // Best-effort iteration marker parsed from the title (the year for
  // "FIFA 18", the sequel number for "Battlefield 4"). Purely a
  // tie-breaker / diagnostic aid; `null` when nothing parses. Not used
  // as a hard matching key.
  @Column({ type: 'int', nullable: true })
  iterationNumber: number | null;

  // True for live-service titles (persistent online games with ongoing
  // content: MMOs, season-pass shooters, battle-royale). They retain
  // players — and accumulate reviews — for years, so both their
  // reviews→units ratio and their year-2 retention differ markedly from
  // one-shot games. Derived from Steam categories + a curated set (see
  // `live-service.ts`); refreshed at ingestion.
  @Column({ type: 'boolean', default: false })
  liveService: boolean;

  // When true, this game is never used as a reference anchor by the matcher
  // (excluded from `loadCorpus`). Set manually in the admin for titles whose
  // data is too sparse/unreliable and would skew the derived reference vectors.
  @Column({ type: 'boolean', default: false })
  excludedFromReference: boolean;

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

  // SalesSource of the milestone that produced each calibrated multiplier
  // above. Kept for traceability only — the spread around a calibrated
  // multiplier is now a single uniform `CALIBRATED_MULTIPLIER_SPREAD` and
  // no longer varies by source. Always populated when the corresponding
  // `calibrated*Multiplier` is.
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

  // Soft-delete marker. When set, the row stays in the DB but is hidden from
  // every standard read (TypeORM excludes soft-deleted rows by default) so the
  // discovery / refresh pipelines never re-create a game an admin removed.
  // Manual re-add via `addGameFromIgdbUrl` restores the row.
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

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

  @OneToMany(() => Milestone, (milestone) => milestone.game)
  milestones: Milestone[];
}

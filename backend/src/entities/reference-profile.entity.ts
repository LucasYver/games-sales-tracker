import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Game } from './game.entity';

/**
 * Observed behavioural vector for a single game (an "anchor" of the
 * data-driven similarity model). Every field is a mesured quantity
 * derived from `signal_snapshot` + `milestone` — nothing is hand-typed
 * and no genre is stored on this row. That is deliberate: the genre is
 * (at most) a feature the matcher may use to find neighbours, never an
 * output the model consumes.
 *
 * Materialised by `ReferenceProfileService.rebuildOne(gameId)` and
 * refreshed periodically. Rows below the eligibility threshold are
 * skipped (no anchor persisted) so consumers can assume any existing
 * row is trustworthy relative to its `qualityScore`.
 *
 * Reads: matcher (kNN) at estimation time.
 * Writes: ETL job on refresh and on-demand from the ingestion pipeline.
 */
@Entity('reference_profile')
export class ReferenceProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  gameId: string;

  @OneToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  /**
   * Fractions of the game's cumulative units reached at release-relative
   * checkpoints, normalised to `a1 = 1.0`. Values at S1/M1/M3/M6 land in
   * [0, 1] (the curve is monotonically increasing before Y1); `a2` sits
   * in [~1, ∞) and captures the year-2 retention factor (`< 1` means the
   * observation is incomplete — should be null instead).
   *
   * Stored as separate columns rather than JSON so we can index them and
   * emit efficient partial aggregates.
   */
  @Column({ type: 'float', nullable: true })
  curveS1: number | null;

  @Column({ type: 'float', nullable: true })
  curveM1: number | null;

  @Column({ type: 'float', nullable: true })
  curveM3: number | null;

  @Column({ type: 'float', nullable: true })
  curveM6: number | null;

  @Column({ type: 'float', nullable: true })
  curveA1: number | null;

  @Column({ type: 'float', nullable: true })
  curveA2: number | null;

  /**
   * Measured Boxleiter-equivalent ratio: units per Steam review at the
   * anchor date (leak or milestone). `null` when the game lacks a
   * dated worldwide milestone (or leak snapshot) with contemporaneous
   * review coverage.
   */
  @Column({ type: 'float', nullable: true })
  reviewsToUnits: number | null;

  /**
   * Steam-reviews → WORLDWIDE units ratio, era-normalised like
   * {@link reviewsToUnits}. Unlike the PC Boxleiter this maps Steam reviews
   * to the game's all-platforms total, so it bakes in the platform mix
   * (`globalReviewsToUnits ≈ reviewsToUnits / platformSharePc`). It is the
   * only sales signal a "global-only" game (a worldwide milestone, no
   * per-platform figure) can measure, and is kept as its OWN feature so it
   * never contaminates the strictly-PC `reviewsToUnits`. Consumed as an
   * independent worldwide anchor (blended with the PC path at resolution).
   * `null` when no GLOBAL milestone coexists with review coverage.
   */
  @Column({ type: 'float', nullable: true })
  globalReviewsToUnits: number | null;

  /**
   * Per-platform proxy shares derived from cross-platform ratings
   * counters × ratings→units factors. Sums to ≈ 1.0 when defined.
   * Populated only when at least PC + one console signal are available;
   * otherwise stored as `null` (caller falls back to the cold-start
   * global average). Not validated by the leak — this is the least
   * trustworthy piece of the vector and is called out separately.
   */
  @Column({ type: 'float', nullable: true })
  platformSharePc: number | null;

  @Column({ type: 'float', nullable: true })
  platformSharePs: number | null;

  @Column({ type: 'float', nullable: true })
  platformShareXbox: number | null;

  @Column({ type: 'float', nullable: true })
  platformShareSwitch: number | null;

  /**
   * Observed "launch peak CCU → week-1 units" ratio: the anchor's
   * week-1 units (derived as its week-1 cumulative Steam reviews ×
   * `reviewsToUnits`) divided by its highest daily `STEAM_CONCURRENT`
   * value in the two weeks after release. This is the data-driven
   * replacement for `GenreProfile.peakCcuToWeekOne*`: high-retention
   * games keep a large concurrent footprint relative to sales → a LOW
   * ratio; one-and-done games → a HIGH ratio. `null` when the anchor
   * lacks a launch CCU sample or a reviews→units ratio.
   */
  @Column({ type: 'float', nullable: true })
  peakCcuRatio: number | null;

  /**
   * Absolute volume the anchor represents (units), useful to match
   * neighbours of comparable magnitude. Sourced from the most recent
   * accepted worldwide milestone, or the leak snapshot × conservative
   * scale factor when only the leak is available.
   */
  @Column({ type: 'bigint', nullable: true })
  scaleUnits: string | null;

  /**
   * Composite [0, 1] quality signal used to weight this anchor in kNN
   * aggregation. Higher = more trustworthy. Combines signal coverage,
   * milestone presence, time span covered, recency of the anchor date
   * and milestone provenance confidence.
   */
  @Column({ type: 'float' })
  qualityScore: number;

  /**
   * Timestamp the anchor's observation window closes on. The leak-date
   * for pre-2018 hits, the most recent milestone date otherwise. Used
   * both to age the anchor (`qualityScore` penalises stale rows) and to
   * make the ETL idempotent.
   */
  @Column({ type: 'timestamptz' })
  observedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Year2Retention } from './enums';

/**
 * Empirical platform-split bucket for a game type. Holds the PC vs
 * console share, broken down per console (PlayStation / Xbox /
 * Switch).
 *
 * Source: empirical observation across thousands of titles, seeded by
 * the migration `AddGenreProfileAndGenre`. The shares are deliberately
 * editable from the admin — they will drift as new data lands.
 *
 * Each `Genre` row references one profile via `Genre.profileId`. When
 * a game's IGDB genres resolve to multiple profiles, the future
 * "console-from-PC" estimation method will blend them by weight.
 *
 * Invariant: `pcShare + playstationShare + xboxShare + switchShare`
 * should be ≈ 1.0 (the migration seed enforces it; admin edits don't
 * because partial profiles are useful while iterating). The future
 * consumer should normalise rather than assume.
 */
@Entity('genre_profile')
export class GenreProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 3 })
  pcShare: number;

  @Column({ type: 'numeric', precision: 4, scale: 3 })
  playstationShare: number;

  @Column({ type: 'numeric', precision: 4, scale: 3 })
  xboxShare: number;

  @Column({ type: 'numeric', precision: 4, scale: 3 })
  switchShare: number;

  // Free-form qualitative hint from the source spreadsheet (e.g.
  // "PS fort", "Switch/PS", "équilibré"). Kept for human readability
  // alongside the numeric shares above.
  @Column({ type: 'varchar', nullable: true })
  leanLabel: string | null;

  // Lifecycle profile — how the sales curve decays over time. Used by
  // the (future) genre-aware refinement of the first-week extrapolation
  // method to replace the naive size-bucketed multiplier with a
  // per-genre one.
  //
  //   lifecycleIndex    : empirical normalised score (~0.4 → 2.5).
  //                       Driven by the same row as the multiplier,
  //                       kept as a ranking primitive.
  //   firstWeekToYearOneMultiplier
  //                     : ratio (year-1 cumulative units) / (week-1
  //                       units). e.g. 6.0 for Grand strategy, 1.2 for
  //                       annualised Sport.
  //   year2Retention    : qualitative grade for how much the title
  //                       still sells past year 1 — see `Year2Retention`.
  //   lifecycleDriver   : free-text rationale (mods, UGC, DLC, live
  //                       service, etc.) — surfaced in the admin so an
  //                       editor sees *why* the row has its values.

  @Column({ type: 'numeric', precision: 3, scale: 2 })
  lifecycleIndex: number;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  firstWeekToYearOneMultiplier: number;

  @Column({ type: 'enum', enum: Year2Retention })
  year2Retention: Year2Retention;

  @Column({ type: 'text', nullable: true })
  lifecycleDriver: string | null;

  // Genre-specific "all-time peak Steam CCU → week-1 units" range.
  // The relationship is strongly genre-dependent: high-engagement /
  // high-retention genres (grand strategy, MMO, survival) keep a large
  // share of owners online simultaneously, so their peak CCU is HIGH
  // relative to sales → a LOW ratio (~2-3×). One-and-done genres
  // (narrative, JRPG, cinematic AAA) have a small concurrent footprint
  // relative to total sales → a HIGH ratio (~5-10×).
  //
  // Replaces the genre-blind global FIRST_WEEK_PEAK_CCU_LOW/HIGH
  // constants inside `estimateFirstWeekExtrapolationForPc` whenever a
  // profile resolves; the globals stay as the unresolved fallback.
  @Column({ type: 'numeric', precision: 4, scale: 2 })
  peakCcuToWeekOneLow: number;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  peakCcuToWeekOneHigh: number;

  // Per-genre Boxleiter default multiplier range. When set, overrides the
  // global PC_BOXLEITER_DEFAULT_LOW/HIGH (and PS equivalent) constants in
  // `estimation.service.ts` for every uncalibrated game of this genre.
  // Null = fall back to the global constant (safe default for new profiles).
  //
  // Tuning guidance:
  //   - Inspect calibrated games of the genre: their calibratedMultiplier
  //     reveals the true reviews→sales ratio. Set the default range around
  //     the observed distribution (e.g. p25–p75 of calibrated multipliers).
  //   - Narrowing the range reduces disagreement inflation in the aggregate
  //     and makes the pure-algo estimate converge toward declared milestones.
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  pcDefaultBoxleiterLow: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  pcDefaultBoxleiterHigh: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  psDefaultBoxleiterLow: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  psDefaultBoxleiterHigh: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

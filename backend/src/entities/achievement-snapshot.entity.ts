import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Platform, SourceType } from './enums';
import { Game } from './game.entity';

/**
 * One row per achievement, per capture. Two complementary sources feed it:
 *
 *   - `SourceType.EXOPHASE` (Steam/PSN/Xbox): sample-based, exposes a finite
 *     `playersTracked` count plus per-achievement unlock percentages biased
 *     high (Exophase users are completionists). Both `playersTracked` and
 *     `playersWithAchievement` are populated.
 *
 *   - `SourceType.STEAM` (Steam only): Valve's official global percentages
 *     computed across the entire Steam playerbase (no sample, no bias), but
 *     no absolute count is exposed by the API. `playersTracked` and
 *     `playersWithAchievement` are therefore null; only `percentEarned` is
 *     meaningful. Used as ground truth to calibrate Exophase's bias.
 *
 * The most common achievement (typically tutorial / first boss) is a strong
 * proxy for "players who actually launched the game". Combining the
 * unbiased Steam `%` with the absolute Exophase sample size lets us scale
 * the sample up to the real playerbase — the foundation of the
 * achievement-based sales estimation (planned in a later step). For now
 * we only collect; the estimator is wired in once we have all three
 * platforms + publisher IR calibration data.
 */
@Entity('achievement_snapshot')
@Index(['gameId', 'platform', 'capturedAt'])
export class AchievementSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column({ type: 'enum', enum: SourceType })
  source: SourceType;

  @Column({ type: 'varchar' })
  achievementSlug: string;

  @Column({ type: 'varchar' })
  achievementName: string;

  // 0–100, share of `playersTracked` who unlocked this achievement.
  @Column({ type: 'float' })
  percentEarned: number;

  // Sample size from the tracker. NOT the real playerbase; it must be scaled
  // by a tracker-coverage ratio (calibrated against publisher figures).
  // Null when the source has no sample concept (e.g. Steam official API,
  // which reports `percentEarned` computed over all Steam players).
  @Column({ type: 'int', nullable: true })
  playersTracked: number | null;

  // Derived: round(playersTracked * percentEarned / 100). Stored to keep
  // queries simple and to lock the value at capture time even if the
  // formula changes later. Null when `playersTracked` is null.
  @Column({ type: 'int', nullable: true })
  playersWithAchievement: number | null;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

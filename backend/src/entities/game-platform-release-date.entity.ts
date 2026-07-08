import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Platform } from './enums';
import { Game } from './game.entity';

/**
 * IGDB `release_dates` broken out per platform (e.g. a game can launch on
 * PlayStation a year before its PC port). Distinct from `Game.releaseDate`,
 * which stays the earliest date across all platforms (IGDB
 * `first_release_date`) and drives platform-agnostic logic (worldwide
 * freshness cap, refresh cadence, matcher identity, display fallback).
 * One row per (gameId, platform); rewritten wholesale on each ingestion sync.
 */
@Entity('game_platform_release_date')
export class GamePlatformReleaseDate {
  @PrimaryColumn('uuid')
  gameId: string;

  @PrimaryColumn({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column({ type: 'timestamptz' })
  releaseDate: Date;

  @ManyToOne(() => Game, (game) => game.platformReleaseDates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

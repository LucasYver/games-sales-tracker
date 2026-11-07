import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Game } from './game.entity';

/**
 * A commercial edition of a catalog game ("Deluxe Edition", "GOTY Edition"),
 * as IGDB lists it: its own record pointing at the base game through
 * `version_parent`. Editions are never catalog games of their own; the sales
 * of the base game cover them all. Kept for the game page ("sales include
 * every edition") and to redirect the URL of an edition game merged into its
 * base. Rewritten for each game by the nightly IGDB refresh.
 */
@Entity('game_edition')
export class GameEdition {
  /** The edition's own IGDB id. */
  @PrimaryColumn('int')
  igdbId: number;

  @Index('IDX_game_edition_gameId')
  @Column('uuid')
  gameId: string;

  /** IGDB's full name, e.g. "Hogwarts Legacy: Deluxe Edition". */
  @Column({ type: 'varchar' })
  name: string;

  /** IGDB `version_title`, e.g. "Deluxe Edition". */
  @Column({ type: 'varchar', nullable: true })
  versionTitle: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  releaseDate: Date | null;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Game } from './game.entity';

/**
 * A slug a game no longer uses since it was renamed. The game page and the
 * compare page send it on to the game's current slug with a permanent
 * redirect, so an indexed URL survives the rename. Written by the admin rename
 * (and the one-off renames of `scripts/rename-edition-games.ts`); pointing at
 * the game rather than at a slug, a second rename needs no rewrite.
 */
@Entity('game_slug_redirect')
export class GameSlugRedirect {
  /** The old slug. */
  @PrimaryColumn('varchar')
  slug: string;

  @Index('IDX_game_slug_redirect_gameId')
  @Column('uuid')
  gameId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

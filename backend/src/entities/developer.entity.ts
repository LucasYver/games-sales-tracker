import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Game } from './game.entity';

/**
 * One row per development studio a game names, linked via `Game.developerId`.
 * Spellings of one studio share a row ("Capcom" and "CAPCOM Co., Ltd."), and
 * `COMPANY_ALIASES` in `games/game-companies.ts` folds internal divisions. A
 * new name gets its row the first time ingestion or the nightly IGDB refresh
 * meets it — see `DevelopersService`. The public studio pages group games by
 * this row.
 */
@Entity('developer')
export class Developer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_developer_name', { unique: true })
  @Column()
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Game, (game) => game.developerRecord)
  games: Game[];
}

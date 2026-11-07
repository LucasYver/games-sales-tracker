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
 * One row per publishing company a game names, linked via `Game.publisherId`
 * (matcher publisher axis, blog rankings). Spellings of one company share a
 * row ("Capcom" and "CAPCOM Co., Ltd."), and the curated list in
 * `publishers/publishers.seed.ts` also merges renames and subsidiaries. A new
 * name gets its row the first time ingestion or the nightly IGDB refresh
 * meets it — see `PublishersService`.
 */
@Entity('publisher')
export class Publisher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Game, (game) => game.publisherRecord)
  games: Game[];
}

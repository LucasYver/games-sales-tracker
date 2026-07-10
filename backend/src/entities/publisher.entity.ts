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
 * Curated registry of "big" publishers used to canonicalise a game's
 * publisher across raw-string variants (e.g. "Capcom" vs "CAPCOM Co.,
 * Ltd.") so the matcher's publisher axis connects same-publisher titles.
 * A Publisher row is created only for the publishers we know to treat
 * specially (see PublishersService seed list) — random IGDB publisher
 * names do not get their own row. Games whose IGDB publisher matches one
 * of these entries are linked via `Game.publisherId`; the others keep
 * their raw publisher string but no `publisherRecord` relation.
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

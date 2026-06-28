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
 * Curated registry of "big" publishers whose PC distribution profile
 * deviates from the Steam-default. A Publisher row is created only for
 * the publishers we know to treat specially (see PublishersService seed
 * list) — random IGDB publisher names do not get their own row. Games
 * whose IGDB publisher matches one of these entries are linked via
 * `Game.publisherId`; the others keep their raw publisher string but no
 * `publisherRecord` relation.
 */
@Entity('publisher')
export class Publisher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  name: string;

  /**
   * Editable estimate of how much of this publisher's *PC* sales go
   * through Steam, expressed as a percentage range [low, high] (e.g.
   * 50–71 for a multi-store publisher). The estimation engine derives a
   * Steam→total-PC scaling factor from it (factor = 100 / steamShare) to
   * correct Boxleiter/CCU undershoot when players are pushed to a
   * competing storefront (Epic, GOG) or a proprietary launcher (Ubisoft
   * Connect, EA App, Battle.net, Microsoft Store).
   *
   * Defaults to 100/100 (Steam captures ~all PC sales — most indie and
   * many AAA titles), which yields a neutral ×1.0 factor. Values are
   * fully admin-editable per publisher; there is no longer a fixed set of
   * preset profiles.
   */
  @Column({ type: 'float', default: 100 })
  steamSharePctLow: number;

  @Column({ type: 'float', default: 100 })
  steamSharePctHigh: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Game, (game) => game.publisherRecord)
  games: Game[];
}

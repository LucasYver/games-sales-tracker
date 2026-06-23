import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LauncherProfile } from './enums';
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
   * How representative Steam is of this publisher's PC sales. Used to
   * adjust calibration when Boxleiter/CCU on Steam would otherwise
   * undershoot the true PC total (Ubisoft Connect, EA App, Battle.net,
   * Microsoft Store, etc.).
   */
  @Column({
    type: 'enum',
    enum: LauncherProfile,
    default: LauncherProfile.STEAM_DOMINANT,
  })
  launcherProfile: LauncherProfile;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Game, (game) => game.publisherRecord)
  games: Game[];
}

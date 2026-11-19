import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SourceType } from './enums';
import { Game } from './game.entity';

@Entity('game_source')
@Unique(['source', 'externalId'])
export class GameSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: SourceType })
  source: SourceType;

  @Column()
  externalId: string;

  @Column({ type: 'varchar', nullable: true })
  url: string | null;

  // STEAM sources only: the game's community group (SteamID64). Its member
  // count is the game's followers. Looked up once by the followers cron.
  @Column({ type: 'varchar', nullable: true })
  steamClanId: string | null;

  // When the group was last looked up, found or not.
  @Column({ type: 'timestamptz', nullable: true })
  steamClanCheckedAt: Date | null;

  @ManyToOne(() => Game, (game) => game.sources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

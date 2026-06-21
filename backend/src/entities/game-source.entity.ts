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

  @ManyToOne(() => Game, (game) => game.sources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

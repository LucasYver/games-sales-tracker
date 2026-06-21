import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SignalMetric, SourceType } from './enums';
import { Game } from './game.entity';

@Entity('signal_snapshot')
@Index(['gameId', 'metric', 'capturedAt'])
export class SignalSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: SourceType })
  source: SourceType;

  @Column({ type: 'enum', enum: SignalMetric })
  metric: SignalMetric;

  @Column('int')
  value: number;

  @Column({ type: 'float', nullable: true })
  averageRating: number | null;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, (game) => game.signals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

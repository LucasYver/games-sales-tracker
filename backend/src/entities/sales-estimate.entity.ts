import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConfidenceLevel, Platform } from './enums';
import { Game } from './game.entity';

@Entity('sales_estimate')
@Index(['gameId', 'platform', 'computedAt'])
export class SalesEstimate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: Platform })
  platform: Platform;

  @Column('int')
  estimatedLow: number;

  @Column('int')
  estimatedHigh: number;

  @Column({ type: 'enum', enum: ConfidenceLevel })
  confidence: ConfidenceLevel;

  @Column()
  method: string;

  @CreateDateColumn()
  computedAt: Date;

  @ManyToOne(() => Game, (game) => game.estimates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

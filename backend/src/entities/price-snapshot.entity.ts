import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Game } from './game.entity';

/**
 * Point-in-time snapshot of a game's Steam store price, captured on a daily
 * cadence so price changes (sales, permanent drops) form a time series. All
 * monetary values are in the currency's minor units (cents) for the region
 * polled (currently USD).
 */
@Entity('price_snapshot')
@Index(['gameId', 'capturedAt'])
export class PriceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column('int')
  initial: number;

  @Column('int')
  final: number;

  @Column({ type: 'int', default: 0 })
  discountPercent: number;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

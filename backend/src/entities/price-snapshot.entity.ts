import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SourceType } from './enums';
import { Game } from './game.entity';

/**
 * Point-in-time snapshot of a store price for one country. Steam or Xbox
 * (`source`). Monetary values are in that currency's minor units.
 */
@Entity('price_snapshot')
@Index(['gameId', 'capturedAt'])
@Index(['gameId', 'country', 'capturedAt'])
@Index(['gameId', 'source', 'country', 'capturedAt'])
export class PriceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  gameId: string;

  @Column({
    type: 'enum',
    enum: SourceType,
    enumName: 'game_source_source_enum',
    default: SourceType.STEAM,
  })
  source: SourceType;

  @Column({ type: 'varchar', length: 2, default: 'us' })
  country: string;

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

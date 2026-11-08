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
// Review count per game for the public listing (MAX(value) as an index probe).
@Index('IDX_signal_snapshot_steam_reviews', ['gameId', 'value'], {
  where: `"metric" = 'STEAM_REVIEWS'`,
})
// Console store-rating counts for the same listing figure (all platforms summed).
@Index('IDX_signal_snapshot_store_ratings', ['gameId', 'metric', 'value'], {
  where: `"metric" IN ('PS_RATINGS', 'XBOX_RATINGS', 'SWITCH_RATINGS') AND NOT "synthetic"`,
})
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

  // True when this row is a reconstructed (synthetic) value rather than a real
  // scraped/polled measurement. Currently only PS_RATINGS points rebuilt from
  // the same game's Steam-review curve shape (see `ps-curve-reconstruction.ts`).
  // Excluded from every live read (Boxleiter estimate, platform shares, store-
  // rating display, backfill "already has data" checks); surfaced only as a
  // distinct series in admin charts. Calibration reconstructs on the fly and
  // does not read these rows.
  @Column({ type: 'boolean', default: false })
  synthetic: boolean;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, (game) => game.signals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

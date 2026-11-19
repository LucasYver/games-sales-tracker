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
  // scraped/polled measurement: monthly PS_RATINGS / XBOX_RATINGS points from
  // the console launch to the day before the first real snapshot, shaped on
  // the game's Steam reviews (`console-curve-reconstruction.ts`, written by
  // `IngestionService.rebuildConsoleRatingCurves`). For models and the admin
  // charts; every live estimate read filters on `synthetic = false`.
  @Column({ type: 'boolean', default: false })
  synthetic: boolean;

  @CreateDateColumn()
  capturedAt: Date;

  @ManyToOne(() => Game, (game) => game.signals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform } from './enums';
import { GameSource } from './game-source.entity';
import { SignalSnapshot } from './signal-snapshot.entity';
import { SalesEstimate } from './sales-estimate.entity';
import { SalesRecord } from './sales-record.entity';

@Entity('game')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'int', nullable: true })
  igdbId: number | null;

  @Index()
  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'timestamptz', nullable: true })
  releaseDate: Date | null;

  @Column({ type: 'varchar', nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  // Free-to-play games have no meaningful "units sold", so we never estimate
  // sales for them.
  @Column({ default: false })
  isFree: boolean;

  @Column({ type: 'enum', enum: Platform, array: true, default: '{}' })
  platforms: Platform[];

  @Column({ type: 'varchar', nullable: true })
  developer: string | null;

  @Column({ type: 'varchar', nullable: true })
  publisher: string | null;

  @Column({ type: 'simple-array', nullable: true })
  genres: string[] | null;

  // Per-platform Boxleiter multipliers (signal → units) derived from this
  // game's most reliable declared figure for each platform. When set, they
  // replace the generic default ranges so per-platform estimates are
  // calibrated to this specific title. Null until a trustworthy declared
  // figure with a contemporaneous signal snapshot exists for that platform.
  //   - calibratedMultiplier:     PC, units per Steam review
  //   - calibratedPsMultiplier:   PlayStation, units per PS Store rating
  //   - calibratedXboxMultiplier: Xbox, units per Xbox Store rating
  @Column({ type: 'float', nullable: true })
  calibratedMultiplier: number | null;

  @Column({ type: 'float', nullable: true })
  calibratedPsMultiplier: number | null;

  @Column({ type: 'float', nullable: true })
  calibratedXboxMultiplier: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => GameSource, (source) => source.game)
  sources: GameSource[];

  @OneToMany(() => SignalSnapshot, (signal) => signal.game)
  signals: SignalSnapshot[];

  @OneToMany(() => SalesEstimate, (estimate) => estimate.game)
  estimates: SalesEstimate[];

  @OneToMany(() => SalesRecord, (record) => record.game)
  salesRecords: SalesRecord[];
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GenreSource } from './enums';

/**
 * Granular taxonomy tag sourced from an external catalog (today: IGDB,
 * which is what `Game.genres` carries). This is classification/display
 * metadata only — genres no longer drive the estimation model (that
 * moved to the data-driven matcher).
 *
 * `externalId` is the catalog-side identifier (IGDB's numeric id),
 * scoped by `source`. We rely on the `(source, externalId)` pair for
 * idempotent upserts when re-syncing from IGDB.
 */
@Entity('genre')
@Index(['source', 'externalId'], {
  unique: true,
  where: '"externalId" IS NOT NULL',
})
export class Genre {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: GenreSource })
  source: GenreSource;

  @Column({ type: 'int', nullable: true })
  externalId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

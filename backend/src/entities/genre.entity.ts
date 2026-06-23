import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GenreSource } from './enums';
import { GenreProfile } from './genre-profile.entity';

/**
 * Granular taxonomy tag sourced from an external catalog (today: IGDB,
 * which is what `Game.genres` carries). Each genre points at most to
 * one `GenreProfile` — that mapping is what lets us turn a free-form
 * tag like "Role-playing (RPG)" into a numeric platform-split bucket
 * for estimation.
 *
 * `externalId` is the catalog-side identifier (IGDB's numeric id),
 * scoped by `source`. We rely on the `(source, externalId)` pair for
 * idempotent upserts when re-syncing from IGDB.
 *
 * Profiles are nullable on purpose: when we sync a brand-new IGDB
 * genre we couldn't auto-map, the row lands `profileId IS NULL` and
 * the admin assigns it later.
 */
@Entity('genre')
@Index(['source', 'externalId'], { unique: true, where: '"externalId" IS NOT NULL' })
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

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @ManyToOne(() => GenreProfile, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'profileId' })
  profile: GenreProfile | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

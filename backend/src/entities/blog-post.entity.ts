import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Game } from './game.entity';
import { BlogPostTranslation } from './blog-post-translation.entity';

export type BlogPostKind = 'GAME_SALES_FACTS';
export type BlogPostStatus = 'DRAFT' | 'PUBLISHED' | 'REJECTED';

@Entity('blog_post')
export class BlogPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  gameId: string | null;

  @ManyToOne(() => Game, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'gameId' })
  game: Game | null;

  @Column({ type: 'varchar', length: 32, default: 'GAME_SALES_FACTS' })
  kind: BlogPostKind;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status: BlogPostStatus;

  // Frozen facts the model was allowed to use. Admin-only; never rendered
  // verbatim on a public route.
  @Column({ type: 'jsonb' })
  factPack: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  // Set while the article is on the public blog. A post can be live and in
  // DRAFT at the same time: a refreshed draft is under review and the public
  // keeps reading `liveSnapshot` until it is published or rejected.
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // Last time the public text changed (publish, refresh, edit while live).
  // Drives `dateModified` and the sitemap — not bumped by admin bookkeeping.
  @Column({ type: 'timestamptz', nullable: true })
  contentUpdatedAt: Date | null;

  // Public content and fact pack of the live version while a refresh is in
  // review (see BlogLiveSnapshot). Null otherwise.
  @Column({ type: 'jsonb', nullable: true })
  liveSnapshot: Record<string, unknown> | null;

  // Fingerprint of the sourced figures an admin already chose not to act on
  // (refresh rejected), so the same change is not proposed every week.
  @Column({ type: 'text', nullable: true })
  staleAckFingerprint: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewEmailSentAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => BlogPostTranslation, (translation) => translation.post)
  translations: BlogPostTranslation[];
}

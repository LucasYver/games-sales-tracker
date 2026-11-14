import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialNetwork = 'THREADS';

export type SocialPostKind =
  // A blog article that just went live, with its link.
  | 'BLOG_ARTICLE'
  // Monday: the games trending on the site this week, with their estimates.
  | 'WEEKLY_TRENDS'
  // A new official GTA 6 sales figure, linking the GTA 6 sales page.
  | 'GTA6_FIGURE'
  // Monday: Modern Warfare 4's Steam reviews against Black Ops 7 and 6.
  | 'MW4_UPDATE';

export type SocialPostStatus = 'DRAFT' | 'PUBLISHED' | 'REJECTED';

/**
 * A post for the site's social accounts. Written as a DRAFT by the daily
 * `social-drafts` cron, published only when an admin clicks Publish.
 */
@Entity('social_post')
export class SocialPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'THREADS' })
  network: SocialNetwork;

  @Column({ type: 'varchar', length: 32 })
  kind: SocialPostKind;

  // What the post is about ("blog:<postId>", "trends:2026-11-16",
  // "gta6:<milestoneId>", "mw4:2026-11-16"), so it is drafted only once.
  @Index('UQ_social_post_topicKey', { unique: true })
  @Column({ type: 'varchar', length: 200 })
  topicKey: string;

  @Index('IDX_social_post_status')
  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status: SocialPostStatus;

  @Column({ type: 'text' })
  text: string;

  // Shown as the link preview under the post.
  @Column({ type: 'varchar', length: 500 })
  linkUrl: string;

  // The facts the writer was given, as code-written lines. Admin-only.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  facts: string[];

  // The same post for X: at most 280 characters and no link (a post with a
  // URL costs about 13 times more on the X API). Empty on drafts written
  // before X was added; Regenerate fills it.
  @Column({ type: 'text', default: '' })
  xText: string;

  // Numbers in `text` or `xText` that are not in `facts`; recounted on every
  // edit.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  unverifiedNumbers: string[];

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  // Threads id and URL once posted there.
  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  externalUrl: string | null;

  // X id and URL once posted there.
  @Column({ type: 'varchar', nullable: true })
  xExternalId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  xExternalUrl: string | null;

  // Set when the post is out on every configured network.
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // Last publish failure, kept so the admin sees why.
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * The access token of a social account. Threads tokens last 60 days and are
 * refreshed by the daily cron, so the current one lives here, seeded from
 * the `THREADS_ACCESS_TOKEN` env var the first time.
 */
@Entity('social_credential')
export class SocialCredential {
  @Column({ type: 'varchar', length: 16, primary: true })
  network: SocialNetwork;

  @Column({ type: 'text' })
  accessToken: string;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz' })
  refreshedAt: Date;
}

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BlogPost } from './blog-post.entity';

export type BlogLocale = 'en' | 'fr';

@Entity('blog_post_translation')
@Index(['postId', 'locale'], { unique: true })
@Index(['locale', 'slug'], { unique: true })
export class BlogPostTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  postId: string;

  @ManyToOne(() => BlogPost, (post) => post.translations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'postId' })
  post: BlogPost;

  @Column({ type: 'varchar', length: 8 })
  locale: BlogLocale;

  @Column({ type: 'varchar', length: 180 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 320 })
  metaDescription: string;

  @Column({ type: 'text' })
  excerpt: string;

  @Column({ type: 'jsonb' })
  tldr: string[];

  @Column({ type: 'text' })
  bodyMarkdown: string;

  @Column({ type: 'jsonb' })
  faq: { question: string; answer: string }[];

  @Column({ type: 'jsonb', default: [] })
  claims: { sentence: string; factIds: string[] }[];

  @Column({ type: 'jsonb', default: [] })
  reviewIssues: {
    severity: 'warning' | 'error';
    excerpt: string;
    problem: string;
    suggestion: string;
  }[];

  @Column({ type: 'jsonb', default: [] })
  unverifiedNumbers: string[];
}

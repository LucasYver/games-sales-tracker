import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SalesSource, SourceCategory } from './enums';

// A curated, trusted source of sales information (media outlet, analyst, X
// account, official channel). The registry drives the LLM extraction pipeline:
// only figures coming from a known source are trusted, each mapped to a sales
// tier and weighted by reliability.
@Entity('trusted_source')
export class TrustedSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: SourceCategory })
  category: SourceCategory;

  // Sales tier that figures from this source map to (e.g. an IR page yields
  // OFFICIAL, a press outlet yields MEDIA).
  @Column({ type: 'enum', enum: SalesSource })
  salesSource: SalesSource;

  // Web host used to match article URLs (e.g. "gamesindustry.biz"); null for
  // pure social accounts.
  @Column({ type: 'varchar', nullable: true })
  @Index()
  host: string | null;

  // X/social handle without the leading "@"; null for non-social sources.
  @Column({ type: 'varchar', nullable: true })
  handle: string | null;

  @Column({ type: 'varchar', nullable: true })
  url: string | null;

  // On-site search URL with a "{q}" placeholder (e.g.
  // "https://www.pcgamer.com/search/?searchTerm={q}"). Used by article
  // discovery to scrape the outlet's own search results. Null = not searchable.
  @Column({ type: 'varchar', nullable: true })
  searchUrlTemplate: string | null;

  // RSS/Atom feed URL polled by the continuous monitor to ingest new articles
  // as they publish. Null = no feed monitored.
  @Column({ type: 'varchar', nullable: true })
  feedUrl: string | null;

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  // Reliability weight, 1-100. Higher = more trustworthy.
  @Column({ type: 'int', default: 50 })
  weight: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // True when the row was inserted automatically by the ingestion pipeline
  // (a sales record arrived from a hostname that wasn't yet in the registry).
  // Auto-created rows default to tier=MEDIA / weight=40 so they get a usable
  // classification immediately; the admin can promote/demote them after review.
  @Column({ type: 'boolean', default: false })
  autoCreated: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

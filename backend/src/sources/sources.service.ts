import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrustedSource } from '../entities';
import { SeedSource, TRUSTED_SOURCES } from './sources.seed';

@Injectable()
export class SourcesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    @InjectRepository(TrustedSource)
    private readonly sources: Repository<TrustedSource>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  // Idempotently insert any curated source missing from the registry, and
  // backfill the on-site search template on existing rows that don't have one
  // yet (so the registry picks up newly-added templates). Other user edits are
  // left untouched.
  async seed(): Promise<void> {
    const existing = await this.sources.find();
    const bySlug = new Map(existing.map((s) => [s.slug, s]));

    const missing = TRUSTED_SOURCES.filter((s) => !bySlug.has(s.slug));
    if (missing.length > 0) {
      await this.sources.save(missing.map((s) => this.sources.create(s)));
      this.logger.log(`Seeded ${missing.length} trusted source(s).`);
    }

    const backfill = TRUSTED_SOURCES.filter((s) => {
      const row = bySlug.get(s.slug);
      if (!row) return false;
      return (
        (!row.searchUrlTemplate && s.searchUrlTemplate) ||
        (!row.feedUrl && s.feedUrl)
      );
    }).map((s) => {
      const row = bySlug.get(s.slug)!;
      row.searchUrlTemplate = row.searchUrlTemplate ?? s.searchUrlTemplate ?? null;
      row.feedUrl = row.feedUrl ?? s.feedUrl ?? null;
      return row;
    });
    if (backfill.length > 0) {
      await this.sources.save(backfill);
      this.logger.log(`Backfilled search/feed URLs on ${backfill.length} source(s).`);
    }
  }

  // Active sources that expose an on-site search template, used by article
  // discovery to scrape their own search results.
  searchableSources(): Promise<TrustedSource[]> {
    return this.sources
      .createQueryBuilder('s')
      .where('s.active = true')
      .andWhere('s.searchUrlTemplate IS NOT NULL')
      .orderBy('s.weight', 'DESC')
      .getMany();
  }

  // Active sources that expose an RSS/Atom feed, polled by the continuous
  // monitor to ingest new articles.
  feedSources(): Promise<TrustedSource[]> {
    return this.sources
      .createQueryBuilder('s')
      .where('s.active = true')
      .andWhere('s.feedUrl IS NOT NULL')
      .orderBy('s.weight', 'DESC')
      .getMany();
  }

  list(activeOnly = false): Promise<TrustedSource[]> {
    return this.sources.find({
      where: activeOnly ? { active: true } : {},
      order: { weight: 'DESC', name: 'ASC' },
    });
  }

  add(input: SeedSource & Partial<Pick<TrustedSource, 'active'>>): Promise<TrustedSource> {
    return this.sources.save(this.sources.create(input));
  }

  // Resolve a URL to a trusted source by matching its host against the
  // registry. Returns the most reliable matching active source, or null.
  async findByUrl(url: string): Promise<TrustedSource | null> {
    const host = this.extractHost(url);
    if (!host) return null;

    const candidates = await this.sources.find({
      where: { active: true },
      order: { weight: 'DESC' },
    });
    return (
      candidates.find(
        (s) =>
          s.host !== null &&
          (host === s.host || host.endsWith(`.${s.host}`)),
      ) ?? null
    );
  }

  private extractHost(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  }
}

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesSource, SourceCategory, TrustedSource } from '../entities';
import { SeedSource, TRUSTED_SOURCES } from './sources.seed';

// Default tier/weight applied to auto-created sources. MEDIA + 40 is the same
// fallback `ingestArticleFromText` used to hardcode for unknown hosts, so the
// behavior is unchanged from the record's perspective — the difference is that
// the host now becomes a visible, curatable row instead of being silently
// classified each time.
const AUTO_CREATED_TIER = SalesSource.MEDIA;
const AUTO_CREATED_CATEGORY = SourceCategory.MEDIA;
const AUTO_CREATED_WEIGHT = 40;

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

  /**
   * Resolve a URL to a trusted source, auto-creating an entry for the
   * hostname if no existing row matches. Auto-created rows default to
   * `tier=MEDIA / weight=40 / active=true / autoCreated=true` — the admin
   * can review them under the registry and adjust their tier or weight.
   *
   * URLs that don't parse to a valid hostname (rare; ingestion already
   * normalizes most URLs upstream) fall back to `findByUrl`, returning null.
   */
  async ensureForUrl(url: string): Promise<TrustedSource | null> {
    const existing = await this.findByUrl(url);
    if (existing) return existing;

    const host = this.extractHost(url);
    if (!host) return null;

    const slug = `auto-${host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    // Concurrency guard: two parallel refreshes can race on the same unknown
    // host. The `slug` column is `unique`, so we catch a duplicate-key error
    // and re-read.
    try {
      const row = this.sources.create({
        slug,
        name: host,
        category: AUTO_CREATED_CATEGORY,
        salesSource: AUTO_CREATED_TIER,
        host,
        handle: null,
        url: `https://${host}/`,
        searchUrlTemplate: null,
        feedUrl: null,
        language: 'en',
        weight: AUTO_CREATED_WEIGHT,
        active: true,
        autoCreated: true,
      });
      const saved = await this.sources.save(row);
      this.logger.log(
        `[sources] auto-created trusted source for "${host}" (tier=${AUTO_CREATED_TIER}, weight=${AUTO_CREATED_WEIGHT})`,
      );
      return saved;
    } catch {
      // Race lost — another request just created the same row. Re-read.
      return this.findByUrl(url);
    }
  }

  private extractHost(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  }
}

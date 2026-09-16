import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesSource, SourceCategory, TrustedSource } from '../entities';
import { SeedSource, TRUSTED_SOURCES } from './sources.seed';

// Default tier applied to auto-created sources. MEDIA is the same fallback
// `ingestArticleFromText` used to hardcode for unknown hosts, so the
// behavior is unchanged from the record's perspective — the difference is that
// the host now becomes a visible, curatable row instead of being silently
// classified each time.
const AUTO_CREATED_TIER = SalesSource.MEDIA;
const AUTO_CREATED_CATEGORY = SourceCategory.MEDIA;

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
      row.searchUrlTemplate =
        row.searchUrlTemplate ?? s.searchUrlTemplate ?? null;
      row.feedUrl = row.feedUrl ?? s.feedUrl ?? null;
      return row;
    });
    if (backfill.length > 0) {
      await this.sources.save(backfill);
      this.logger.log(
        `Backfilled search/feed URLs on ${backfill.length} source(s).`,
      );
    }
  }

  // Active sources that expose an RSS/Atom feed, polled by the continuous
  // monitor to ingest new articles.
  feedSources(): Promise<TrustedSource[]> {
    return this.sources
      .createQueryBuilder('s')
      .where('s.active = true')
      .andWhere('s.feedUrl IS NOT NULL')
      .orderBy('s.name', 'ASC')
      .getMany();
  }

  list(activeOnly = false): Promise<TrustedSource[]> {
    return this.sources.find({
      where: activeOnly ? { active: true } : {},
      order: { active: 'DESC', name: 'ASC' },
    });
  }

  add(
    input: SeedSource & Partial<Pick<TrustedSource, 'active'>>,
  ): Promise<TrustedSource> {
    return this.sources.save(this.sources.create(input));
  }

  // Resolve a URL to a trusted source by matching its host against the
  // registry. Returns the most reliable matching active source, or null.
  async findByUrl(url: string): Promise<TrustedSource | null> {
    const host = this.extractHost(url);
    if (!host) return null;

    const candidates = await this.sources.find({
      where: { active: true },
    });
    return this.matchHost(host, candidates);
  }

  // Hostnames of deactivated sources. Search/ingest must skip these so a
  // blacklist is not undone by Perplexity/Tavily/`ensureForUrl`.
  async listBlockedHosts(): Promise<string[]> {
    const rows = await this.sources.find({
      where: { active: false },
      select: ['host'],
    });
    return rows
      .map((s) => s.host)
      .filter((h): h is string => h != null && h.length > 0);
  }

  hostIsBlocked(host: string, blockedHosts: string[]): boolean {
    return blockedHosts.some(
      (blocked) => host === blocked || host.endsWith(`.${blocked}`),
    );
  }

  urlIsBlocked(url: string, blockedHosts: string[]): boolean {
    const host = this.extractHost(url);
    if (!host) return false;
    return this.hostIsBlocked(host, blockedHosts);
  }

  /**
   * Resolve a URL to a trusted source, auto-creating an entry for the
   * hostname if no existing row matches. Auto-created rows default to
   * `tier=MEDIA / active=true / autoCreated=true` — the admin
   * can review them under the registry and adjust their tier.
   *
   * Inactive (blacklisted) hosts are left untouched and return null so
   * ingestion cannot revive them.
   */
  async ensureForUrl(url: string): Promise<TrustedSource | null> {
    const existing = await this.findByUrl(url);
    if (existing) return existing;

    const host = this.extractHost(url);
    if (!host) return null;

    if (await this.isHostBlockedInRegistry(host)) return null;

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
        active: true,
        autoCreated: true,
      });
      const saved = await this.sources.save(row);
      this.logger.log(
        `[sources] auto-created trusted source for "${host}" (tier=${AUTO_CREATED_TIER})`,
      );
      return saved;
    } catch {
      // Race lost — another request just created the same row. Re-read.
      return this.findByUrl(url);
    }
  }

  extractHost(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  }

  private matchHost(
    host: string,
    candidates: TrustedSource[],
  ): TrustedSource | null {
    const withHost = candidates.filter((s) => s.host !== null);
    const exact = withHost.find((s) => host === s.host);
    if (exact) return exact;
    const suffixes = withHost
      .filter((s) => host.endsWith(`.${s.host}`))
      .sort((a, b) => (b.host?.length ?? 0) - (a.host?.length ?? 0));
    return suffixes[0] ?? null;
  }

  private async isHostBlockedInRegistry(host: string): Promise<boolean> {
    const blocked = await this.sources.find({
      where: { active: false },
      select: ['host'],
    });
    return this.hostIsBlocked(
      host,
      blocked
        .map((s) => s.host)
        .filter((h): h is string => h != null && h.length > 0),
    );
  }
}

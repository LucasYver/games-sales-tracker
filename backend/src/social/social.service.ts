import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SocialPost,
  type SocialPostKind,
  type SocialPostStatus,
} from '../entities';
import { GamesService } from '../games/games.service';
import { publicAppUrl } from '../blog/blog.types';
import {
  SocialWriterService,
  unverifiedNumbers,
} from './social-writer.service';
import { ThreadsClient } from './threads.client';
import { XClient } from './x.client';

/** Each network's own limit on a text post. */
const THREADS_MAX_CHARS = 500;
const X_LIMIT_CHARS = 280;
// Drafts written per cron run, and drafts left waiting before the cron stops
// writing new ones: posts lose their point in a few days.
const MAX_DRAFTS_PER_RUN = 3;
const MAX_PENDING_DRAFTS = 6;
// A blog article or a GTA 6 figure older than this is no longer news.
const NEWS_WINDOW_DAYS = 7;
// MW4 is compared while the launch is the story.
const MW4_MAX_AGE_DAYS = 180;
const TRENDS_COUNT = 5;

const GTA6_SLUG = 'grand-theft-auto-vi';
const MW4_SLUG = 'call-of-duty-modern-warfare-4';
const MW4_BENCHMARKS = [
  { name: 'Black Ops 7', slug: 'call-of-duty-black-ops-7' },
  { name: 'Black Ops 6', slug: 'call-of-duty-black-ops-6' },
];

const SOURCE_LABEL: Record<string, string> = {
  OFFICIAL: 'official figure from the publisher',
  ANNOUNCEMENT: 'official announcement',
  WIKIPEDIA: 'figure cited on Wikipedia',
  MEDIA: 'figure reported by the press or an analyst',
};

interface Candidate {
  kind: SocialPostKind;
  topicKey: string;
  facts: string[];
  linkUrl: string;
}

/**
 * Social posts (Threads, English): the daily cron drafts them from blog
 * articles, weekly trends, GTA 6 figures and the MW4 comparison; an admin
 * edits and publishes each one. Nothing is posted without that click.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @InjectRepository(SocialPost)
    private readonly posts: Repository<SocialPost>,
    private readonly games: GamesService,
    private readonly writer: SocialWriterService,
    private readonly threads: ThreadsClient,
    private readonly x: XClient,
  ) {}

  async list(status: SocialPostStatus, limit = 50) {
    const [rows, threadsReady] = await Promise.all([
      this.posts.find({
        where: { status },
        order:
          status === 'PUBLISHED'
            ? { publishedAt: 'DESC' }
            : { createdAt: 'DESC' },
        take: limit,
      }),
      this.threads.configured(),
    ]);
    return { posts: rows, threadsReady, xReady: this.x.configured };
  }

  async updateText(id: string, edit: { text?: string; xText?: string }) {
    const post = await this.requireDraft(id);
    if (edit.text !== undefined) post.text = edit.text.trim();
    if (edit.xText !== undefined) post.xText = edit.xText.trim();
    post.unverifiedNumbers = unverifiedNumbers(
      `${post.text}\n${post.xText}`,
      post.facts,
    );
    return this.posts.save(post);
  }

  /**
   * Posts the draft on every configured network it is not on yet (Threads,
   * then X). A network that fails keeps the post in DRAFT with the error, so
   * the next Publish retries only what is missing.
   */
  async publish(id: string, reviewedBy?: string, force = false) {
    const post = await this.requireDraft(id);
    const toThreads = !post.externalId;
    const toX = this.x.configured && !post.xExternalId;
    if (!toThreads && !toX) {
      throw new BadRequestException('No network left to post on.');
    }
    if (toThreads) {
      if (!post.text.trim())
        throw new BadRequestException('The post is empty.');
      if (post.text.length > THREADS_MAX_CHARS) {
        throw new BadRequestException(
          `Threads text: ${post.text.length} characters, the limit is ${THREADS_MAX_CHARS}.`,
        );
      }
    }
    if (toX) {
      if (!post.xText.trim()) {
        throw new BadRequestException(
          'The X version is empty. Write it, or click Regenerate.',
        );
      }
      if (post.xText.length > X_LIMIT_CHARS) {
        throw new BadRequestException(
          `X text: ${post.xText.length} characters, the limit is ${X_LIMIT_CHARS}.`,
        );
      }
    }
    if (post.unverifiedNumbers.length > 0 && !force) {
      throw new ConflictException(
        `Numbers not found in the facts: ${post.unverifiedNumbers.join(', ')}. Fix them, or confirm to publish anyway.`,
      );
    }

    const errors: string[] = [];
    if (toThreads) {
      try {
        const out = await this.threads.publishText(post.text, post.linkUrl);
        post.externalId = out.id;
        post.externalUrl = out.url;
      } catch (error) {
        errors.push(
          `Threads: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (toX) {
      try {
        const out = await this.x.publishText(post.xText, post.linkUrl);
        post.xExternalId = out.id;
        post.xExternalUrl = out.url;
      } catch (error) {
        errors.push(`X: ${error instanceof Error ? error.message : error}`);
      }
    }
    post.reviewedBy = reviewedBy ?? post.reviewedBy;
    post.lastError = errors.length ? errors.join(' | ') : null;
    const done =
      !!post.externalId && (!this.x.configured || !!post.xExternalId);
    if (done) {
      post.status = 'PUBLISHED';
      post.publishedAt = new Date();
    }
    await this.posts.save(post);
    if (errors.length) throw new BadRequestException(post.lastError);
    return post;
  }

  /** Rewrites a draft from its stored facts (one paid call, two at most). */
  async regenerate(id: string) {
    const post = await this.requireDraft(id);
    if (!this.writer.enabled) {
      throw new BadRequestException('OPENAI_API_KEY is not set.');
    }
    const { text, xText, unverifiedNumbers } = await this.writer.write(
      post.kind,
      post.facts,
    );
    post.text = text;
    post.xText = xText;
    post.unverifiedNumbers = unverifiedNumbers;
    post.model = this.writer.model;
    return this.posts.save(post);
  }

  async reject(id: string, reviewedBy?: string) {
    const post = await this.requireDraft(id);
    post.status = 'REJECTED';
    post.reviewedBy = reviewedBy ?? null;
    return this.posts.save(post);
  }

  /**
   * Daily: refresh the Threads token when due, then draft up to
   * MAX_DRAFTS_PER_RUN new posts. Returns the drafts to mail for review.
   */
  async runDailyDraftJob(): Promise<{
    notes: string[];
    written: SocialPost[];
  }> {
    const notes: string[] = [];
    try {
      notes.push(await this.threads.refreshTokenIfDue());
    } catch (error) {
      notes.push(String(error));
    }
    if (process.env.SOCIAL_DRAFTS === 'off') {
      return { notes: [...notes, 'SOCIAL_DRAFTS is off'], written: [] };
    }
    if (!this.writer.enabled) {
      return { notes: [...notes, 'OPENAI_API_KEY is not set'], written: [] };
    }
    const pending = await this.posts.count({ where: { status: 'DRAFT' } });
    if (pending >= MAX_PENDING_DRAFTS) {
      return { notes: [...notes, `${pending} drafts waiting`], written: [] };
    }

    const candidates = await this.candidates();
    const written: SocialPost[] = [];
    for (const candidate of candidates) {
      if (
        written.length >= MAX_DRAFTS_PER_RUN ||
        pending + written.length >= MAX_PENDING_DRAFTS
      ) {
        break;
      }
      try {
        written.push(await this.draft(candidate));
      } catch (error) {
        this.logger.warn(`Social draft ${candidate.topicKey} failed: ${error}`);
      }
    }
    return { notes, written };
  }

  private async draft(candidate: Candidate): Promise<SocialPost> {
    const { text, xText, unverifiedNumbers } = await this.writer.write(
      candidate.kind,
      candidate.facts,
    );
    return this.posts.save(
      this.posts.create({
        network: 'THREADS',
        kind: candidate.kind,
        topicKey: candidate.topicKey,
        status: 'DRAFT',
        text,
        xText,
        linkUrl: candidate.linkUrl,
        facts: candidate.facts,
        unverifiedNumbers,
        model: this.writer.model,
      }),
    );
  }

  /** Every post worth drafting today that has no row yet, newest news first. */
  private async candidates(): Promise<Candidate[]> {
    const monday = new Date().getUTCDay() === 1;
    const today = new Date().toISOString().slice(0, 10);
    const found = (
      await Promise.all([
        this.gta6Candidates(),
        this.blogCandidates(),
        monday ? this.trendsCandidate(today) : null,
        monday ? this.mw4Candidate(today) : null,
      ])
    )
      .flat()
      .filter((c): c is Candidate => c !== null);
    if (found.length === 0) return [];
    const taken: { topicKey: string }[] = await this.posts.query(
      `SELECT "topicKey" FROM social_post WHERE "topicKey" = ANY($1)`,
      [found.map((c) => c.topicKey)],
    );
    const done = new Set(taken.map((r) => r.topicKey));
    return found.filter((c) => !done.has(c.topicKey));
  }

  private async blogCandidates(): Promise<Candidate[]> {
    const rows: {
      id: string;
      slug: string;
      title: string;
      excerpt: string;
      tldr: string[];
    }[] = await this.posts.query(
      `SELECT bp.id, t.slug, t.title, t.excerpt, t.tldr
         FROM blog_post bp
         JOIN blog_post_translation t ON t."postId" = bp.id AND t.locale = 'en'
        WHERE bp."publishedAt" IS NOT NULL
          AND bp.status <> 'REJECTED'
          AND bp."publishedAt" >= NOW() - make_interval(days => $1)
        ORDER BY bp."publishedAt" DESC`,
      [NEWS_WINDOW_DAYS],
    );
    return rows.map((row) => ({
      kind: 'BLOG_ARTICLE' as const,
      topicKey: `blog:${row.id}`,
      linkUrl: `${publicAppUrl()}/en/blog/${row.slug}`,
      facts: [
        `Article title: ${row.title}`,
        `Article summary: ${row.excerpt}`,
        ...(row.tldr ?? []).map((line) => `Key point: ${line}`),
      ],
    }));
  }

  private async gta6Candidates(): Promise<Candidate[]> {
    const rows: {
      id: string;
      units: number;
      source: string;
      publisher: string | null;
      reportedAt: Date | null;
      release: Date | null;
    }[] = await this.posts.query(
      `SELECT m.id, m.units, m.source, m.publisher, m."reportedAt",
              g."releaseDate" AS release
         FROM milestone m
         JOIN game g ON g.id = m."gameId"
        WHERE g.slug = $1 AND g."deletedAt" IS NULL
          AND m."rejectedAt" IS NULL
          AND NOT m."isEngagement" AND NOT m."isEstimate"
          AND m.platform = 'GLOBAL'
          AND m.source IN ('OFFICIAL', 'ANNOUNCEMENT', 'WIKIPEDIA', 'MEDIA')
          AND m."capturedAt" >= NOW() - make_interval(days => $2)
        ORDER BY m."reportedAt" DESC NULLS LAST, m.units DESC
        LIMIT 1`,
      [GTA6_SLUG, NEWS_WINDOW_DAYS],
    );
    return rows.map((row) => {
      const facts = [
        `Grand Theft Auto VI (GTA 6): ${compact(Number(row.units))} copies sold worldwide`,
        `Source: ${SOURCE_LABEL[row.source] ?? 'reported figure'}${row.publisher ? `, credited to ${row.publisher}` : ''}`,
      ];
      if (row.reportedAt) {
        facts.push(`Reported on ${longDate(row.reportedAt)}`);
        if (row.release) {
          const days = Math.round(
            (new Date(row.reportedAt).getTime() -
              new Date(row.release).getTime()) /
              86_400_000,
          );
          if (days >= 0) facts.push(`${days} days after the console launch`);
        }
      }
      facts.push(
        'The linked page tracks every official GTA 6 figure against GTA V and Red Dead Redemption 2 over their first weeks',
      );
      return {
        kind: 'GTA6_FIGURE' as const,
        topicKey: `gta6:${row.id}`,
        linkUrl: `${publicAppUrl()}/en/gta-6-sales`,
        facts,
      };
    });
  }

  private async trendsCandidate(today: string): Promise<Candidate | null> {
    const { items } = await this.games.listPopular({
      sort: 'trending',
      status: 'released',
      limit: 15,
    });
    const top = items
      .filter((g) => !g.isFree && (g.estimatedUnits ?? 0) > 0)
      .slice(0, TRENDS_COUNT);
    if (top.length < 3) return null;
    return {
      kind: 'WEEKLY_TRENDS',
      topicKey: `trends:${today}`,
      linkUrl: `${publicAppUrl()}/en`,
      facts: top.map(
        (g, i) =>
          `#${i + 1} trending: ${g.name}${g.releaseDate ? ` (released ${monthYear(g.releaseDate)})` : ''}, estimated ${compact(g.estimatedUnits!)} copies sold (site estimate, not an official figure)`,
      ),
    };
  }

  private async mw4Candidate(today: string): Promise<Candidate | null> {
    const [mw4, ...benchmarks] = await Promise.all(
      [MW4_SLUG, ...MW4_BENCHMARKS.map((b) => b.slug)].map((slug) =>
        this.games.getSteamReviewCurve(slug).catch(() => null),
      ),
    );
    const last = mw4?.points.at(-1);
    if (!last || last.day > MW4_MAX_AGE_DAYS) return null;
    const facts = [
      `Activision publishes no sales figure for Call of Duty: Modern Warfare 4`,
      `Modern Warfare 4: ${last.reviews.toLocaleString('en-US')} Steam reviews, ${last.day} days after its PC launch`,
    ];
    MW4_BENCHMARKS.forEach((benchmark, i) => {
      const cmp = sameAge(mw4!.points, benchmarks[i]?.points ?? []);
      if (!cmp) return;
      facts.push(
        `${benchmark.name} had ${cmp.benchmark.reviews.toLocaleString('en-US')} Steam reviews ${cmp.benchmark.day} days after its launch; Modern Warfare 4 had ${cmp.mw4.reviews.toLocaleString('en-US')} at day ${cmp.mw4.day}, ${Math.round(cmp.ratio * 100)}% of it`,
      );
    });
    if (facts.length < 3) return null;
    facts.push('Steam reviews measure popularity on PC, not sales');
    return {
      kind: 'MW4_UPDATE',
      topicKey: `mw4:${today}`,
      linkUrl: `${publicAppUrl()}/en/mw4-sales`,
      facts,
    };
  }

  private async requireDraft(id: string): Promise<SocialPost> {
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Social post not found');
    if (post.status !== 'DRAFT') {
      throw new BadRequestException(`This post is ${post.status}.`);
    }
    return post;
  }
}

type Point = { day: number; reviews: number };

/** Same rule as the MW4 page (`frontend/src/lib/mw4.ts`). */
function sameAge(mw4: Point[], benchmark: Point[]) {
  const age = mw4.at(-1)?.day;
  if (age == null) return null;
  const atOrBefore = (points: Point[], day: number) =>
    points.filter((p) => p.day <= day).at(-1) ?? null;
  const b = atOrBefore(benchmark, age);
  if (!b || b.reviews <= 0) return null;
  const m = atOrBefore(mw4, b.day);
  if (!m) return null;
  return { mw4: m, benchmark: b, ratio: m.reviews / b.reviews };
}

function compact(units: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(units);
}

function longDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function monthYear(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

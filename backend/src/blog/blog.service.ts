import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import {
  BlogLocale,
  BlogPost,
  BlogPostKind,
  BlogPostStatus,
  BlogPostTranslation,
} from '../entities';
import { BlogCandidateService } from './blog-candidate.service';
import {
  BlogFactPackService,
  compareFacts,
  factsFingerprint,
  figuresAsOf,
  publicFigures,
} from './blog-fact-pack.service';
import {
  findUnverifiedNumbers,
  packNames,
  isComputedIssue,
  repeatedFigureIssues,
} from './blog-number-check';
import { BlogWriterService } from './blog-writer.service';
import { notifyIndexNow } from '../common/indexnow';
import {
  blogSlug,
  hasSalesTableMarker,
  packKind,
  packSubjectName,
  publicAppUrl,
} from './blog.types';
import type {
  BlogFactPack,
  BlogFreshness,
  BlogLiveSnapshot,
  BlogRankingSubject,
  BlogReviewIssue,
} from './blog.types';

/** Articles that stay relevant and get refreshed when their figures change. */
const EVERGREEN_KINDS: BlogPostKind[] = ['GAME_SALES_FACTS', 'SALES_RANKING'];
/** Timely posts from the daily cron. */
const TIMELY_KINDS: BlogPostKind[] = ['SALES_NEWS', 'LAUNCH_REPORT'];
/**
 * Stop writing timely drafts while this many wait for review: a news item
 * nobody reads is money spent for nothing.
 */
const MAX_PENDING_TIMELY_DRAFTS = 5;

export type GenerateBlogFormatInput =
  | { kind: 'SALES_NEWS'; milestoneId: string }
  | { kind: 'LAUNCH_REPORT'; gameId: string }
  | {
      kind: 'SALES_RANKING';
      subjectType: BlogRankingSubject['type'];
      subjectKey: string;
    };

type PublicContent = BlogLiveSnapshot['translations'][string];

export interface UpdateBlogTranslationInput {
  title?: string;
  metaDescription?: string;
  excerpt?: string;
  tldr?: string[];
  bodyMarkdown?: string;
  faq?: { question: string; answer: string }[];
}

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    @InjectRepository(BlogPost)
    private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogPostTranslation)
    private readonly translations: Repository<BlogPostTranslation>,
    private readonly factPacks: BlogFactPackService,
    private readonly writer: BlogWriterService,
    private readonly candidates: BlogCandidateService,
  ) {}

  listCandidates(limit?: number) {
    return this.candidates.list(limit);
  }

  async listFormatCandidates() {
    const [news, launches, rankings] = await Promise.all([
      this.candidates.newsCandidates(),
      this.candidates.launchCandidates(),
      this.candidates.rankingCandidates(),
    ]);
    return { news, launches, rankings };
  }

  async list(status: BlogPostStatus, limit = 30, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(offset, 0);
    const [rows, total] = await this.posts.findAndCount({
      where: { status },
      relations: { translations: true, game: true },
      order: { updatedAt: 'DESC' },
      take,
      skip,
    });
    const items = await Promise.all(
      rows.map(async (row) => ({
        ...this.toAdminSummary(row),
        freshness: await this.freshness(row),
      })),
    );
    return { items, total };
  }

  async getAdmin(id: string) {
    const post = await this.requirePost(id);
    return {
      ...this.toAdminDetail(post),
      freshness: await this.freshness(post),
    };
  }

  /**
   * Whether a live article still matches the sourced figures on file: a new
   * milestone, an edited one, or one rejected since the article was written.
   */
  async freshness(post: BlogPost): Promise<BlogFreshness | null> {
    if (!isLive(post)) return null;
    const pack = post.factPack as unknown as BlogFactPack;
    const current = await this.currentFacts(post);
    if (!current) return null;
    const diff = compareFacts(pack.facts ?? [], current);
    const changed = diff.added.length + diff.removed.length > 0;
    const acknowledged =
      post.staleAckFingerprint != null &&
      post.staleAckFingerprint === factsFingerprint(current);
    return { stale: changed && !acknowledged, ...diff };
  }

  async listPublic(locale: BlogLocale, limit = 20, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.max(offset, 0);
    const [rows, total] = await this.translations
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.post', 'p')
      .leftJoinAndSelect('p.game', 'g')
      .where('p.publishedAt IS NOT NULL')
      .andWhere("p.status <> 'REJECTED'")
      .andWhere('t.locale = :locale', { locale })
      .orderBy('p.publishedAt', 'DESC')
      .take(take)
      .skip(skip)
      .getManyAndCount();
    const items = rows.flatMap((t) => {
      const content = publicContent(t.post, t);
      if (!content) return [];
      return [
        {
          slug: t.slug,
          title: content.title,
          excerpt: content.excerpt,
          publishedAt: t.post.publishedAt,
          kind: t.post.kind,
          coverUrl: postCoverUrl(t.post),
          game: t.post.game
            ? {
                name: t.post.game.name,
                slug: t.post.game.slug,
                coverUrl: t.post.game.coverUrl,
              }
            : null,
        },
      ];
    });
    return { items, total };
  }

  async getPublic(locale: BlogLocale, slug: string) {
    const translation = await this.translations.findOne({
      where: { locale, slug },
      relations: { post: { translations: true, game: true } },
    });
    const post = translation?.post;
    const content = translation && post && publicContent(post, translation);
    if (!translation || !post || !content) {
      throw new NotFoundException(`Blog post ${locale}/${slug} not found`);
    }
    const alternate = post.translations.find((t) => t.locale !== locale);
    return {
      slug: translation.slug,
      locale: translation.locale,
      kind: post.kind,
      coverUrl: postCoverUrl(post),
      title: content.title,
      metaDescription: content.metaDescription,
      excerpt: content.excerpt,
      tldr: content.tldr,
      bodyMarkdown: content.bodyMarkdown,
      faq: content.faq,
      publishedAt: post.publishedAt,
      updatedAt: post.contentUpdatedAt ?? post.publishedAt,
      figuresAsOf: figuresAsOf(livePack(post)),
      // Table + cards rendered by the page; null on articles written before.
      figures: hasSalesTableMarker(content.bodyMarkdown)
        ? publicFigures(livePack(post))
        : null,
      game: post.game
        ? {
            name: post.game.name,
            slug: post.game.slug,
            coverUrl: post.game.coverUrl,
          }
        : null,
      alternate: alternate
        ? { locale: alternate.locale, slug: alternate.slug }
        : null,
    };
  }

  async listSitemap() {
    const rows = await this.posts.find({
      where: { publishedAt: Not(IsNull()), status: Not('REJECTED') },
      relations: { translations: true },
      order: { publishedAt: 'DESC' },
    });
    return {
      items: rows.flatMap((post) =>
        post.translations.map((t) => ({
          locale: t.locale,
          slug: t.slug,
          publishedAt: post.publishedAt,
          updatedAt: post.contentUpdatedAt ?? post.publishedAt,
          alternateSlug: post.translations.find((o) => o.locale !== t.locale)
            ?.slug,
        })),
      ),
    };
  }

  /**
   * Writes a new EN/FR draft for a game. On a live article the public keeps
   * the current version (`liveSnapshot`) until the new draft is published.
   */
  async generateForGame(gameId: string) {
    const pack = await this.factPacks.buildForGame(gameId);
    if (this.factPacks.salesFacts(pack).length < 1) {
      throw new BadRequestException(
        'This game has no sourced sales figures to write about.',
      );
    }
    const existing = await this.posts.findOne({
      where: { gameId, kind: 'GAME_SALES_FACTS' },
      relations: { translations: true },
    });
    return this.writeDraft(pack, existing);
  }

  /** Writes a news item, launch report or ranking. Same review flow. */
  async generateFormat(input: GenerateBlogFormatInput) {
    const pack = await this.buildFormatPack(input);
    const existing = await this.posts.findOne({
      where: { topicKey: pack.topicKey },
      relations: { translations: true },
    });
    return this.writeDraft(pack, existing);
  }

  /** Rewrites a post from today's data, whatever its format. */
  async regenerate(id: string) {
    const post = await this.requirePost(id);
    const pack = post.factPack as unknown as BlogFactPack;
    switch (post.kind) {
      case 'SALES_NEWS':
        if (!pack.news) break;
        return this.generateFormat({
          kind: 'SALES_NEWS',
          milestoneId: pack.news.milestoneId,
        });
      case 'LAUNCH_REPORT':
        if (!post.gameId) break;
        return this.generateFormat({
          kind: 'LAUNCH_REPORT',
          gameId: post.gameId,
        });
      case 'SALES_RANKING':
        if (!pack.ranking) break;
        return this.generateFormat({
          kind: 'SALES_RANKING',
          subjectType: pack.ranking.subject.type,
          subjectKey: pack.ranking.subject.key,
        });
      default:
        if (!post.gameId) break;
        return this.generateForGame(post.gameId);
    }
    throw new BadRequestException(
      'This post no longer has what it needs to be regenerated.',
    );
  }

  private async buildFormatPack(
    input: GenerateBlogFormatInput,
  ): Promise<BlogFactPack> {
    switch (input.kind) {
      case 'SALES_NEWS':
        return this.factPacks.buildNewsPack(input.milestoneId);
      case 'SALES_RANKING':
        return this.factPacks.buildRankingPack(
          input.subjectType,
          input.subjectKey,
        );
      case 'LAUNCH_REPORT': {
        const pack = await this.factPacks.buildLaunchPack(input.gameId);
        if (!pack.facts.some((f) => f.kind === 'signal')) {
          throw new BadRequestException(
            'This game has no popularity data to report yet.',
          );
        }
        return pack;
      }
    }
  }

  private async writeDraft(pack: BlogFactPack, existing: BlogPost | null) {
    const [en, fr] = await Promise.all([
      this.writer.writeLocale('en', pack),
      this.writer.writeLocale('fr', pack),
    ]);
    const gameId = pack.game?.id ?? null;

    try {
      const postId = await this.posts.manager.transaction(async (em) => {
        const posts = em.getRepository(BlogPost);
        const translations = em.getRepository(BlogPostTranslation);
        const post =
          existing ??
          posts.create({
            gameId,
            kind: packKind(pack),
            topicKey: pack.topicKey ?? null,
            status: 'DRAFT',
            factPack: pack as unknown as Record<string, unknown>,
          });

        if (existing?.status === 'PUBLISHED') {
          post.liveSnapshot = snapshotOf(existing) as unknown as Record<
            string,
            unknown
          >;
        } else if (!existing || !isLive(existing)) {
          post.publishedAt = null;
          post.liveSnapshot = null;
        }
        // else: a refresh already in review keeps the live version it saved.

        post.status = 'DRAFT';
        post.factPack = pack as unknown as Record<string, unknown>;
        post.model = en.model;
        post.generatedAt = new Date();
        post.reviewEmailSentAt = null;
        post.reviewedBy = null;
        post.rejectReason = null;
        const saved = await posts.save(post);

        await translations.delete({ postId: saved.id });
        await translations.save([
          this.toTranslationRow(saved.id, 'en', pack, en),
          this.toTranslationRow(saved.id, 'fr', pack, fr),
        ]);
        return saved.id;
      });
      return this.getAdmin(postId);
    } catch (error) {
      this.logger.error(
        `Failed to persist blog draft for ${packSubjectName(pack)}`,
        error instanceof Error ? error.stack : String(error),
      );
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(
          `Could not save the EN/FR articles: ${error.message}`,
        );
      }
      throw error;
    }
  }

  async updateTranslation(
    id: string,
    locale: BlogLocale,
    input: UpdateBlogTranslationInput,
  ) {
    const post = await this.posts.findOne({ where: { id } });
    const row = await this.translations.findOne({
      where: { postId: id, locale },
    });
    if (!post || !row) {
      throw new NotFoundException(`Translation ${locale} not found`);
    }
    if (input.title != null) row.title = input.title.slice(0, 200);
    if (input.metaDescription != null) {
      row.metaDescription = input.metaDescription.slice(0, 320);
    }
    if (input.excerpt != null) row.excerpt = input.excerpt;
    if (input.tldr != null) row.tldr = input.tldr;
    if (input.bodyMarkdown != null) row.bodyMarkdown = input.bodyMarkdown;
    if (input.faq != null) row.faq = input.faq;

    // Re-check the edited text: a number typed by hand gets the same scrutiny
    // as the writer's, repeated figures are recounted, and editor notes about
    // text that is gone are dropped.
    const pack = post.factPack as unknown as BlogFactPack;
    row.unverifiedNumbers = findUnverifiedNumbers(
      row,
      pack.facts ?? [],
      packNames(pack),
    );
    row.reviewIssues = [
      ...repeatedFigureIssues(row.bodyMarkdown, pack.facts ?? []),
      ...issuesStillInText(row.reviewIssues ?? [], row).filter(
        (issue) => !isComputedIssue(issue),
      ),
    ];
    await this.translations.save(row);

    if (post.status === 'PUBLISHED') {
      await this.posts.update({ id }, { contentUpdatedAt: new Date() });
    }
    return this.getAdmin(id);
  }

  async publish(id: string, reviewedBy?: string, force = false) {
    const post = await this.requirePost(id);
    if (post.status === 'PUBLISHED') return this.getAdmin(id);
    if (post.status === 'REJECTED') {
      throw new BadRequestException(
        'This draft was rejected. Regenerate it to get a new draft.',
      );
    }
    if (post.translations.length < 2) {
      throw new BadRequestException(
        'Both FR and EN translations are required.',
      );
    }
    for (const t of post.translations) {
      if (!t.title.trim() || !t.bodyMarkdown.trim()) {
        throw new BadRequestException(`${t.locale} translation is empty.`);
      }
    }
    const unverified = post.translations.reduce(
      (n, t) => n + (t.unverifiedNumbers?.length ?? 0),
      0,
    );
    const errors = post.translations.reduce(
      (n, t) =>
        n + (t.reviewIssues ?? []).filter((i) => i.severity === 'error').length,
      0,
    );
    if ((unverified > 0 || errors > 0) && !force) {
      throw new ConflictException(
        `${unverified} unverified number(s) and ${errors} fact-check error(s) remain. Fix them, or confirm to publish anyway.`,
      );
    }

    // A news item stands on one figure: it must not go out once that is gone.
    const newsPack = post.factPack as unknown as BlogFactPack;
    if (
      post.kind === 'SALES_NEWS' &&
      newsPack.news &&
      !force &&
      !(await this.factPacks.newsFigureOnFile(newsPack.news.milestoneId))
    ) {
      throw new ConflictException(
        'The figure this news item relays has been rejected. Reject this draft, or confirm to publish anyway.',
      );
    }

    const now = new Date();
    post.status = 'PUBLISHED';
    post.publishedAt = post.publishedAt ?? now;
    post.contentUpdatedAt = now;
    post.liveSnapshot = null;
    post.staleAckFingerprint = null;
    post.reviewedBy = reviewedBy ?? post.reviewedBy;
    post.rejectReason = null;
    await this.posts.save(post);
    await notifyIndexNow(
      post.translations.map(
        (t) => `${publicAppUrl()}/${t.locale}/blog/${t.slug}`,
      ),
    );
    return this.getAdmin(id);
  }

  async reject(id: string, reason: string | undefined, reviewedBy?: string) {
    const post = await this.requirePost(id);
    const snapshot = post.liveSnapshot as unknown as BlogLiveSnapshot | null;
    if (snapshot && isLive(post)) {
      await this.discardRefresh(post, snapshot, reviewedBy);
      this.logger.log(
        `Blog refresh for ${post.gameId} rejected${reason ? `: ${reason}` : ''}; live version kept.`,
      );
      return this.getAdmin(id);
    }
    post.status = 'REJECTED';
    post.publishedAt = null;
    post.liveSnapshot = null;
    post.rejectReason = reason?.trim() || null;
    post.reviewedBy = reviewedBy ?? post.reviewedBy;
    await this.posts.save(post);
    return this.getAdmin(id);
  }

  async unpublish(id: string) {
    const post = await this.requirePost(id);
    post.status = 'DRAFT';
    post.publishedAt = null;
    post.liveSnapshot = null;
    post.staleAckFingerprint = null;
    await this.posts.save(post);
    return this.getAdmin(id);
  }

  async markReviewEmailSent(id: string) {
    await this.posts.update({ id }, { reviewEmailSentAt: new Date() });
  }

  async pendingDrafts() {
    const rows = await this.posts.find({
      where: { status: 'DRAFT' },
      relations: { translations: true, game: true },
      order: { generatedAt: 'DESC' },
    });
    return rows.map((row) => this.toAdminSummary(row));
  }

  /** Oldest live article whose sourced figures changed since it was written. */
  async firstStaleLivePost(): Promise<BlogPost | null> {
    const rows = await this.posts.find({
      where: { status: 'PUBLISHED', kind: In(EVERGREEN_KINDS) },
      relations: { game: true },
      order: { contentUpdatedAt: 'ASC' },
    });
    for (const row of rows) {
      if ((await this.freshness(row))?.stale) return row;
    }
    return null;
  }

  async runWeeklyDraftJob(): Promise<{
    action: 'generated' | 'refreshed' | 'digest' | 'skipped';
    reason?: string;
    postId?: string;
    gameName?: string;
    drafts: ReturnType<BlogService['toAdminSummary']>[];
  }> {
    const drafts = await this.pendingDrafts();
    // Timely drafts have their own daily job and do not hold this one back.
    if (drafts.some((draft) => EVERGREEN_KINDS.includes(draft.kind))) {
      return { action: 'digest', drafts };
    }
    if (!this.writer.enabled) {
      return {
        action: 'skipped',
        reason: 'OPENAI_API_KEY is not set',
        drafts: [],
      };
    }
    // A live article with outdated figures comes before a new one.
    const stale = await this.firstStaleLivePost();
    if (stale) {
      const post = await this.regenerate(stale.id);
      return {
        action: 'refreshed',
        postId: post.id,
        gameName: post.gameName ?? undefined,
        drafts: [post],
      };
    }
    const post = await this.writeNextEvergreen();
    if (!post) {
      return { action: 'skipped', reason: 'no eligible candidate', drafts: [] };
    }
    return {
      action: 'generated',
      postId: post.id,
      gameName: post.gameName ?? undefined,
      drafts: [post],
    };
  }

  /**
   * Still one evergreen draft a week: game articles and rankings take turns,
   * so rankings do not add to this job's AI spend.
   */
  private async writeNextEvergreen() {
    const last = await this.posts.findOne({
      where: { kind: In(EVERGREEN_KINDS) },
      order: { createdAt: 'DESC' },
      select: { id: true, kind: true },
    });
    const writeGame = async () => {
      const pick = await this.candidates.pickBest();
      return pick ? this.generateForGame(pick.gameId) : null;
    };
    const writeRanking = async () => {
      const [pick] = await this.candidates.rankingCandidates(1);
      return pick
        ? this.generateFormat({
            kind: 'SALES_RANKING',
            subjectType: pick.subjectType,
            subjectKey: pick.subjectKey,
          })
        : null;
    };
    return last?.kind === 'GAME_SALES_FACTS'
      ? ((await writeRanking()) ?? (await writeGame()))
      : ((await writeGame()) ?? (await writeRanking()));
  }

  /**
   * Daily: at most one news item and one launch report, while few drafts wait
   * for review. Never publishes. Turn off with BLOG_DAILY_DRAFTS=off.
   */
  async runDailyDraftJob(): Promise<{
    skipped?: string;
    written: Awaited<ReturnType<BlogService['generateFormat']>>[];
  }> {
    if (process.env.BLOG_DAILY_DRAFTS === 'off') {
      return { skipped: 'BLOG_DAILY_DRAFTS is off', written: [] };
    }
    if (!this.writer.enabled) {
      return { skipped: 'OPENAI_API_KEY is not set', written: [] };
    }
    const pending = await this.posts.count({
      where: { status: 'DRAFT', kind: In(TIMELY_KINDS) },
    });
    if (pending >= MAX_PENDING_TIMELY_DRAFTS) {
      return { skipped: `${pending} timely drafts waiting`, written: [] };
    }

    const [news, launches] = await Promise.all([
      this.candidates.newsCandidates(),
      this.candidates.launchCandidates(1),
    ]);
    const written: Awaited<ReturnType<BlogService['generateFormat']>>[] = [];
    for (const candidate of news) {
      try {
        written.push(
          await this.generateFormat({
            kind: 'SALES_NEWS',
            milestoneId: candidate.milestoneId,
          }),
        );
        break;
      } catch (error) {
        // A figure that turns out to be a relay costs nothing: try the next.
        if (error instanceof BadRequestException) continue;
        this.logger.warn(`Sales news draft failed: ${error}`);
        break;
      }
    }
    if (launches[0] && pending + written.length < MAX_PENDING_TIMELY_DRAFTS) {
      try {
        written.push(
          await this.generateFormat({
            kind: 'LAUNCH_REPORT',
            gameId: launches[0].gameId,
          }),
        );
      } catch (error) {
        this.logger.warn(`Launch report draft failed: ${error}`);
      }
    }
    return { written };
  }

  /** Rejecting a refresh puts the live version back and remembers the change. */
  private async discardRefresh(
    post: BlogPost,
    snapshot: BlogLiveSnapshot,
    reviewedBy?: string,
  ) {
    const current = (await this.currentFacts(post)) ?? [];
    await this.posts.manager.transaction(async (em) => {
      const translations = em.getRepository(BlogPostTranslation);
      for (const row of post.translations) {
        const live = snapshot.translations[row.locale];
        if (!live) continue;
        Object.assign(row, live);
        await translations.save(row);
      }
      await em.getRepository(BlogPost).update(
        { id: post.id },
        {
          status: 'PUBLISHED',
          factPack: snapshot.factPack as never,
          model: snapshot.model,
          generatedAt: snapshot.generatedAt
            ? new Date(snapshot.generatedAt)
            : null,
          liveSnapshot: null,
          staleAckFingerprint: factsFingerprint(current),
          reviewedBy: reviewedBy ?? post.reviewedBy,
          rejectReason: null,
        },
      );
    });
  }

  /** Today's figures for an evergreen post; null for point-in-time posts. */
  private async currentFacts(post: BlogPost) {
    const pack = post.factPack as unknown as BlogFactPack;
    if (post.kind === 'SALES_RANKING' && pack.ranking) {
      return this.factPacks.currentRankingFacts(pack.ranking.subject);
    }
    if (post.kind === 'GAME_SALES_FACTS' && post.gameId) {
      return this.factPacks.currentMilestoneFacts(post.gameId, post.game ?? {});
    }
    return null;
  }

  private async requirePost(id: string): Promise<BlogPost> {
    const post = await this.posts.findOne({
      where: { id },
      relations: { translations: true, game: true },
    });
    if (!post) throw new NotFoundException(`Blog post ${id} not found`);
    return post;
  }

  private toTranslationRow(
    postId: string,
    locale: BlogLocale,
    pack: BlogFactPack,
    result: Awaited<ReturnType<BlogWriterService['writeLocale']>>,
  ): BlogPostTranslation {
    return this.translations.create({
      postId,
      locale,
      slug: clip(result.article.slug || blogSlug(pack, locale), 180),
      title: clip(result.article.title || packSubjectName(pack), 200),
      metaDescription: clip(result.article.metaDescription, 320),
      excerpt: result.article.excerpt ?? '',
      tldr: asStringArray(result.article.tldr),
      bodyMarkdown: result.article.bodyMarkdown ?? '',
      faq: Array.isArray(result.article.faq) ? result.article.faq : [],
      claims: result.article.claims ?? [],
      reviewIssues: result.issues ?? [],
      unverifiedNumbers: result.unverifiedNumbers ?? [],
    });
  }

  toAdminSummary(post: BlogPost) {
    const issueCount = (post.translations ?? []).reduce(
      (n, t) => n + (t.reviewIssues?.length ?? 0),
      0,
    );
    const errorCount = (post.translations ?? []).reduce(
      (n, t) =>
        n + (t.reviewIssues ?? []).filter((i) => i.severity === 'error').length,
      0,
    );
    const unverified = (post.translations ?? []).reduce(
      (n, t) => n + (t.unverifiedNumbers?.length ?? 0),
      0,
    );
    return {
      id: post.id,
      kind: post.kind,
      status: post.status,
      isLive: isLive(post),
      isRefresh: isLive(post) && post.status === 'DRAFT',
      gameId: post.gameId,
      // Rankings have no game: this is what the post is about, for lists and mail.
      gameName: post.game?.name ?? rankingOf(post)?.subject.name ?? null,
      gameSlug: post.game?.slug ?? null,
      coverUrl: postCoverUrl(post),
      generatedAt: post.generatedAt,
      publishedAt: post.publishedAt,
      contentUpdatedAt: post.contentUpdatedAt,
      rejectReason: post.rejectReason,
      model: post.model,
      issueCount,
      errorCount,
      unverifiedCount: unverified,
      titles: Object.fromEntries(
        (post.translations ?? []).map((t) => [t.locale, t.title]),
      ),
      slugs: Object.fromEntries(
        (post.translations ?? []).map((t) => [t.locale, t.slug]),
      ),
    };
  }

  private toAdminDetail(post: BlogPost) {
    return {
      ...this.toAdminSummary(post),
      factPack: post.factPack,
      reviewedBy: post.reviewedBy,
      reviewEmailSentAt: post.reviewEmailSentAt,
      translations: (post.translations ?? []).map((t) => ({
        locale: t.locale,
        slug: t.slug,
        title: t.title,
        metaDescription: t.metaDescription,
        excerpt: t.excerpt,
        tldr: t.tldr,
        bodyMarkdown: t.bodyMarkdown,
        faq: t.faq,
        claims: t.claims,
        reviewIssues: t.reviewIssues,
        unverifiedNumbers: t.unverifiedNumbers,
      })),
    };
  }
}

/** On the public blog: published, or published with a refresh in review. */
function isLive(post: BlogPost): boolean {
  return post.publishedAt != null && post.status !== 'REJECTED';
}

/** The text the public sees for one locale, or null when not live. */
function publicContent(
  post: BlogPost,
  translation: BlogPostTranslation,
): PublicContent | null {
  if (!isLive(post)) return null;
  if (post.status === 'PUBLISHED') return translation;
  const snapshot = post.liveSnapshot as unknown as BlogLiveSnapshot | null;
  return snapshot?.translations?.[translation.locale] ?? null;
}

function rankingOf(post: BlogPost): BlogFactPack['ranking'] {
  return (post.factPack as unknown as BlogFactPack | null)?.ranking;
}

function postCoverUrl(post: BlogPost): string | null {
  return post.game?.coverUrl ?? rankingOf(post)?.coverUrl ?? null;
}

function livePack(post: BlogPost): BlogFactPack | null {
  if (post.status === 'PUBLISHED') {
    return post.factPack as unknown as BlogFactPack;
  }
  const snapshot = post.liveSnapshot as unknown as BlogLiveSnapshot | null;
  return snapshot?.factPack ?? null;
}

function snapshotOf(post: BlogPost): BlogLiveSnapshot {
  return {
    factPack: post.factPack as unknown as BlogFactPack,
    model: post.model,
    generatedAt: post.generatedAt ? post.generatedAt.toISOString() : null,
    translations: Object.fromEntries(
      post.translations.map((t) => [
        t.locale,
        {
          title: t.title,
          metaDescription: t.metaDescription,
          excerpt: t.excerpt,
          tldr: t.tldr,
          bodyMarkdown: t.bodyMarkdown,
          faq: t.faq,
          claims: t.claims,
          reviewIssues: t.reviewIssues,
          unverifiedNumbers: t.unverifiedNumbers,
        },
      ]),
    ),
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function issuesStillInText(
  issues: BlogReviewIssue[],
  row: BlogPostTranslation,
): BlogReviewIssue[] {
  const text = normalizeText(
    [
      row.title,
      row.metaDescription,
      row.excerpt,
      ...(row.tldr ?? []),
      row.bodyMarkdown,
      ...(row.faq ?? []).flatMap((item) => [item.question, item.answer]),
    ].join('\n'),
  );
  return issues.filter((issue) => {
    const excerpt = normalizeText(issue.excerpt ?? '');
    return !excerpt || text.includes(excerpt);
  });
}

function clip(value: string | null | undefined, max: number): string {
  return (value ?? '').replaceAll('\0', '').slice(0, max);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

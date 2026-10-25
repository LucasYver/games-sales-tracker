import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  BlogLocale,
  BlogPost,
  BlogPostStatus,
  BlogPostTranslation,
} from '../entities';
import { BlogCandidateService } from './blog-candidate.service';
import { BlogFactPackService } from './blog-fact-pack.service';
import { BlogWriterService } from './blog-writer.service';
import { stableBlogSlug } from './blog.types';
import type { BlogFactPack } from './blog.types';

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
    return { items: rows.map((row) => this.toAdminSummary(row)), total };
  }

  async getAdmin(id: string) {
    const post = await this.posts.findOne({
      where: { id },
      relations: { translations: true, game: true },
    });
    if (!post) throw new NotFoundException(`Blog post ${id} not found`);
    return this.toAdminDetail(post);
  }

  async listPublic(locale: BlogLocale, limit = 20, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.max(offset, 0);
    const qb = this.translations
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.post', 'p')
      .leftJoinAndSelect('p.game', 'g')
      .where('p.status = :status', { status: 'PUBLISHED' })
      .andWhere('t.locale = :locale', { locale })
      .orderBy('p.publishedAt', 'DESC')
      .take(take)
      .skip(skip);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((t) => ({
        slug: t.slug,
        title: t.title,
        excerpt: t.excerpt,
        publishedAt: t.post.publishedAt,
        game: t.post.game
          ? {
              name: t.post.game.name,
              slug: t.post.game.slug,
              coverUrl: t.post.game.coverUrl,
            }
          : null,
      })),
      total,
    };
  }

  async getPublic(locale: BlogLocale, slug: string) {
    const translation = await this.translations.findOne({
      where: { locale, slug },
      relations: { post: { translations: true, game: true } },
    });
    if (!translation || translation.post.status !== 'PUBLISHED') {
      throw new NotFoundException(`Blog post ${locale}/${slug} not found`);
    }
    const alternate = translation.post.translations.find(
      (t) => t.locale !== locale,
    );
    return {
      slug: translation.slug,
      locale: translation.locale,
      title: translation.title,
      metaDescription: translation.metaDescription,
      excerpt: translation.excerpt,
      tldr: translation.tldr,
      bodyMarkdown: translation.bodyMarkdown,
      faq: translation.faq,
      publishedAt: translation.post.publishedAt,
      updatedAt: translation.post.updatedAt,
      game: translation.post.game
        ? {
            name: translation.post.game.name,
            slug: translation.post.game.slug,
            coverUrl: translation.post.game.coverUrl,
          }
        : null,
      alternate: alternate
        ? { locale: alternate.locale, slug: alternate.slug }
        : null,
    };
  }

  async listSitemap() {
    const rows = await this.posts.find({
      where: { status: 'PUBLISHED' },
      relations: { translations: true },
      order: { publishedAt: 'DESC' },
    });
    return {
      items: rows.flatMap((post) =>
        post.translations.map((t) => ({
          locale: t.locale,
          slug: t.slug,
          publishedAt: post.publishedAt,
          alternateSlug: post.translations.find((o) => o.locale !== t.locale)
            ?.slug,
        })),
      ),
    };
  }

  async publishedSlugsForGame(
    gameId: string,
  ): Promise<Record<BlogLocale, string> | null> {
    const post = await this.posts.findOne({
      where: { gameId, status: 'PUBLISHED' },
      relations: { translations: true },
    });
    if (!post) return null;
    const slugs = {} as Record<BlogLocale, string>;
    for (const t of post.translations) slugs[t.locale] = t.slug;
    if (!slugs.en || !slugs.fr) return null;
    return slugs;
  }

  async generateForGame(gameId: string) {
    const existing = await this.posts.findOne({
      where: { gameId },
      relations: { translations: true },
    });
    if (existing?.status === 'PUBLISHED') {
      throw new ConflictException(
        'A published article already exists for this game. Unpublish it first.',
      );
    }

    const pack = await this.factPacks.buildForGame(gameId);
    if (this.factPacks.salesFacts(pack).length < 1) {
      throw new BadRequestException(
        'This game has no sourced sales figures to write about.',
      );
    }

    const [en, fr] = await Promise.all([
      this.writer.writeLocale('en', pack),
      this.writer.writeLocale('fr', pack),
    ]);

    try {
      const postId = await this.posts.manager.transaction(async (em) => {
        const posts = em.getRepository(BlogPost);
        const translations = em.getRepository(BlogPostTranslation);
        const post =
          existing ??
          posts.create({
            gameId,
            kind: 'GAME_SALES_FACTS',
            status: 'DRAFT',
            factPack: pack as unknown as Record<string, unknown>,
          });

        post.status = 'DRAFT';
        post.factPack = pack as unknown as Record<string, unknown>;
        post.model = en.model;
        post.generatedAt = new Date();
        post.publishedAt = null;
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
        `Failed to persist blog draft for ${gameId}`,
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
    const row = await this.translations.findOne({
      where: { postId: id, locale },
    });
    if (!row) throw new NotFoundException(`Translation ${locale} not found`);
    if (input.title != null) row.title = input.title.slice(0, 200);
    if (input.metaDescription != null) {
      row.metaDescription = input.metaDescription.slice(0, 320);
    }
    if (input.excerpt != null) row.excerpt = input.excerpt;
    if (input.tldr != null) row.tldr = input.tldr;
    if (input.bodyMarkdown != null) row.bodyMarkdown = input.bodyMarkdown;
    if (input.faq != null) row.faq = input.faq;
    await this.translations.save(row);
    return this.getAdmin(id);
  }

  async publish(id: string, reviewedBy?: string) {
    const post = await this.requirePost(id);
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
    post.status = 'PUBLISHED';
    post.publishedAt = post.publishedAt ?? new Date();
    post.reviewedBy = reviewedBy ?? post.reviewedBy;
    post.rejectReason = null;
    await this.posts.save(post);
    return this.getAdmin(id);
  }

  async reject(id: string, reason: string | undefined, reviewedBy?: string) {
    const post = await this.requirePost(id);
    post.status = 'REJECTED';
    post.publishedAt = null;
    post.rejectReason = reason?.trim() || null;
    post.reviewedBy = reviewedBy ?? post.reviewedBy;
    await this.posts.save(post);
    return this.getAdmin(id);
  }

  async unpublish(id: string) {
    const post = await this.requirePost(id);
    post.status = 'DRAFT';
    post.publishedAt = null;
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

  async runWeeklyDraftJob(): Promise<{
    action: 'generated' | 'digest' | 'skipped';
    reason?: string;
    postId?: string;
    gameName?: string;
    drafts: ReturnType<BlogService['toAdminSummary']>[];
  }> {
    const drafts = await this.pendingDrafts();
    if (drafts.length > 0) {
      return { action: 'digest', drafts };
    }
    if (!this.writer.enabled) {
      return {
        action: 'skipped',
        reason: 'OPENAI_API_KEY is not set',
        drafts: [],
      };
    }
    const pick = await this.candidates.pickBest();
    if (!pick) {
      return { action: 'skipped', reason: 'no eligible candidate', drafts: [] };
    }
    const post = await this.generateForGame(pick.gameId);
    return {
      action: 'generated',
      postId: post.id,
      gameName: pick.name,
      drafts: [post],
    };
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
      slug: clip(
        result.article.slug || stableBlogSlug(pack.game.slug, locale),
        180,
      ),
      title: clip(result.article.title || pack.game.name, 200),
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
    const unverified = (post.translations ?? []).reduce(
      (n, t) => n + (t.unverifiedNumbers?.length ?? 0),
      0,
    );
    return {
      id: post.id,
      status: post.status,
      gameId: post.gameId,
      gameName: post.game?.name ?? null,
      gameSlug: post.game?.slug ?? null,
      coverUrl: post.game?.coverUrl ?? null,
      generatedAt: post.generatedAt,
      publishedAt: post.publishedAt,
      rejectReason: post.rejectReason,
      model: post.model,
      issueCount,
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

function clip(value: string | null | undefined, max: number): string {
  return (value ?? '').replaceAll('\0', '').slice(0, max);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

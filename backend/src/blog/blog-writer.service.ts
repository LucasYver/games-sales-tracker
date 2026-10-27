import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { BlogLocale } from '../entities';
import { findUnverifiedNumbers, packNames } from './blog-number-check';
import {
  EDITOR_SCHEMA,
  WRITER_SCHEMA,
  editorSystemPrompt,
  editorUserPrompt,
  reviseUserPrompt,
  writerSystemPrompt,
  writerUserPrompt,
} from './blog-prompts';
import type {
  BlogFactPack,
  BlogReviewIssue,
  BlogWriterArticle,
} from './blog.types';
import { stableBlogSlug } from './blog.types';

@Injectable()
export class BlogWriterService {
  private readonly logger = new Logger(BlogWriterService.name);
  private readonly openai: OpenAI | null;
  private readonly writerModel: string;
  private readonly editorModel: string;
  private readonly writerEffort: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('OPENAI_API_KEY');
    this.openai = key ? new OpenAI({ apiKey: key }) : null;
    this.writerModel =
      config.get<string>('BLOG_WRITER_MODEL')?.trim() || 'gpt-6.1-sol';
    this.editorModel =
      config.get<string>('BLOG_EDITOR_MODEL')?.trim() || 'gpt-6-luna';
    this.writerEffort =
      config.get<string>('BLOG_WRITER_REASONING_EFFORT')?.trim() || 'medium';
  }

  get enabled(): boolean {
    return this.openai !== null;
  }

  async writeLocale(
    locale: BlogLocale,
    pack: BlogFactPack,
  ): Promise<{
    article: BlogWriterArticle;
    issues: BlogReviewIssue[];
    unverifiedNumbers: string[];
    model: string;
  }> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not set — cannot generate a blog draft.',
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const names = packNames(pack);
    const system = writerSystemPrompt(locale);

    let article = this.normalize(
      await this.callJson<BlogWriterArticle>({
        model: this.writerModel,
        effort: this.writerEffort,
        system,
        user: writerUserPrompt(locale, pack, today),
        schemaName: 'blog_article',
        schema: WRITER_SCHEMA,
      }),
      locale,
      pack,
    );
    let issues = await this.review(locale, pack, today, article);
    let unverifiedNumbers = findUnverifiedNumbers(article, pack.facts, names);

    // One correction pass when a check fails, so the reviewer starts from a
    // draft that already matches the facts.
    if (
      unverifiedNumbers.length > 0 ||
      issues.some((issue) => issue.severity === 'error')
    ) {
      try {
        const revised = this.normalize(
          await this.callJson<BlogWriterArticle>({
            model: this.writerModel,
            effort: this.writerEffort,
            system,
            user: reviseUserPrompt(locale, pack, today, publicDraft(article), {
              unverifiedNumbers,
              issues,
            }),
            schemaName: 'blog_article',
            schema: WRITER_SCHEMA,
          }),
          locale,
          pack,
        );
        article = revised;
        issues = await this.review(locale, pack, today, article);
        unverifiedNumbers = findUnverifiedNumbers(article, pack.facts, names);
      } catch (error) {
        this.logger.warn(`Blog revision pass failed (${locale}): ${error}`);
      }
    }

    return { article, issues, unverifiedNumbers, model: this.writerModel };
  }

  private normalize(
    written: BlogWriterArticle,
    locale: BlogLocale,
    pack: BlogFactPack,
  ): BlogWriterArticle {
    const gameUrl = pack.gameUrlByLocale[locale];
    // The game link belongs in the body; anywhere else the placeholder would
    // print as-is, so it is dropped.
    const strip = (text: string | undefined) =>
      (text ?? '').replaceAll('{GAME_URL}', '').trim();
    return {
      ...written,
      slug: stableBlogSlug(pack.game.slug, locale),
      title: strip(written.title).slice(0, 200),
      metaDescription: strip(written.metaDescription).slice(0, 320),
      excerpt: strip(written.excerpt),
      tldr: (written.tldr ?? []).slice(0, 3).map(strip),
      bodyMarkdown: (written.bodyMarkdown ?? '').replaceAll(
        '{GAME_URL}',
        gameUrl,
      ),
      faq: (written.faq ?? []).slice(0, 4).map((item) => ({
        question: strip(item.question),
        answer: strip(item.answer),
      })),
      claims: written.claims ?? [],
    };
  }

  private async review(
    locale: BlogLocale,
    pack: BlogFactPack,
    today: string,
    article: BlogWriterArticle,
  ): Promise<BlogReviewIssue[]> {
    try {
      const edited = await this.callJson<{ issues: BlogReviewIssue[] }>({
        model: this.editorModel,
        effort: 'low',
        system: editorSystemPrompt(),
        user: editorUserPrompt(locale, pack, today, publicDraft(article)),
        schemaName: 'blog_editor',
        schema: EDITOR_SCHEMA,
      });
      return edited.issues ?? [];
    } catch (error) {
      this.logger.warn(`Blog editor pass failed (${locale}): ${error}`);
      return [];
    }
  }

  private async callJson<T>(params: {
    model: string;
    effort: string;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<T> {
    if (!this.openai) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not set');
    }

    const response = await this.openai.responses.create({
      model: params.model,
      reasoning: { effort: params.effort as 'low' | 'medium' | 'high' },
      input: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
    });

    const text = response.output_text;
    if (!text) {
      throw new Error(
        `Empty ${params.schemaName} response from ${params.model}`,
      );
    }
    return JSON.parse(text) as T;
  }
}

function publicDraft(article: BlogWriterArticle) {
  return {
    title: article.title,
    metaDescription: article.metaDescription,
    excerpt: article.excerpt,
    tldr: article.tldr,
    bodyMarkdown: article.bodyMarkdown,
    faq: article.faq,
  };
}

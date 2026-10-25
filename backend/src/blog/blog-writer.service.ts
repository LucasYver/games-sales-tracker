import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { BlogLocale } from '../entities';
import { findUnverifiedNumbers } from './blog-number-check';
import {
  EDITOR_SCHEMA,
  WRITER_SCHEMA,
  editorSystemPrompt,
  editorUserPrompt,
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

    const written = await this.callJson<BlogWriterArticle>({
      model: this.writerModel,
      effort: this.writerEffort,
      system: writerSystemPrompt(locale),
      user: writerUserPrompt(locale, pack),
      schemaName: 'blog_article',
      schema: WRITER_SCHEMA,
    });

    const gameUrl = pack.gameUrlByLocale[locale];
    const article: BlogWriterArticle = {
      ...written,
      slug: stableBlogSlug(pack.game.slug, locale),
      title: (written.title ?? '').slice(0, 200),
      metaDescription: (written.metaDescription ?? '').slice(0, 320),
      excerpt: written.excerpt ?? '',
      tldr: (written.tldr ?? []).slice(0, 3),
      bodyMarkdown: (written.bodyMarkdown ?? '').replaceAll(
        '{GAME_URL}',
        gameUrl,
      ),
      faq: (written.faq ?? []).slice(0, 4),
      claims: written.claims ?? [],
    };

    let issues: BlogReviewIssue[] = [];
    try {
      const edited = await this.callJson<{ issues: BlogReviewIssue[] }>({
        model: this.editorModel,
        effort: 'low',
        system: editorSystemPrompt(),
        user: editorUserPrompt(locale, pack, {
          title: article.title,
          metaDescription: article.metaDescription,
          excerpt: article.excerpt,
          tldr: article.tldr,
          bodyMarkdown: article.bodyMarkdown,
          faq: article.faq,
        }),
        schemaName: 'blog_editor',
        schema: EDITOR_SCHEMA,
      });
      issues = edited.issues ?? [];
    } catch (error) {
      this.logger.warn(`Blog editor pass failed (${locale}): ${error}`);
    }

    return {
      article,
      issues,
      unverifiedNumbers: findUnverifiedNumbers(article, pack.facts),
      model: this.writerModel,
    };
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

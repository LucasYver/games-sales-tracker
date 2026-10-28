import type { BlogLocale } from '../entities';

export type BlogFactKind = 'sales' | 'engagement' | 'signal' | 'release';

export interface BlogFact {
  id: string;
  kind: BlogFactKind;
  value: number;
  unit: string;
  platform: string;
  source: string;
  sourceName: string;
  date: string | null;
  isEngagement: boolean;
  isAlinea: boolean;
  /**
   * Plain-English description of exactly what the number measures, written
   * by code (not the model) so the writer cannot mislabel it. Missing on
   * packs frozen before labels existed.
   */
  label?: string;
  /**
   * How much the source can be trusted for the lead and for duplicates:
   * 0 official, 1 press credited to the publisher/developer, 2 Wikipedia,
   * 3 other press. Missing on older packs (derived from `source`).
   */
  sourceRank?: number;
  /** Admin-only. Never sent to the writer or the public API. */
  sourceUrl?: string | null;
}

export interface BlogFactPack {
  game: {
    id: string;
    name: string;
    slug: string;
    releaseDate: string | null;
    publisher: string | null;
    developer: string | null;
    platforms: string[];
    coverUrl: string | null;
  };
  facts: BlogFact[];
  gameUrlByLocale: Record<BlogLocale, string>;
}

/** Live public content kept while a refreshed draft is under review. */
export interface BlogLiveSnapshot {
  factPack: BlogFactPack;
  model: string | null;
  generatedAt: string | null;
  translations: Record<
    string,
    {
      title: string;
      metaDescription: string;
      excerpt: string;
      tldr: string[];
      bodyMarkdown: string;
      faq: { question: string; answer: string }[];
      claims: { sentence: string; factIds: string[] }[];
      reviewIssues: BlogReviewIssue[];
      unverifiedNumbers: string[];
    }
  >;
}

export interface BlogFreshness {
  /** The published article no longer matches the sourced figures on file. */
  stale: boolean;
  added: string[];
  removed: string[];
}

export interface BlogWriterArticle {
  title: string;
  slug: string;
  metaDescription: string;
  excerpt: string;
  tldr: string[];
  bodyMarkdown: string;
  faq: { question: string; answer: string }[];
  claims: { sentence: string; factIds: string[] }[];
}

export interface BlogReviewIssue {
  severity: 'warning' | 'error';
  excerpt: string;
  problem: string;
  suggestion: string;
}

export interface BlogCandidateScore {
  gameId: string;
  name: string;
  slug: string;
  coverUrl: string | null;
  score: number;
  reasons: string[];
  salesFactCount: number;
  steamReviews: number | null;
}

export const BLOG_LOCALES: BlogLocale[] = ['en', 'fr'];

export function stableBlogSlug(gameSlug: string, locale: BlogLocale): string {
  return locale === 'fr'
    ? `${gameSlug}-combien-exemplaires-vendus`
    : `${gameSlug}-how-many-copies-sold`;
}

export function publicAppUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://www.gamesalestracker.tech'
  ).replace(/\/$/, '');
}

/**
 * Line the writer puts in `bodyMarkdown` where the page renders the sales
 * table from the fact pack. Its presence also marks the layout where sales
 * and popularity figures come from code (table + cards), not from the text.
 */
export const SALES_TABLE_MARKER = '[[sales-table]]';

export function hasSalesTableMarker(bodyMarkdown: string): boolean {
  return bodyMarkdown.includes(SALES_TABLE_MARKER);
}

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

import type { BlogLocale, BlogPostKind } from '../entities';

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
  /**
   * Admin-only. Never sent to the writer. The public API exposes one only on
   * a news item, through `BlogFactPack.news` (the figure it relays).
   */
  sourceUrl?: string | null;
  /** Rankings only: the game this figure belongs to. */
  gameName?: string;
  gameSlug?: string;
}

export interface BlogRankingSubject {
  type: 'publisher' | 'franchise';
  /** Publisher id, or franchise slug. */
  key: string;
  name: string;
}

export interface BlogFactPack {
  /** Missing on packs frozen before the other formats (GAME_SALES_FACTS). */
  kind?: BlogPostKind;
  topicKey?: string;
  /** Null on rankings, which cover several games (see `ranking`). */
  game: {
    id: string;
    name: string;
    slug: string;
    releaseDate: string | null;
    publisher: string | null;
    developer: string | null;
    platforms: string[];
    coverUrl: string | null;
  } | null;
  facts: BlogFact[];
  gameUrlByLocale: Record<BlogLocale, string>;
  /** News items: the figure being relayed and the article it comes from. */
  news?: {
    milestoneId: string;
    factId: string;
    sourceUrl: string;
    sourceLabel: string;
  };
  /** Rankings: what is ranked. `facts` are in rank order, highest first. */
  ranking?: {
    subject: BlogRankingSubject;
    coverUrl: string | null;
    gameNames: string[];
  };
}

export function packKind(pack: Pick<BlogFactPack, 'kind'>): BlogPostKind {
  return pack.kind ?? 'GAME_SALES_FACTS';
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

export interface BlogNewsCandidate {
  milestoneId: string;
  gameId: string;
  name: string;
  slug: string;
  units: number;
  source: string;
  reportedAt: string;
  capturedAt: string;
}

export interface BlogLaunchCandidate {
  gameId: string;
  name: string;
  slug: string;
  releaseDate: string;
  steamPeak: number;
}

export interface BlogRankingCandidate {
  subjectType: BlogRankingSubject['type'];
  subjectKey: string;
  name: string;
  gameCount: number;
}

export const BLOG_LOCALES: BlogLocale[] = ['en', 'fr'];

export function stableBlogSlug(gameSlug: string, locale: BlogLocale): string {
  return locale === 'fr'
    ? `${gameSlug}-combien-exemplaires-vendus`
    : `${gameSlug}-how-many-copies-sold`;
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "3.2 million" as a slug part. Only figures of a million or more get news. */
function millionsSlug(units: number): string {
  const millions = Math.floor((units / 1_000_000) * 100) / 100;
  return String(millions).replace('.', '-');
}

/** URL of an article, written by code so the same topic keeps the same URL. */
export function blogSlug(pack: BlogFactPack, locale: BlogLocale): string {
  const fr = locale === 'fr';
  const gameSlug = pack.game?.slug ?? '';
  switch (packKind(pack)) {
    case 'SALES_NEWS': {
      const lead = pack.facts.find((f) => f.id === pack.news?.factId);
      const figure = millionsSlug(lead?.value ?? 0);
      return fr
        ? `${gameSlug}-${figure}-millions-exemplaires-vendus`
        : `${gameSlug}-${figure}-million-copies-sold`;
    }
    case 'LAUNCH_REPORT':
      return fr
        ? `${gameSlug}-lancement-en-chiffres`
        : `${gameSlug}-launch-in-numbers`;
    case 'SALES_RANKING': {
      // "Rockstar Games" must not give "best-selling-rockstar-games-games".
      const subject = slugify(pack.ranking?.subject.name ?? '').replace(
        /-games$/,
        '',
      );
      return fr
        ? `jeux-${subject}-les-plus-vendus`
        : `best-selling-${subject}-games`;
    }
    default:
      return stableBlogSlug(gameSlug, locale);
  }
}

/** What the article is about, for headings and fallbacks. */
export function packSubjectName(pack: BlogFactPack): string {
  return pack.game?.name ?? pack.ranking?.subject.name ?? '';
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

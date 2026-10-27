import type {
  BlogFact,
  BlogFactPack,
  BlogReviewIssue,
  BlogWriterArticle,
} from './blog.types';

// Thousands separators: plain, no-break, narrow no-break (French typography)
// and thin spaces, plus dot / comma.
const SPACES = '\\u0020\\u00a0\\u202f\\u2009';
// Longest first; `(?!\p{L})` keeps "12 mars" / "15 March" / "2 months" from
// reading as millions.
const SUFFIX = '(?:milliards?|billions?|millions?|bn|mil|m|k)(?!\\p{L})';
const NUMBER_RE = new RegExp(
  `(?<![\\p{L}\\d])(?:\\d{1,3}(?:[${SPACES}.,]\\d{3})+(?!\\d)|\\d+(?:[.,]\\d+)?)(?:[${SPACES}]*${SUFFIX})?`,
  'giu',
);
const SUFFIX_RE = new RegExp(`^(.*?)(?:[${SPACES}]*(${SUFFIX}))?$`, 'iu');

const MULTIPLIER: Record<string, number> = {
  milliard: 1e9,
  milliards: 1e9,
  billion: 1e9,
  billions: 1e9,
  bn: 1e9,
  million: 1e6,
  millions: 1e6,
  mil: 1e6,
  m: 1e6,
  k: 1e3,
};

export function parseHumanNumber(raw: string): number | null {
  const match = raw.trim().toLowerCase().match(SUFFIX_RE);
  if (!match) return null;
  const suffix = match[2];
  let core = match[1].replace(new RegExp(`[${SPACES}]`, 'g'), ' ').trim();

  if (core.includes(' ')) {
    core = core.replace(/ /g, '');
  }
  const commas = core.split(',').length - 1;
  const dots = core.split('.').length - 1;
  if (commas > 0 && dots > 0) {
    // Whichever comes last is the decimal mark.
    core =
      core.lastIndexOf(',') > core.lastIndexOf('.')
        ? core.replace(/\./g, '').replace(',', '.')
        : core.replace(/,/g, '');
  } else if (commas + dots > 1) {
    core = core.replace(/[.,]/g, '');
  } else if (commas + dots === 1) {
    const after = core.split(/[.,]/)[1];
    // "1,200" / "1.200" with no suffix is a thousands group; "5,2 millions"
    // or "5.2" is a decimal.
    core =
      after.length === 3 && !suffix
        ? core.replace(/[.,]/, '')
        : core.replace(',', '.');
  }

  const n = Number(core);
  if (!Number.isFinite(n)) return null;
  return suffix ? n * MULTIPLIER[suffix] : n;
}

function allowedValues(facts: BlogFact[], extraText: string[]): number[] {
  const values = new Set<number>();
  for (const fact of facts) {
    values.add(fact.value);
    if (fact.date) {
      const year = Number(fact.date.slice(0, 4));
      if (year >= 1970 && year <= 2100) values.add(year);
      const day = Number(fact.date.slice(8, 10));
      if (day >= 1 && day <= 31) values.add(day);
    }
  }
  // Numbers that belong to a name ("Cyberpunk 2077", "FIFA 23").
  for (const text of extraText) {
    for (const raw of extractFrom(text)) {
      const parsed = parseHumanNumber(raw);
      if (parsed != null) values.add(parsed);
    }
  }
  return [...values];
}

function closeEnough(found: number, allowed: number): boolean {
  if (found === allowed) return true;
  const scale = Math.max(Math.abs(allowed), 1);
  if (scale >= 1_000_000) return Math.abs(found - allowed) / scale <= 0.02;
  if (scale >= 1_000) return Math.abs(found - allowed) / scale <= 0.05;
  return Math.abs(found - allowed) <= 1;
}

export function extractFrom(text: string): string[] {
  return [...text.matchAll(NUMBER_RE)].map((m) => m[0].trim());
}

export type CheckableArticle = Pick<
  BlogWriterArticle,
  'title' | 'metaDescription' | 'excerpt' | 'tldr' | 'bodyMarkdown' | 'faq'
>;

export function articleTexts(article: CheckableArticle): string[] {
  return [
    article.title,
    article.metaDescription,
    article.excerpt,
    ...(article.tldr ?? []),
    article.bodyMarkdown,
    ...(article.faq ?? []).flatMap((item) => [item.question, item.answer]),
  ].filter((text): text is string => typeof text === 'string');
}

/**
 * Numbers in the draft that do not match a fact value, a fact date, or a
 * number inside one of `names` (game title, publisher...).
 */
export function findUnverifiedNumbers(
  article: CheckableArticle,
  facts: BlogFact[],
  names: string[] = [],
): string[] {
  const allowed = allowedValues(facts, names);
  const unverified: string[] = [];
  const seen = new Set<string>();
  for (const blob of articleTexts(article)) {
    // Link targets are URLs, not claims.
    const text = blob.replace(/\]\([^)]*\)/g, ']');
    for (const raw of extractFrom(text)) {
      const parsed = parseHumanNumber(raw);
      if (parsed == null) continue;
      if (parsed > 0 && parsed < 15) continue;
      if (allowed.some((value) => closeEnough(parsed, value))) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unverified.push(raw);
    }
  }
  return unverified;
}

export const REPEATED_FIGURE_PROBLEM = 'Figure repeated in the article body';

/**
 * Sourced figures (sales, players, popularity signals) written more than
 * once in the body. Each one belongs in exactly one place; repeating it is
 * padding and reads badly. The TL;DR box is separate and not counted.
 */
export function findRepeatedFigures(
  bodyMarkdown: string,
  facts: BlogFact[],
): { figure: string; count: number }[] {
  const figures = facts.filter(
    (f) => f.kind === 'sales' || f.kind === 'engagement' || f.kind === 'signal',
  );
  const expected = new Map<number, number>();
  for (const f of figures) {
    expected.set(f.value, (expected.get(f.value) ?? 0) + 1);
  }
  const seen = new Map<number, { figure: string; count: number }>();
  const text = bodyMarkdown.replace(/\]\([^)]*\)/g, ']');
  for (const raw of extractFrom(text)) {
    const parsed = parseHumanNumber(raw);
    if (parsed == null || parsed < 1_000) continue;
    let best: number | null = null;
    for (const f of figures) {
      if (!closeEnough(parsed, f.value)) continue;
      if (
        best == null ||
        Math.abs(parsed - f.value) < Math.abs(parsed - best)
      ) {
        best = f.value;
      }
    }
    if (best == null) continue;
    const entry = seen.get(best) ?? { figure: raw, count: 0 };
    entry.count += 1;
    seen.set(best, entry);
  }
  return [...seen.entries()]
    .filter(([value, entry]) => entry.count > (expected.get(value) ?? 1))
    .map(([, entry]) => entry);
}

/** Editor-style issues for repeated figures, so the review screen lists them. */
export function repeatedFigureIssues(
  bodyMarkdown: string,
  facts: BlogFact[],
): BlogReviewIssue[] {
  return findRepeatedFigures(bodyMarkdown, facts).map(({ figure, count }) => ({
    severity: 'error',
    excerpt: figure,
    problem: `${REPEATED_FIGURE_PROBLEM} (${count} times)`,
    suggestion:
      'Keep this figure once, in the section it belongs to (or the table), and delete the other mentions.',
  }));
}

/** Names whose digits are not claims ("Cyberpunk 2077", "2K"). */
export function packNames(pack: Pick<BlogFactPack, 'game'>): string[] {
  return [pack.game.name, pack.game.publisher ?? '', pack.game.developer ?? ''];
}

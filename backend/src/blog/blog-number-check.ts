import type { BlogFact, BlogWriterArticle } from './blog.types';

const NUMBER_RE =
  /(?<![A-Za-z])(?:\d{1,3}(?:[ \u00a0.,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:million|millions|billion|billions|m|k| mil))?/gi;

function parseHumanNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, ' ');
  const suffixMatch = cleaned.match(
    /^(.*?)(?:\s*(million|millions|billion|billions|m|k|mil))?$/,
  );
  if (!suffixMatch) return null;
  let core = suffixMatch[1].trim();
  const suffix = suffixMatch[2];

  const lastComma = core.lastIndexOf(',');
  const lastDot = core.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    core =
      lastComma > lastDot
        ? core.replace(/\./g, '').replace(',', '.')
        : core.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const after = core.slice(lastComma + 1);
    core =
      after.length === 3 && !suffix
        ? core.replace(/,/g, '')
        : core.replace(',', '.');
  } else {
    core = core.replace(/ /g, '');
  }
  core = core.replace(/ /g, '');
  const n = Number(core);
  if (!Number.isFinite(n)) return null;

  if (suffix === 'billion' || suffix === 'billions') return n * 1_000_000_000;
  if (
    suffix === 'million' ||
    suffix === 'millions' ||
    suffix === 'm' ||
    suffix === 'mil'
  ) {
    return n * 1_000_000;
  }
  if (suffix === 'k') return n * 1_000;
  return n;
}

function allowedValues(facts: BlogFact[]): number[] {
  const values = new Set<number>();
  for (const fact of facts) {
    values.add(fact.value);
    if (fact.date) {
      const year = Number(fact.date.slice(0, 4));
      if (year >= 1970 && year <= 2100) values.add(year);
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

function extractFrom(text: string): string[] {
  return [...text.matchAll(NUMBER_RE)].map((m) => m[0].trim());
}

/** Numbers in the draft that do not match a fact value or a fact year. */
export function findUnverifiedNumbers(
  article: BlogWriterArticle,
  facts: BlogFact[],
): string[] {
  const allowed = allowedValues(facts);
  const blobs = [
    article.title,
    article.metaDescription,
    article.excerpt,
    ...article.tldr,
    article.bodyMarkdown,
    ...article.faq.flatMap((item) => [item.question, item.answer]),
  ];
  const unverified: string[] = [];
  const seen = new Set<string>();
  for (const blob of blobs) {
    for (const raw of extractFrom(blob)) {
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

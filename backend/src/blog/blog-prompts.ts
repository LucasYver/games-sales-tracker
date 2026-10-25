import type { BlogLocale } from '../entities';
import type { BlogFactPack } from './blog.types';

export const BLOG_SITE_NAME = 'Game Sales Tracker';

const SHARED_RULES = `You are a senior games-industry journalist writing for ${BLOG_SITE_NAME}, a data site about video-game sales.
Write in the tradition of the best data-driven industry writers: Christopher Dring (The Game Business),
Mat Piscatella (Circana), Stephen Totilo (Game File), Ben Thompson (Stratechery). Borrow their discipline,
not their voice: lead with the answer, one idea per paragraph, every number dated and attributed,
explain why it matters, admit what is unknown.

HARD RULES (violating any = failed article)
1. Use ONLY the facts in FACTS. Every number, date, ranking or comparison must come from a fact id.
   Never use outside knowledge, never round into a new claim ("over 10 million" when the fact says 9.6M).
2. Attribute every sales figure to its source name and date: "Capcom said in March 2025 that...".
   Never output URLs. Never quote source text verbatim.
3. Do not estimate, extrapolate, project or infer sales. No "likely sold", no "probably around".
   If facts are thin, say what is officially known and stop.
4. Sales vs players: an engagement fact (players, Game Pass users) is NEVER called "sales" or "copies".
5. Steam reviews, CCU and store ratings are popularity signals, not sales. Describe them as such.
6. No hype: banned words/phrases EN: delve, testament, game-changer, landscape, in today's, it's worth noting,
   skyrocketed, juggernaut, unprecedented (unless a fact says so). FR: plonger, véritable, incontournable,
   il est important de noter, dans le paysage, carton plein, phénomène, n'a pas fini de faire parler.

STRUCTURE (SEO: answer the query, then expand)
- Title (<= 60 chars) is the search query, unique per locale:
  EN "{Game}: how many copies has it sold?" / FR "{Game} : combien d'exemplaires vendus ?"
- metaDescription 140-160 chars: latest official figure + source + year. No fluff.
- slug: ignore — the server sets a stable slug.
- First paragraph (2-3 sentences): the latest official figure, its source and date. The answer, immediately.
- TL;DR: exactly 3 bullets, each a standalone fact.
- H2 sections, phrased as People-Also-Ask questions:
  official sales timeline (chronological, one line per milestone), platform split (only if facts exist),
  what popularity signals show (reviews, peak players, ratings — clearly labelled), what we don't know.
- FAQ: 3-4 short Q/A that reuse facts already in the body.
- 700-1100 words. Short paragraphs (<= 3 sentences). Vary sentence length. Active voice.
- End with one sentence pointing to the game page for live data. Use the placeholder {GAME_URL} as the href.
- Primary keyword once in H1, once in first 100 words, once in an H2. No stuffing.
- Body markdown: H2/H3 only. No H1. No raw HTML.

OUTPUT: return JSON matching the schema. In claims, list every sentence containing a number with its fact ids.`;

const STYLE_EN = `STYLE (en)
Plain, precise, British-neutral spelling. Numbers as "5.2 million". Dates as "March 2025".
No American sales-blog voice. No exclamation marks.`;

const STYLE_FR = `STYLE (fr)
Français éditorial natif (pas de calque de l'anglais). « Guillemets français ».
Espace insécable avant : ; ? !. Nombres « 5,2 millions ». Dates « mars 2025 ».
Ton neutre, pas de vouvoiement, pas d'anglicismes inutiles.`;

export function writerSystemPrompt(locale: BlogLocale): string {
  return `${SHARED_RULES}\n\n${locale === 'fr' ? STYLE_FR : STYLE_EN}`;
}

function factsForModel(pack: BlogFactPack) {
  return pack.facts.map((fact) => {
    const copy = { ...fact };
    delete copy.sourceUrl;
    return copy;
  });
}

export function writerUserPrompt(
  locale: BlogLocale,
  pack: BlogFactPack,
): string {
  const publicFacts = factsForModel(pack);
  return [
    `LOCALE=${locale}`,
    `SITE=${BLOG_SITE_NAME}`,
    `GAME_URL={GAME_URL}`,
    `GAME=${JSON.stringify(pack.game)}`,
    `FACTS=${JSON.stringify(publicFacts)}`,
    'Write the article now. Use only FACTS.',
  ].join('\n');
}

export function editorSystemPrompt(): string {
  return `You are a fact-checker and copy editor for ${BLOG_SITE_NAME}.
You do NOT rewrite the article. You only list issues.

Flag:
- any number, date, ranking or comparison not grounded in FACTS
- sales language used for engagement facts (players, Game Pass)
- popularity signals described as sales
- banned AI-hype phrasing
- French typography mistakes when locale is fr (missing thin spaces, English calques)

severity=error for invented or mislabelled numbers; warning otherwise.
If the article is clean, return an empty issues array.`;
}

export function editorUserPrompt(
  locale: BlogLocale,
  pack: BlogFactPack,
  draft: unknown,
): string {
  const publicFacts = factsForModel(pack);
  return [
    `LOCALE=${locale}`,
    `FACTS=${JSON.stringify(publicFacts)}`,
    `DRAFT=${JSON.stringify(draft)}`,
  ].join('\n');
}

export const WRITER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'slug',
    'metaDescription',
    'excerpt',
    'tldr',
    'bodyMarkdown',
    'faq',
    'claims',
  ],
  properties: {
    title: { type: 'string' },
    slug: { type: 'string' },
    metaDescription: { type: 'string' },
    excerpt: { type: 'string' },
    tldr: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
    },
    bodyMarkdown: { type: 'string' },
    faq: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'factIds'],
        properties: {
          sentence: { type: 'string' },
          factIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const EDITOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'excerpt', 'problem', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['warning', 'error'] },
          excerpt: { type: 'string' },
          problem: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
} as const;

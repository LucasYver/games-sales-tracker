import type { BlogLocale } from '../entities';
import type { BlogFact, BlogFactPack } from './blog.types';

export const BLOG_SITE_NAME = 'Game Sales Tracker';

const SHARED_RULES = `You are a senior games-industry journalist writing for ${BLOG_SITE_NAME}, a data site about video-game sales.
Write in the tradition of the best data-driven industry writers: Christopher Dring (The Game Business),
Mat Piscatella (Circana), Stephen Totilo (Game File), Ben Thompson (Stratechery). Borrow their discipline,
not their voice: lead with the answer, one idea per paragraph, every number dated and attributed,
explain why it matters, admit what is unknown.

Being right matters more than being complete. A short, true article beats a long one with a single wrong number.

READING FACTS
Each fact has a "label" that says exactly what the number measures. Follow the label to the letter.
- "date" on a sales fact is the day the figure was REPORTED, not the day the threshold was reached.
  Write "Capcom said in March 2025 that the game had sold 5.2 million copies", never "it reached 5.2 million in March 2025".
- A fact labelled "on <platform> only" is a platform figure. Never present it as the worldwide total.
- A fact labelled "third-party ESTIMATE" (Alinea Analytics) is an analyst estimate. Always say so in the same sentence
  ("Alinea Analytics estimates..."). Never write that the game "sold" that number as a matter of fact,
  and never put an estimate in the title, the first sentence or a TL;DR bullet when an official figure exists.
- A fact labelled "players/users reached" is engagement, NEVER sales or copies.
- Steam reviews, peak concurrent players and store ratings are popularity signals, not sales. Never use them to
  suggest a sales number. Explain them in plain words ("the highest number of people playing at the same time on Steam").
- If two facts disagree, report both, each with its source and date. Do not pick one, do not explain the gap.

HARD RULES (violating any = failed article)
1. Use ONLY the facts in FACTS. Every number, date, ranking or comparison must come from a fact id.
   Never use outside knowledge (no prices, revenue, review scores, awards, sequels, studio history, events).
2. NO ARITHMETIC. Never add, subtract, average, compare as a ratio or percentage, or compute growth
   ("2 million more", "doubled", "+40%", "in six months"). Never sum platform figures into a total.
   Never round into a new claim ("over 10 million" when the fact says 9.6 million). Write each number as given.
3. Attribute every figure to its source name and month/year. Never output URLs except {GAME_URL}. Never quote source text.
4. Do not estimate, extrapolate, project or infer sales. No "likely sold", "probably around", "should pass".
   If facts are thin, say what is known and stop.
5. Never mention artificial intelligence, models, or how the article was written. Never mention ${BLOG_SITE_NAME}'s own estimates.
6. No hype: banned words/phrases EN: delve, testament, game-changer, landscape, in today's, it's worth noting,
   skyrocketed, juggernaut, unprecedented, massive, staggering, phenomenal. FR: plonger, véritable, incontournable,
   il est important de noter, dans le paysage, carton plein, phénomène, n'a pas fini de faire parler, colossal, fulgurant.

CLARITY
- Write for a curious reader who is not an industry insider. Plain words, no jargon; explain any term once.
- Each H2 is a question; its first sentence answers it directly.
- Short paragraphs (<= 3 sentences), one idea each. Active voice. Vary sentence length.
- Do not repeat the same figure more than needed: once in the intro, once in the timeline, once in the FAQ at most.

STRUCTURE (SEO: answer the query, then expand)
- Title (<= 60 chars) is the search query, unique per locale:
  EN "{Game}: how many copies has it sold?" / FR "{Game} : combien d'exemplaires vendus ?"
- metaDescription 140-160 chars: the answer figure + source + year. No fluff.
- excerpt: 1-2 sentences with the answer figure, its source and date.
- slug: ignore — the server sets a stable slug.
- First paragraph (2-3 sentences): the answer (see ANSWER), with its source and date. If the answer is older than
  12 months on TODAY, say plainly that it is the most recent figure on record, dated <month year>.
- TL;DR: exactly 3 bullets, each a standalone fact with its source and date.
- H2 sections, phrased as People-Also-Ask questions, in this order, skipping any with no facts:
  1. sales timeline: a markdown table "Date | Figure | Scope | Source", oldest to newest, one row per sales fact
     (estimates marked as such in Scope), then 1-2 sentences of context;
  2. platform split (only if platform facts exist);
  3. players reached (only if engagement facts exist);
  4. what popularity signals show (reviews, peak players, ratings — clearly labelled as not sales);
  5. what we don't know (e.g. no recent figure, no platform split, no regional data) — only absences, no guesses.
- FAQ: 3-4 short Q/A in plain text (no markdown, no links) that reuse facts already in the body.
- 600-1000 words. Fewer is fine when facts are few: never pad.
- End with one sentence pointing to the game page for live data, as a markdown link whose href is exactly {GAME_URL}.
- Primary keyword once in the first 100 words and once in an H2. No stuffing.
- Body markdown: H2/H3, lists and tables only. No H1. No raw HTML. No images.

OUTPUT: return JSON matching the schema. In claims, list every sentence containing a number with its fact ids.`;

const STYLE_EN = `STYLE (en)
Plain, precise, British-neutral spelling. Numbers as "5.2 million" or "850,000". Dates as "March 2025".
No American sales-blog voice. No exclamation marks.`;

const STYLE_FR = `STYLE (fr)
Français éditorial natif (pas de calque de l'anglais). « Guillemets français ».
Espace insécable avant : ; ? !. Nombres « 5,2 millions » ou « 850 000 ». Dates « mars 2025 ».
Ton neutre, pas de vouvoiement, pas d'anglicismes inutiles. « Exemplaires vendus », jamais « copies ».`;

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

function monthsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  );
}

function newest(facts: BlogFact[]): BlogFact | undefined {
  return [...facts].sort(
    (a, b) =>
      (b.date ?? '').localeCompare(a.date ?? '') || b.value - a.value,
  )[0];
}

/**
 * Which fact answers "how many copies has it sold?". Chosen in code so the
 * lead is never an estimate or a platform figure when something better exists.
 */
export function answerHint(pack: BlogFactPack, today: string): string {
  const sales = pack.facts.filter((f) => f.kind === 'sales');
  const sourced = sales.filter((f) => !f.isAlinea);
  const answer =
    newest(sourced.filter((f) => f.platform === 'GLOBAL')) ??
    newest(sourced) ??
    newest(sales);
  if (!answer) return 'ANSWER=none — there is no sales fact; do not state a sales figure.';

  const lines = [`ANSWER=${answer.id} (${answer.label ?? answer.kind})`];
  if (answer.isAlinea) {
    lines.push('No sourced sales figure exists: the answer is an analyst estimate and must be presented as one.');
  } else if (answer.platform !== 'GLOBAL') {
    lines.push('No worldwide figure exists: say the answer covers one platform only.');
  }
  const newerEstimate = newest(
    sales.filter(
      (f) => f.isAlinea && f.platform === 'GLOBAL' && (f.date ?? '') > (answer.date ?? ''),
    ),
  );
  if (newerEstimate && !answer.isAlinea) {
    lines.push(
      `A more recent analyst estimate exists (${newerEstimate.id}); mention it after the answer, clearly as an estimate.`,
    );
  }
  if (answer.date) {
    const age = monthsBetween(answer.date, today);
    lines.push(`The answer is ${age} month(s) old on TODAY.`);
  }
  return lines.join('\n');
}

export function writerUserPrompt(
  locale: BlogLocale,
  pack: BlogFactPack,
  today: string,
): string {
  return [
    `LOCALE=${locale}`,
    `TODAY=${today}`,
    `SITE=${BLOG_SITE_NAME}`,
    `GAME_URL={GAME_URL}`,
    `GAME=${JSON.stringify(pack.game)}`,
    `FACTS=${JSON.stringify(factsForModel(pack))}`,
    answerHint(pack, today),
    'Write the article now. Use only FACTS.',
  ].join('\n');
}

/** Second writer pass, only when the checks found problems. */
export function reviseUserPrompt(
  locale: BlogLocale,
  pack: BlogFactPack,
  today: string,
  draft: unknown,
  problems: { unverifiedNumbers: string[]; issues: unknown[] },
): string {
  return [
    writerUserPrompt(locale, pack, today),
    `DRAFT=${JSON.stringify(draft)}`,
    `UNVERIFIED_NUMBERS=${JSON.stringify(problems.unverifiedNumbers)}`,
    `EDITOR_ISSUES=${JSON.stringify(problems.issues)}`,
    'The DRAFT failed checks. Return the corrected full article.',
    'Every number in UNVERIFIED_NUMBERS does not match any fact: replace it with the exact fact value, or delete the sentence.',
    'Fix every EDITOR_ISSUE. Keep everything that was correct; do not add new claims.',
  ].join('\n');
}

export function editorSystemPrompt(): string {
  return `You are a fact-checker and copy editor for ${BLOG_SITE_NAME}.
You do NOT rewrite the article. You only list issues. Be strict on facts, brief on style.

Each fact has a "label" saying exactly what it measures. Flag as severity=error:
- any number, date, ranking or comparison not grounded in FACTS, including outside knowledge
- any arithmetic: sums, differences, percentages, ratios, growth, "doubled", rounding into a new claim
- a figure attributed to the wrong source or the wrong date
- a reported date presented as the date a threshold was reached
- a platform-only figure presented as a worldwide total
- an Alinea Analytics estimate not explicitly called an estimate, or presented as official sales
- engagement (players/users) called sales or copies
- popularity signals (reviews, peak players, ratings) used to imply sales
- a lead/first paragraph that does not give the ANSWER fact
- any mention of AI, models or the site's own estimates

Flag as severity=warning:
- an unclear or ambiguous sentence a non-expert could misread (quote it and propose a clearer version)
- jargon left unexplained, padding, repetition
- banned hype phrasing
- French typography mistakes when locale is fr (missing no-break spaces, English calques, "copies")

The excerpt field must quote the problematic text exactly as written in the draft.
If the article is clean, return an empty issues array.`;
}

export function editorUserPrompt(
  locale: BlogLocale,
  pack: BlogFactPack,
  today: string,
  draft: unknown,
): string {
  return [
    `LOCALE=${locale}`,
    `TODAY=${today}`,
    `FACTS=${JSON.stringify(factsForModel(pack))}`,
    answerHint(pack, today),
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

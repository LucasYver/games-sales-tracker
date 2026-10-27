import type { BlogLocale } from '../entities';
import type { BlogFact, BlogFactPack } from './blog.types';

export const BLOG_SITE_NAME = 'Game Sales Tracker';

const SHARED_RULES = `You are a senior games-industry journalist writing for ${BLOG_SITE_NAME}, a data site about video-game sales.
Write like the best data-driven industry writers (Christopher Dring, Mat Piscatella, Stephen Totilo): short, exact,
every number dated and attributed, nothing said twice.

Being right and clear matters more than being long. A 250-word article that reads well beats 800 words of filler.

READING FACTS
Each fact has a "label" (what the number measures) and a "section" (where it goes). The label is an internal note:
follow its meaning, never copy its wording into the article.
- "date" on a sales fact is when the figure was REPORTED. Write "Capcom said in March 2025 that the game had sold
  5.2 million copies", never "it reached 5.2 million in March 2025".
- A figure for one platform is never the worldwide total.
- An analyst ESTIMATE (Alinea Analytics) is always called an estimate in the same sentence ("Alinea Analytics estimates...").
  It is never "sold" as a fact, and never the lead when an official figure exists.
- "Players reached" is not sales or copies.
- Steam reviews, peak concurrent players and store ratings are popularity signals, not sales. Never use them to hint
  at a sales number. Say what they are in plain words ("the highest number of people playing at the same time on Steam").
- If two facts disagree, give both with their source and date. Do not pick one, do not explain the gap.

HARD RULES (violating any = failed article)
1. Use ONLY the facts in FACTS and the GAME object. Every number, date, ranking or comparison comes from a fact id.
   No outside knowledge (no prices, revenue, review scores, awards, sequels, studio history, events).
2. NO ARITHMETIC: no sums, differences, averages, percentages, ratios or growth ("2 million more", "doubled",
   "+40%", "in six months"). Never add platform figures together. Never round into a new claim. Write each number as given.
3. Attribute every figure to its source and month/year. No URLs except {GAME_URL}. No quotes from sources.
4. No estimating, extrapolating or guessing ("likely sold", "probably around", "should pass").
5. Never mention artificial intelligence, models, or how the article was written. Never mention ${BLOG_SITE_NAME}'s own estimates.
6. EACH FACT APPEARS ONCE IN THE BODY, in its section. The TL;DR box is shown right above the body: the body never
   repeats a TL;DR sentence. Do not recap at the end. Do not restate a table number in the sentence after the table.
7. No hype: banned EN: delve, testament, game-changer, landscape, in today's, it's worth noting, skyrocketed, juggernaut,
   unprecedented, massive, staggering, phenomenal, impressive, remarkable. FR: plonger, véritable, incontournable,
   il est important de noter, dans le paysage, carton plein, phénomène, n'a pas fini de faire parler, colossal,
   fulgurant, impressionnant, remarquable.

WRITING QUALITY
- Every sentence must be complete, natural and make sense on its own to a reader who has never heard of the game.
  If you cannot say something clearly with the facts you have, leave it out.
- At most one figure per sentence (tables aside). No stacked clauses, no lists of numbers in prose.
- Plain words, no jargon. No template phrases ("When it comes to...", "In terms of...", "Il convient de...").
- No sentences about the article itself ("This article looks at...", "Dans cet article...").
- Do not open two sentences in a row the same way. No filler transitions.
- Generic source names are written naturally in the article language ("the press" → « la presse »).
- Before returning, reread every sentence: does it make sense? Is any figure written twice? Fix it.

STRUCTURE
- title (<= 60 chars), exactly the search query:
  EN "{Game}: how many copies has it sold?" / FR "{Game} : combien d'exemplaires vendus ?"
- metaDescription (140-160 chars): the ANSWER figure, its source and month/year, in one plain sentence.
- excerpt (shown on the blog index, not on the article): one sentence with the ANSWER figure, source and date.
- tldr: 2 or 3 bullets, each a DIFFERENT fact, one short sentence each with source and month/year.
  First bullet = the ANSWER. If the ANSWER is older than 12 months on TODAY, the bullet says it is the latest figure on record.
- bodyMarkdown, in this order, skipping any part whose section has no facts:
  1. Opening paragraph, no heading, 2-3 sentences: the game in context (who made it, when it came out, from GAME and
     the "intro" fact) and what kind of sales figures exist (official, press, estimates). No sales figure here.
  2. "timeline" section: an H2 naming the game (EN "{Game} sales over time" / FR "Les ventes de {Game}
     au fil du temps"). If 2+ timeline facts: a markdown table "Date | Copies sold | Source" (FR
     "Date | Exemplaires vendus | Source"), oldest first, one row per fact, estimates marked "(estimate)" /
     « (estimation) » in Source. Then at most 2 sentences on what the table shows, WITHOUT any number from it.
     If 1 timeline fact: one sentence instead of a table.
  3. "platforms" section: H2 (EN "Sales by platform" / FR "Ventes par plateforme"), one bullet per fact.
  4. "players" section: H2 (EN "How many people have played it?" / FR "Combien de joueurs ?"), one or two sentences.
  5. "popularity" section: H2 (EN "What do player numbers on Steam and console stores show?" or similar), one short
     paragraph, each signal once, clearly not sales.
  6. Closing paragraph, no heading, 1-2 sentences: what is not known, only if it matters (e.g. no figure for over a
     year), then one sentence linking to live data as a markdown link whose href is exactly {GAME_URL}.
- Length follows the facts: about 200-350 words with 2-4 facts, never more than 700. Never pad.
- Body markdown: H2, paragraphs, bullet lists and one table at most. No H1, no H3, no raw HTML, no images.

FORMAT EXAMPLE (invented game "Lantern Road"; shows shape and tone only, never reuse its content):
tldr: ["Brightfold said in May 2025 that Lantern Road had sold 3 million copies.",
       "Brightfold had reported 1 million copies in November 2023.",
       "Its peak on Steam is 41,200 people playing at the same time, recorded in October 2023."]
bodyMarkdown:
"Lantern Road is a narrative adventure released by Brightfold in October 2023 on PC and consoles. Its sales are
known from Brightfold's own announcements.

## Lantern Road sales over time

| Date | Copies sold | Source |
|---|---|---|
| November 2023 | 1 million | Brightfold |
| May 2025 | 3 million | Brightfold |

Brightfold has given updates at launch and again a year and a half later, both for all platforms combined.

## What do player numbers on Steam show?

The most people playing Lantern Road at the same time on Steam was 41,200, in October 2023. That counts players
online at once, not copies sold.

Brightfold has not shared a split by platform. Live data is on the [Lantern Road page]({GAME_URL})."
(Note how no figure appears twice in the body and the body does not repeat the TL;DR sentences.)

OUTPUT: return JSON matching the schema. In claims, list every sentence containing a number with its fact ids.`;

const STYLE_EN = `STYLE (en)
Plain, precise, British-neutral spelling. Numbers as "5.2 million" or "850,000". Dates as "March 2025".
No American sales-blog voice. No exclamation marks.`;

const STYLE_FR = `STYLE (fr)
Français éditorial natif (pas de calque de l'anglais). « Guillemets français ».
Espace insécable avant : ; ? !. Nombres « 5,2 millions » ou « 850 000 ». Dates « mars 2025 ».
Ton neutre, pas de vouvoiement, pas d'anglicismes inutiles. « Exemplaires vendus », jamais « copies ».
Écris directement en français : ne traduis pas une phrase anglaise dans ta tête.`;

export function writerSystemPrompt(locale: BlogLocale): string {
  return `${SHARED_RULES}\n\n${locale === 'fr' ? STYLE_FR : STYLE_EN}`;
}

/** Where each fact goes in the body, so every figure has exactly one place. */
function sectionOf(fact: BlogFact): string {
  if (fact.kind === 'release') return 'intro';
  if (fact.kind === 'signal') return 'popularity';
  if (fact.kind === 'engagement') return 'players';
  return fact.platform === 'GLOBAL' ? 'timeline' : 'platforms';
}

function factsForModel(pack: BlogFactPack) {
  return pack.facts.map((fact) => {
    const copy: Record<string, unknown> = { ...fact, section: sectionOf(fact) };
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
    (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.value - a.value,
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
  if (!answer)
    return 'ANSWER=none — there is no sales fact; do not state a sales figure.';

  const lines = [`ANSWER=${answer.id} (${answer.label ?? answer.kind})`];
  if (answer.isAlinea) {
    lines.push(
      'No sourced sales figure exists: the answer is an analyst estimate and must be presented as one.',
    );
  } else if (answer.platform !== 'GLOBAL') {
    lines.push(
      'No worldwide figure exists: say the answer covers one platform only.',
    );
  }
  const newerEstimate = newest(
    sales.filter(
      (f) =>
        f.isAlinea &&
        f.platform === 'GLOBAL' &&
        (f.date ?? '') > (answer.date ?? ''),
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
    'Fix every EDITOR_ISSUE. A repeated figure stays only in its section; delete the other mentions rather than rephrasing them.',
    'Keep everything that was correct; do not add new claims. Shorter is fine.',
  ].join('\n');
}

export function editorSystemPrompt(): string {
  return `You are a fact-checker and copy editor for ${BLOG_SITE_NAME}.
You do NOT rewrite the article. You only list issues. Be strict on facts and on clarity.

Each fact has a "label" saying exactly what it measures. Flag as severity=error:
- any number, date, ranking or comparison not grounded in FACTS, including outside knowledge
- any arithmetic: sums, differences, percentages, ratios, growth, "doubled", rounding into a new claim
- a figure attributed to the wrong source or the wrong date
- a reported date presented as the date a threshold was reached
- a platform-only figure presented as a worldwide total
- an Alinea Analytics estimate not explicitly called an estimate, or presented as official sales
- players reached called sales or copies
- popularity signals (reviews, peak players, ratings) used to imply sales
- the first TL;DR bullet is not the ANSWER fact
- the same figure written more than once in bodyMarkdown, or a TL;DR sentence repeated in the body
- a sentence that is ungrammatical, confusing, contradictory, or does not make sense on its own
- wording copied from a fact label (e.g. "total copies sold so far, all platforms, worldwide")
- any mention of AI, models or the site's own estimates

Flag as severity=warning:
- jargon left unexplained, padding, filler transitions, sentences about the article itself
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
    'claims',
  ],
  properties: {
    title: { type: 'string' },
    slug: { type: 'string' },
    metaDescription: { type: 'string' },
    excerpt: { type: 'string' },
    tldr: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: { type: 'string' },
    },
    bodyMarkdown: { type: 'string' },
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

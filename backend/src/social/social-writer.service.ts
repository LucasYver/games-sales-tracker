import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { SocialPostKind } from '../entities';

/** Threads allows 500 characters; the rest is headroom for admin edits. */
export const SOCIAL_MAX_CHARS = 480;
/** X allows 280; emojis and some characters count double there. */
export const X_MAX_CHARS = 260;

const ANGLE: Record<SocialPostKind, string> = {
  BLOG_ARTICLE:
    'The post is about the game, not about the article. Tell one story: the newest figure, who reported it and when. Bring in one earlier figure only when it is clearly older and lower, to show the growth ("up from 60 million a year earlier"). Leave out press figures from the same period or lower than the official one: next to it they read like a contradiction. Do not describe the article ("our new article covers…").',
  WEEKLY_TRENDS:
    "The games people are playing this week, most trending first, one per line with the site's sales estimate. Say once, briefly, that these are estimates.",
  GTA6_FIGURE:
    'A new official GTA 6 sales figure: open on the number, then who reported it and when. Mention the GTA V and Red Dead Redemption 2 comparison only if a fact gives it.',
  MW4_UPDATE:
    "Activision publishes no Modern Warfare 4 sales figure, so the post compares MW4's Steam reviews with Black Ops 7 and Black Ops 6 at the same age, using only the facts. Steam reviews are a popularity signal, not sales.",
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'xText'],
  properties: { text: { type: 'string' }, xText: { type: 'string' } },
};

/**
 * Writes one English post from code-written facts, in two lengths: Threads
 * (`text`) and X (`xText`). The cheapest model
 * that holds the rules (`SOCIAL_WRITER_MODEL`); every number it writes is
 * checked against the facts, with one revision pass when one is not.
 */
@Injectable()
export class SocialWriterService {
  private readonly logger = new Logger(SocialWriterService.name);
  private readonly openai: OpenAI | null;
  readonly model: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('OPENAI_API_KEY');
    this.openai = key ? new OpenAI({ apiKey: key }) : null;
    this.model =
      config.get<string>('SOCIAL_WRITER_MODEL')?.trim() || 'gpt-6-luna';
  }

  get enabled(): boolean {
    return this.openai !== null;
  }

  async write(
    kind: SocialPostKind,
    facts: string[],
  ): Promise<{ text: string; xText: string; unverifiedNumbers: string[] }> {
    let post = await this.call(userPrompt(kind, facts));
    let problems = postProblems(post, facts);
    if (problems.length > 0) {
      try {
        post = await this.call(
          `${userPrompt(kind, facts)}\n\nYour previous answer:\n${JSON.stringify(post)}\n\nFix it: ${problems.join('; ')}.`,
        );
        problems = postProblems(post, facts);
      } catch (error) {
        this.logger.warn(`Social revision pass failed: ${error}`);
      }
    }
    return {
      ...post,
      unverifiedNumbers: unverifiedNumbers(
        `${post.text}\n${post.xText}`,
        facts,
      ),
    };
  }

  private async call(user: string): Promise<{ text: string; xText: string }> {
    if (!this.openai) throw new Error('OPENAI_API_KEY is not set');
    const response = await this.openai.responses.create({
      model: this.model,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'social_post',
          strict: true,
          schema: SCHEMA,
        },
      },
    });
    this.logger.log(
      `social_post ${this.model}: ${response.usage?.input_tokens ?? '?'} in, ${response.usage?.output_tokens ?? '?'} out`,
    );
    const parsed = JSON.parse(response.output_text || '{}') as {
      text?: string;
      xText?: string;
    };
    return {
      text: (parsed.text ?? '').trim(),
      xText: (parsed.xText ?? '').trim(),
    };
  }
}

const SYSTEM = `You write posts for the Threads and X accounts of Game Sales Tracker, a site that estimates video game sales from public data.

Write like a person who follows game sales closely and shares what they found, not like a press release.

Shape:
- The first line is the hook, on its own line, and must make someone stop scrolling: a question the post answers ("How many copies has Hades II sold?"), or a short punchy statement built on the figure ("65 million. And still selling."). Not a dry "Game: N copies worldwide." Never open with "Our new article", "Check out", "We" or the site's name.
- Then 1 or 2 short lines: the figure, who reported it, when. One story, at most two numbers in the whole post.
- About one post in two ends with a short question to the reader ("Did you expect that?", "Have you played it?"). Skip it when it would feel forced.
- English. \`text\` (Threads): at most ${SOCIAL_MAX_CHARS} characters, usually 150 to 280.
- \`xText\` (X): the same post, tighter: at most ${X_MAX_CHARS} characters, same hook, same facts, no emoji.

Example (invented game, for the shape only):
How many copies has Starfall Tactics sold?
1.2 million, Nova Games said in March 2026.
That is up from 500,000 at launch a year earlier.
Did you expect it to get this big?

Truth:
- Use only the facts given. No outside knowledge, no guesses, no arithmetic (no sums, differences, percentages or growth you compute yourself).
- Copy every number exactly as it is written in the facts.
- Say who reported a figure. A figure labelled as an estimate must be called an estimate. Steam reviews and players are popularity, never sales.

Never:
- a URL (Threads shows a link preview under the post; the X profile carries the link), hashtags, hype words ("insane", "massive", "huge"), more than one emoji;
- describe the article or the page ("covers", "looks at", "read more", "link below");
- mention AI or how the post was written.`;

function userPrompt(kind: SocialPostKind, facts: string[]): string {
  return `${ANGLE[kind]}\n\nFacts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nReturn {"text": "...", "xText": "..."}.`;
}

function postProblems(
  post: { text: string; xText: string },
  facts: string[],
): string[] {
  const problems: string[] = [];
  const unverified = unverifiedNumbers(`${post.text}\n${post.xText}`, facts);
  if (unverified.length) {
    problems.push(
      `these numbers are not in the facts: ${unverified.join(', ')}`,
    );
  }
  if (post.text.length > SOCIAL_MAX_CHARS) {
    problems.push(
      `text has ${post.text.length} characters, the limit is ${SOCIAL_MAX_CHARS}`,
    );
  }
  if (!post.xText || post.xText.length > X_MAX_CHARS) {
    problems.push(
      `xText has ${post.xText.length} characters, it must be 1 to ${X_MAX_CHARS}`,
    );
  }
  return problems;
}

const NUMBER = /\d[\d,.]*/g;

function digitsOf(token: string): string {
  return token.replace(/,/g, '').replace(/\.$/, '');
}

/**
 * Numbers in the post that appear in no fact. "8.7M" and "8.7 million" both
 * reduce to "8.7"; game names and years count since they are in the facts.
 */
export function unverifiedNumbers(text: string, facts: string[]): string[] {
  const allowed = new Set(
    facts.flatMap((fact) => (fact.match(NUMBER) ?? []).map(digitsOf)),
  );
  const found = (text.match(NUMBER) ?? []).map(digitsOf);
  return [...new Set(found.filter((n) => n && !allowed.has(n)))];
}

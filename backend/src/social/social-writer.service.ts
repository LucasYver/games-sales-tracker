import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { SocialPostKind } from '../entities';

/** Threads allows 500 characters; the rest is headroom for admin edits. */
export const SOCIAL_MAX_CHARS = 480;

const ANGLE: Record<SocialPostKind, string> = {
  BLOG_ARTICLE:
    'The post is about the game, not about the article. Open on the game and its newest figure (who reported it, when). If the facts hold an earlier figure, set the two side by side so the reader sees the story. Do not describe the article ("our new article covers…").',
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
  required: ['text'],
  properties: { text: { type: 'string' } },
};

/**
 * Writes one English Threads post from code-written facts. The cheapest model
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
  ): Promise<{ text: string; unverifiedNumbers: string[] }> {
    let text = await this.call(userPrompt(kind, facts));
    let unverified = unverifiedNumbers(text, facts);
    if (unverified.length > 0 || text.length > SOCIAL_MAX_CHARS) {
      try {
        text = await this.call(
          `${userPrompt(kind, facts)}\n\nYour previous post:\n${text}\n\nFix it: ${[
            unverified.length
              ? `these numbers are not in the facts: ${unverified.join(', ')}`
              : '',
            text.length > SOCIAL_MAX_CHARS
              ? `it has ${text.length} characters, the limit is ${SOCIAL_MAX_CHARS}`
              : '',
          ]
            .filter(Boolean)
            .join('; ')}.`,
        );
        unverified = unverifiedNumbers(text, facts);
      } catch (error) {
        this.logger.warn(`Social revision pass failed: ${error}`);
      }
    }
    return { text, unverifiedNumbers: unverified };
  }

  private async call(user: string): Promise<string> {
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
    };
    return (parsed.text ?? '').trim();
  }
}

const SYSTEM = `You write posts for the Threads account of Game Sales Tracker, a site that estimates video game sales from public data.

Rules:
Write like a person who follows game sales closely and shares what they found, not like a press release.

Shape:
- The first line is the hook and must stand alone in a feed: a short question ("How many copies has Hades II sold?") or the striking figure itself. Never open with "Our new article", "Check out", "We" or the site's name.
- Then 1 to 3 short lines with the facts, each on its own line. Short sentences, active voice.
- You may end with one short question to the reader when it fits naturally (e.g. "Did you expect that?"). Not every time.
- English, at most ${SOCIAL_MAX_CHARS} characters in total, usually 150 to 300.

Truth:
- Use only the facts given. No outside knowledge, no guesses, no arithmetic (no sums, differences, percentages or growth you compute yourself).
- Copy every number exactly as it is written in the facts.
- Say who reported a figure. A figure labelled as an estimate must be called an estimate. Steam reviews and players are popularity, never sales.

Never:
- a URL (the link preview is attached under the post), hashtags, hype words ("insane", "massive", "huge"), more than one emoji;
- describe the article or the page ("covers", "looks at", "read more", "link below");
- mention AI or how the post was written.`;

function userPrompt(kind: SocialPostKind, facts: string[]): string {
  return `${ANGLE[kind]}\n\nFacts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nReturn {"text": "..."}.`;
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

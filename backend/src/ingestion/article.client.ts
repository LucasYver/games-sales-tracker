import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { LlmExtractorService } from '../llm/llm-extractor.service';
import { isPeriodicQuote } from './sales-figure.utils';

export interface ArticleFigure {
  units: number;
  reportedAt: Date | null;
  quote: string;
}

export interface ArticleSales {
  global: ArticleFigure | null;
  // Single-platform cumulative copies-sold figures (e.g. "X copies sold on
  // Steam", "X million on PS5"). Captured separately from `global` because
  // they are single-platform totals, not worldwide ones: they give a direct,
  // assumption-free per-platform signal used to learn the PC-vs-console split
  // and calibrate the per-platform Boxleiter multipliers.
  pc: ArticleFigure | null;
  ps: ArticleFigure | null;
  xbox: ArticleFigure | null;
  switch: ArticleFigure | null;
  // Engagement milestone (e.g. "X million players reached", "X downloads").
  // Reported separately from `global` because it conflates copies sold with
  // subscription users (Ubisoft+/Game Pass) and free-trial play, so it cannot
  // be fed into the calibration math — but it is still a useful informational
  // signal that we want to surface and store.
  engagement: ArticleFigure | null;
  attribution: string | null;
}

interface LlmFigure {
  units: number;
  date: string | null;
  quote: string;
}
interface LlmResult {
  matchesGame: boolean;
  attribution: string | null;
  global: LlmFigure | null;
  pc: LlmFigure | null;
  ps: LlmFigure | null;
  xbox: LlmFigure | null;
  switch: LlmFigure | null;
  engagement: LlmFigure | null;
}
interface LlmDateResult {
  date: string | null;
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; GameSalesTracker/0.1; +https://example.com/bot)';
const MAX_TEXT_CHARS = 16000;

const DATE_PROMPT = `You are a publication date extractor. Given the text of an article, find the single most specific date that represents WHEN this article was published or WHEN the event it reports on occurred. Look for: article byline ("Published Jan 15, 2025"), introductory sentences ("Earlier today, on June 2025…"), event descriptions ("as of Q1 2025", "announced Monday", etc.). Return only a JSON object with one field "date" in YYYY-MM-DD, YYYY-MM, or YYYY format. If absolutely no date can be found, return {"date": null}.`;

const DATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: ['string', 'null'] },
  },
  required: ['date'],
};

const SYSTEM_PROMPT = `You are a precise data extractor. You are given the plain text of a press/news article and the name of a target video game. Extract sales figures for the TARGET GAME ONLY, and ONLY when explicitly stated in the text. NEVER use outside knowledge and NEVER estimate.

- "matchesGame": true only if the article actually reports a sales figure for the target game. If the article is about a different game or gives no sales number for the target, set it to false and everything else to null.
- "attribution": who the figure is credited to in the text (e.g. "the publisher", "Circana", "Sony", "the studio"); null if unstated.

CUMULATIVE UNITS ONLY for "global" — this is critical. ONLY extract a figure there that represents the TOTAL CUMULATIVE LIFETIME number of UNITS (copies) sold for the game ("has sold X copies", "X copies sold to date", "lifetime sales of X", "X copies since launch"). NEVER put in "global":
  - "sold X in its first week / first month / launch weekend"
  - "X copies in [year/quarter/period]" when it's clearly a periodic figure (e.g. "X copies in 2024 alone", "X units in Q1", "weekly sales of X")
  - Fiscal-period figures: "in FY2024", "during fiscal year ended…", "fiscal Q3" — these are PERIODIC, not lifetime
  - "X players" / "X downloads" / "X concurrent users" / "X subscribers" — these are engagement metrics; see the "engagement" field below
  - MONETARY figures: any number with $/€/£/¥ or words like "revenue", "earnings", "turnover". In English finance, "sales" often means revenue: "$3.9 million in sales" is REVENUE, NOT 3.9M units. If a currency sign appears, REJECT.
  - DLC, expansions, bundles, remasters, or other games

SINGLE TARGET GAME ONLY — this is critical. Every figure MUST be the total for the ONE specific target game, NEVER a franchise / series / saga / collection total that sums several games together. Reject (set null) whenever the number describes the brand/series rather than the target title. Traps to watch for:
  - "the franchise/series has sold X", "the series' installments have sold X", "X across the franchise/series/saga", "the franchise is now up to X"
  - "the [Brand] franchise that has sold over X units to date" — this counts ALL games in the brand, not the target game
  - a combined total for several distinct games ("Game A and Game B combined sold X")
  When a SINGLE sentence gives BOTH the target game's own number AND a franchise/series total (e.g. "Horizon Zero Dawn contributed 24.3 million of the over 32.7 million copies the franchise has sold"), extract ONLY the target game's number (24.3M) and NEVER the franchise number (32.7M). If the text states only a franchise/series total with no number specific to the target game, return null.

EXAMPLES OF FIGURES TO REJECT for "global" (return null):
  - "Payday 2 brought in $3.9 million in sales in FY2024" → revenue + fiscal period
  - "moved 200,000 copies in the first week" → periodic
  - "earned $50M in Q1" → revenue + periodic
  - "the God of War franchise has sold an estimated 66 million games worldwide" → franchise total, not the target game
  - "the series' installments have sold 88.7 million copies worldwide" → series total, not the target game
  - "Mortal Kombat 1 has sold 5 million copies, with the franchise now up to 100 million" → keep 5M (the target game) in "global", NEVER the 100M franchise total

If the article only reports periodic, fiscal or monetary figures with no cumulative unit total, set "global" to null. Do NOT try to infer a cumulative unit total from such data.

- "global": the cumulative WORLDWIDE (all-platforms combined) sales total in UNITS. Convert to an integer (e.g. "5 million" -> 5000000). This MUST be an all-platforms total — NEVER report a single-platform figure here. If only a single-platform figure is stated, set "global" to null and put it in the matching per-platform field ("pc"/"ps"/"xbox"/"switch") instead.
  For "date": look EVERYWHERE in the provided text for a date associated with this figure — the article byline, publication metadata, introductory sentence, phrases like "as of [date]", "by [date]", "in fiscal Q… [year]", "announced [date]", etc. Use the most specific date you can find that is plausibly associated with the figure. Format as "YYYY-MM-DD", "YYYY-MM", or "YYYY". Only set null when no date can be inferred at all from the text.
  Put the verbatim sentence containing the figure in "quote".
- "pc" / "ps" / "xbox" / "switch": the cumulative LIFETIME copies-sold total for the target base game ON THAT ONE PLATFORM ONLY. Route each single-platform figure to its field:
  - "pc": "X copies sold on Steam", "X million on PC", "X copies on Steam/Epic/PC". Treat a Steam-only number as PC.
  - "ps": "X on PlayStation", "X copies on PS5/PS4", "X on the PlayStation Store".
  - "xbox": "X on Xbox", "X copies on Xbox Series/Xbox One".
  - "switch": "X on Nintendo Switch", "X copies on Switch".
  Each is a single-platform total, DISTINCT from the worldwide "global" total — never put the same number in both, and never put a single number in more than one platform field. Same rules as "global": cumulative lifetime only (no first-week/periodic/fiscal), units only (no $/€/£/¥ or revenue), target base game only (no DLC/series). Every per-platform figure MUST be less than or equal to the "global" total when both are present. Same "date" and "quote" rules as "global". Set a field to null when no figure for that specific platform exists.
- "engagement": cumulative ENGAGEMENT milestones that are NOT copies sold but are still publisher-reported headline numbers about the target game. Examples to capture here (not in "global"):
    - "X million players have played the game"
    - "X million players reached" (especially when subscription users like Ubisoft+ / Xbox Game Pass / PS Plus are explicitly included)
    - "X million downloads" / "X million unique players"
  Must still be CUMULATIVE LIFETIME (not "X players this week"), must be about the TARGET game (not a series total), and must NOT be a monetary figure. Same "date" and "quote" rules as "global". Set null when no such figure exists.
  Periodic engagement ("100k players over the weekend") must be rejected.

Every "quote" MUST be copied verbatim from the provided text.`;

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matchesGame: { type: 'boolean' },
    attribution: { type: ['string', 'null'] },
    global: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
    pc: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
    ps: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
    xbox: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
    switch: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
    engagement: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        units: { type: 'integer' },
        date: { type: ['string', 'null'] },
        quote: { type: 'string' },
      },
      required: ['units', 'date', 'quote'],
    },
  },
  required: [
    'matchesGame',
    'attribution',
    'global',
    'pc',
    'ps',
    'xbox',
    'switch',
    'engagement',
  ],
};

@Injectable()
export class ArticleClient {
  private readonly logger = new Logger(ArticleClient.name);

  constructor(private readonly llm: LlmExtractorService) {}

  /**
   * Fetch a press article and have the LLM extract sales figures for the given
   * game. Every figure is grounded: its quote must appear verbatim in the page
   * text, otherwise it is dropped. Returns null when extraction is unavailable
   * (no API key, fetch failure, or nothing trustworthy found).
   */
  async extract(url: string, gameName: string): Promise<ArticleSales | null> {
    if (!this.llm.enabled) return null;
    try {
      const text = await this.fetchReadableText(url);
      return this.extractFromText(text, url, gameName);
    } catch (error) {
      this.logger.warn(`Article fetch failed for "${url}": ${error}`);
      return null;
    }
  }

  /**
   * Run the grounded LLM extraction on already-available article text (e.g. an
   * RSS feed's full content), without fetching the page. Same guarantees as
   * `extract`: every figure's quote must appear verbatim in the text.
   */
  async extractFromText(
    text: string,
    url: string,
    gameName: string,
    options: { fallbackDate?: Date | null } = {},
  ): Promise<ArticleSales | null> {
    if (!this.llm.enabled) return null;
    if (!text || text.length < 200) return null;

    // Four-level date fallback (applied when primary extraction yields no date):
    //   1. LLM-extracted date from figure context
    //   2. Caller-provided date (e.g. Tavily publishedDate or RSS item date)
    //   3. Date embedded in the URL path  (/2025/06/15/)
    //   4. Dedicated LLM date-extraction pass on the article beginning
    const urlDate = this.dateFromUrl(url);
    const knownFallback = options.fallbackDate ?? urlDate ?? null;

    try {
      const result = await this.llm.extract<LlmResult>({
        system: SYSTEM_PROMPT,
        user: `Target game: ${gameName}\n\nArticle text:\n${text.slice(0, MAX_TEXT_CHARS)}`,
        schemaName: 'article_game_sales',
        schema: SCHEMA,
      });
      if (!result || !result.matchesGame) return null;

      const isGrounded = this.grounder(text);

      // Run the dedicated date extractor only when needed (at least one figure
      // has no date and we have no other fallback). One call covers all figures.
      const rawFigures = [
        result.global,
        result.pc,
        result.ps,
        result.xbox,
        result.switch,
        result.engagement,
      ];
      const needsDedicatedDatePass =
        !knownFallback &&
        rawFigures.some((figure) => figure != null && figure.date == null);

      const dedicatedDate = needsDedicatedDatePass
        ? await this.resolveArticleDate(text)
        : null;

      const effectiveFallback = knownFallback ?? dedicatedDate ?? null;

      // A sales figure without a date is essentially useless: it can't be
      // placed on the timeline, tie-broken against newer figures, or drive the
      // calibrated multiplier. `requirePositive` additionally drops zero-unit
      // single-platform / engagement figures.
      const accept = (
        raw: LlmFigure | null,
        requirePositive: boolean,
      ): ArticleFigure | null => {
        if (!raw || !isGrounded(raw.quote) || isPeriodicQuote(raw.quote)) {
          return null;
        }
        const figure = this.toFigure(raw, effectiveFallback);
        if (!figure.reportedAt) return null;
        if (requirePositive && !(figure.units > 0)) return null;
        return figure;
      };

      const global = accept(result.global, false);
      // A single-platform figure larger than the worldwide total is a
      // misclassification (the model mislabeled a global number as
      // platform-specific, or vice versa) — reject it.
      const capToGlobal = (
        figure: ArticleFigure | null,
      ): ArticleFigure | null =>
        figure && global && figure.units > global.units * 1.15 ? null : figure;

      const pc = capToGlobal(accept(result.pc, true));
      const ps = capToGlobal(accept(result.ps, true));
      const xbox = capToGlobal(accept(result.xbox, true));
      const switchFigure = capToGlobal(accept(result.switch, true));
      const engagement = accept(result.engagement, true);

      // Cross-platform consistency: the single-platform figures must not sum
      // to more than the worldwide total (15% slack for timing/rounding). A
      // breakdown that overshoots is internally inconsistent (likely a
      // mislabeled figure), so drop the per-platform figures and keep only the
      // worldwide / engagement numbers, which are trustworthy on their own.
      const platformSum =
        (pc?.units ?? 0) +
        (ps?.units ?? 0) +
        (xbox?.units ?? 0) +
        (switchFigure?.units ?? 0);
      const platformsConsistent = !global || platformSum <= global.units * 1.15;

      if (!global && !pc && !ps && !xbox && !switchFigure && !engagement) {
        return null;
      }
      return {
        global,
        pc: platformsConsistent ? pc : null,
        ps: platformsConsistent ? ps : null,
        xbox: platformsConsistent ? xbox : null,
        switch: platformsConsistent ? switchFigure : null,
        engagement,
        attribution: result.attribution,
      };
    } catch (error) {
      this.logger.warn(`Article extraction failed for "${url}": ${error}`);
      return null;
    }
  }

  // Convert an HTML fragment (e.g. an RSS content:encoded body) to plain text.
  htmlToText(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, noscript, figure, figcaption').remove();
    const parts: string[] = [];
    $('p, li, h1, h2, h3').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 0) parts.push(t);
    });
    const text = parts.join('\n');
    return text.length > 0
      ? text
      : $.root().text().replace(/\s+/g, ' ').trim();
  }

  // Pull the main editorial text out of the page, dropping boilerplate.
  private async fetchReadableText(url: string): Promise<string> {
    const { data } = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 20000,
      responseType: 'text',
    });

    const $ = cheerio.load(data);
    $('script, style, noscript, nav, header, footer, aside, form').remove();

    const root = $('article').first().length
      ? $('article').first()
      : $('main').first().length
        ? $('main').first()
        : $('body');

    const parts: string[] = [];
    const headline = $('h1').first().text().trim();
    if (headline) parts.push(headline);

    root.find('p, li, h2, h3').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 0) parts.push(t);
    });

    return parts.join('\n').slice(0, MAX_TEXT_CHARS);
  }

  private grounder(text: string): (quote: string) => boolean {
    const normalized = text.replace(/\s+/g, ' ');
    return (quote: string) => {
      if (!quote) return false;
      return normalized.includes(quote.replace(/\s+/g, ' ').trim());
    };
  }

  private toFigure(figure: LlmFigure, fallbackDate?: Date | null): ArticleFigure {
    return {
      units: figure.units,
      // Use the LLM-extracted date when present; fall back to the article's
      // publication date (e.g. from a Tavily result) when the text itself
      // doesn't state a date but we know when the article was written.
      reportedAt: this.parseDate(figure.date) ?? fallbackDate ?? null,
      quote: figure.quote.replace(/\s+/g, ' ').trim(),
    };
  }

  /**
   * Dedicated LLM call to extract only the publication/event date from an
   * article. Used as a last resort when neither the primary extraction, the
   * caller-provided date, nor the URL contain a date.
   */
  async resolveArticleDate(text: string): Promise<Date | null> {
    if (!this.llm.enabled || !text || text.length < 100) return null;
    try {
      const result = await this.llm.extract<LlmDateResult>({
        system: DATE_PROMPT,
        user: `Article text:\n${text.slice(0, 3000)}`,
        schemaName: 'article_date',
        schema: DATE_SCHEMA,
      });
      return this.parseDate(result?.date ?? null);
    } catch {
      return null;
    }
  }

  /**
   * Attempt to parse a publication date embedded in the URL path.
   * Handles patterns like:
   *   /2025/06/15/  → 2025-06-15
   *   /2025/06/     → 2025-06-01
   *   /2025-06-15/  → 2025-06-15
   *   ?date=2025-06-15
   */
  dateFromUrl(url: string): Date | null {
    try {
      const path = new URL(url).pathname;
      // /YYYY/MM/DD or /YYYY/MM
      const slashDate = path.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?/);
      if (slashDate) {
        const [, y, m, d] = slashDate;
        const year = Number(y);
        const month = Number(m);
        if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
          return new Date(Date.UTC(year, month - 1, d ? Number(d) : 1));
        }
      }
      // -YYYY-MM-DD or _YYYY-MM-DD
      const dashDate = path.match(/[_-](\d{4})-(\d{2})-(\d{2})/);
      if (dashDate) {
        const year = Number(dashDate[1]);
        const month = Number(dashDate[2]);
        const day = Number(dashDate[3]);
        if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
          return new Date(Date.UTC(year, month - 1, day));
        }
      }
    } catch {
      // invalid URL — ignore
    }
    return null;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const ymd = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (ymd) {
      return new Date(
        Date.UTC(
          Number(ymd[1]),
          ymd[2] ? Number(ymd[2]) - 1 : 0,
          ymd[3] ? Number(ymd[3]) : 1,
        ),
      );
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
}

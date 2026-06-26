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
  - DLC, expansions, bundles, remasters, the franchise/series, or other games

EXAMPLES OF FIGURES TO REJECT for "global" (return null):
  - "Payday 2 brought in $3.9 million in sales in FY2024" → revenue + fiscal period
  - "moved 200,000 copies in the first week" → periodic
  - "earned $50M in Q1" → revenue + periodic

If the article only reports periodic, fiscal or monetary figures with no cumulative unit total, set "global" to null. Do NOT try to infer a cumulative unit total from such data.

- "global": the cumulative WORLDWIDE (all-platforms combined) sales total in UNITS. Convert to an integer (e.g. "5 million" -> 5000000). We only track worldwide totals — NEVER report a single-platform figure (e.g. "3 million sold on PS5") here; if only a single-platform number is stated, set "global" to null.
  For "date": look EVERYWHERE in the provided text for a date associated with this figure — the article byline, publication metadata, introductory sentence, phrases like "as of [date]", "by [date]", "in fiscal Q… [year]", "announced [date]", etc. Use the most specific date you can find that is plausibly associated with the figure. Format as "YYYY-MM-DD", "YYYY-MM", or "YYYY". Only set null when no date can be inferred at all from the text.
  Put the verbatim sentence containing the figure in "quote".
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
  required: ['matchesGame', 'attribution', 'global', 'engagement'],
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
      const needsDedicatedDatePass =
        !knownFallback &&
        ((result.global?.date == null && result.global != null) ||
          (result.engagement?.date == null && result.engagement != null));

      const dedicatedDate = needsDedicatedDatePass
        ? await this.resolveArticleDate(text)
        : null;

      const effectiveFallback = knownFallback ?? dedicatedDate ?? null;

      const globalCandidate =
        result.global &&
        isGrounded(result.global.quote) &&
        !isPeriodicQuote(result.global.quote)
          ? this.toFigure(result.global, effectiveFallback)
          : null;
      // A sales figure without a date is essentially useless: it can't be
      // placed on the timeline, can't be tie-broken against newer figures,
      // and can't drive the calibrated multiplier. Drop it.
      const global =
        globalCandidate && globalCandidate.reportedAt ? globalCandidate : null;

      const engagementCandidate =
        result.engagement &&
        isGrounded(result.engagement.quote) &&
        !isPeriodicQuote(result.engagement.quote)
          ? this.toFigure(result.engagement, effectiveFallback)
          : null;
      const engagement =
        engagementCandidate &&
        engagementCandidate.reportedAt &&
        engagementCandidate.units > 0
          ? engagementCandidate
          : null;

      if (!global && !engagement) return null;
      return {
        global,
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

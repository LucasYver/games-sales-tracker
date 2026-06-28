import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { LlmExtractorService } from '../llm/llm-extractor.service';
import { isPeriodicQuote } from './sales-figure.utils';

export interface WikipediaFigure {
  units: number;
  reportedAt: Date | null;
  quote: string;
}

export interface WikipediaSales {
  global: WikipediaFigure | null;
  // PC-only cumulative copies-sold figure (e.g. "X copies sold on Steam").
  // Captured separately from `global` because it is a single-platform total,
  // not a worldwide one: it gives a direct, assumption-free PC signal for
  // calibrating the PC Boxleiter multiplier. Only PC is captured.
  pc: WikipediaFigure | null;
  // Engagement milestone (e.g. "X million players", "X downloads"). Stored
  // separately so it can never feed the sales reconciliation / calibration
  // math — it conflates copies sold with subscription users and free trials.
  engagement: WikipediaFigure | null;
  sourceUrl: string;
}

interface LlmFigure {
  units: number;
  date: string | null;
  quote: string;
}
interface LlmResult {
  global: LlmFigure | null;
  pc: LlmFigure | null;
  engagement: LlmFigure | null;
}

const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT =
  'GameSalesTracker/0.1 (sales-intelligence prototype; contact@example.com)';
const MAX_TEXT_CHARS = 24000;

const SYSTEM_PROMPT = `You are a precise data extractor. You are given the plain text of a Wikipedia article about a video game. Extract sales figures ONLY when explicitly stated in the text. NEVER use outside knowledge and NEVER estimate.

CUMULATIVE UNITS ONLY for "global" — only put a figure there if it represents the TOTAL CUMULATIVE LIFETIME number of UNITS (copies) sold for the game ("has sold X copies", "X copies sold to date", "X copies as of [date]"). 
NEVER put in "global":
  - "sold X in its first week / first month / launch weekend"
  - "X copies in [year/quarter]" when it is clearly a periodic figure (e.g. "X in Q1", "weekly sales of X")
  - "X players" / "X downloads" / "X concurrent users" / "X subscribers" — these are engagement metrics; see the "engagement" field below
  - MONETARY figures: any number with $/€/£/¥ or words like "revenue", "earnings", "turnover". In English finance, "sales" often means revenue: "$3.9 million in sales" is REVENUE, NOT 3.9M units. If a currency sign appears, REJECT.
  - DLC, expansions, bundles, remasters, the franchise/series, or other games

EXAMPLES OF FIGURES TO REJECT for "global" (return null):
  - "the game brought in $3.9 million in sales in FY2024" → revenue + fiscal period
  - "moved 200,000 copies in the first week" → periodic

- "global": the most RECENT cumulative WORLDWIDE (all-platforms combined) sales total for the base game in UNITS (copies/units sold or shipped). Convert to an integer (e.g. "30 million" -> 30000000). If several dated cumulative figures exist, choose the most recent one. This MUST be an all-platforms total — NEVER report a single-platform figure here. If only a single-platform PC figure is stated, set "global" to null and put it in "pc"; if only a single-platform PS/Xbox/Switch/mobile figure is stated, set "global" to null and ignore that figure. Put that figure's date in "date" as "YYYY-MM-DD", "YYYY-MM" or "YYYY" (null if none is stated). Put the verbatim sentence the figure comes from in "quote".
- "pc": the most RECENT cumulative LIFETIME copies-sold total for the target base game ON PC SPECIFICALLY — and ONLY the PC platform. Capture figures like "X copies sold on Steam", "X million on PC". Treat a Steam-only number as PC. This is a single-platform PC total, DISTINCT from the worldwide "global" total — never put the same number in both. Same rules as "global": cumulative lifetime only, units only (no $/€/£/¥ or revenue), target base game only. Do NOT capture PS / Xbox / Switch / mobile single-platform figures — only PC. Same date/quote rules. Set null when no PC-specific figure exists.
- "engagement": the most RECENT cumulative ENGAGEMENT milestone reported for the target base game when no copies-sold number is available (or in addition to it). Examples to capture here (NOT in "global"):
    - "X million players have played the game"
    - "X million players reached" (especially when subscription users like Ubisoft+ / Xbox Game Pass / PS Plus are explicitly included)
    - "X million downloads" / "X million unique players"
  Must be CUMULATIVE LIFETIME for the TARGET base game. Same date/quote rules as "global". Set null when no such figure exists.
- If no reliable figure exists at all, set "global" to null and "engagement" to null.

Every "quote" MUST be copied verbatim from the provided text.`;

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
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
  required: ['global', 'pc', 'engagement'],
};

@Injectable()
export class WikipediaClient {
  private readonly logger = new Logger(WikipediaClient.name);

  constructor(private readonly llm: LlmExtractorService) {}

  /**
   * Resolve a game's Wikipedia article and have the LLM extract its sales
   * figures from the article text. Every figure is grounded: its quote must
   * appear verbatim in the source text, otherwise it is rejected. Returns null
   * when extraction is unavailable (no API key) or nothing trustworthy found.
   */
  async getWorldwideSales(name: string): Promise<WikipediaSales | null> {
    if (!this.llm.enabled) return null;

    try {
      const article = await this.resolveArticle(name);
      if (!article) return null;

      const text = article.extract.slice(0, MAX_TEXT_CHARS);
      const result = await this.llm.extract<LlmResult>({
        system: SYSTEM_PROMPT,
        user: `Title: ${article.title}\n\n${text}`,
        schemaName: 'wikipedia_game_sales',
        schema: SCHEMA,
      });
      if (!result) return null;

      const isGrounded = this.grounder(text);
      const sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(
        article.title.replace(/ /g, '_'),
      )}`;

      const globalCandidate =
        result.global &&
        isGrounded(result.global.quote) &&
        !isPeriodicQuote(result.global.quote)
          ? this.toFigure(result.global)
          : null;
      // No date = no record. Wikipedia almost always cites a date next to a
      // figure ("As of March 2024…"); when it doesn't, the figure is too
      // ambiguous to be useful for the timeline or for reconciliation.
      const global =
        globalCandidate && globalCandidate.reportedAt ? globalCandidate : null;

      const pcCandidate =
        result.pc &&
        isGrounded(result.pc.quote) &&
        !isPeriodicQuote(result.pc.quote)
          ? this.toFigure(result.pc)
          : null;
      const pc =
        pcCandidate && pcCandidate.reportedAt && pcCandidate.units > 0
          ? pcCandidate
          : null;

      const engagementCandidate =
        result.engagement &&
        isGrounded(result.engagement.quote) &&
        !isPeriodicQuote(result.engagement.quote)
          ? this.toFigure(result.engagement)
          : null;
      const engagement =
        engagementCandidate &&
        engagementCandidate.reportedAt &&
        engagementCandidate.units > 0
          ? engagementCandidate
          : null;

      if (!global && !pc && !engagement) return null;
      return { global, pc, engagement, sourceUrl };
    } catch (error) {
      // Rate-limit (429) is a transient issue — log at debug only so we don't
      // spam the console; the other sources (RSS, Tavily, stores) will pick up
      // the slack and the next refresh will retry Wikipedia.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 429) {
        this.logger.debug(`Wikipedia rate-limited for "${name}", skipping`);
      } else {
        this.logger.warn(`Wikipedia lookup failed for "${name}": ${error}`);
      }
      return null;
    }
  }

  // Verifies a quote exists in the source text (whitespace-insensitive) so the
  // model cannot smuggle in a figure that is not actually written there.
  private grounder(text: string): (quote: string) => boolean {
    const normalized = text.replace(/\s+/g, ' ');
    return (quote: string) => {
      if (!quote) return false;
      return normalized.includes(quote.replace(/\s+/g, ' ').trim());
    };
  }

  private toFigure(figure: LlmFigure): WikipediaFigure {
    return {
      units: figure.units,
      reportedAt: this.parseDate(figure.date),
      quote: figure.quote.replace(/\s+/g, ' ').trim(),
    };
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

  private async resolveArticle(
    name: string,
  ): Promise<{ title: string; extract: string } | null> {
    for (const candidate of [name, `${name} (video game)`]) {
      const page = await this.fetchExtract(candidate);
      if (page && this.leadIsGame(page.extract)) return page;
    }

    for (const title of await this.search(`${name} video game`)) {
      const page = await this.fetchExtract(title);
      if (
        page &&
        this.leadIsGame(page.extract) &&
        this.normalize(page.title).includes(this.normalize(name).slice(0, 6))
      ) {
        return page;
      }
    }
    return null;
  }

  private async fetchExtract(
    title: string,
  ): Promise<{ title: string; extract: string } | null> {
    const { data } = await axios.get(API, {
      params: {
        action: 'query',
        prop: 'extracts',
        explaintext: 1,
        redirects: 1,
        format: 'json',
        titles: title,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });

    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = pages[Object.keys(pages)[0]];
    if (!page || page.missing !== undefined) return null;

    const extract: string = page.extract ?? '';
    if (/may refer to/i.test(extract)) return null; // disambiguation page
    return { title: page.title, extract };
  }

  private async search(query: string): Promise<string[]> {
    const { data } = await axios.get(API, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: 3,
        format: 'json',
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });
    return (data?.query?.search ?? []).map((s: { title: string }) => s.title);
  }

  private leadIsGame(extract: string): boolean {
    return /\bis an?\b.{0,80}?\bgame\b/is.test(extract.slice(0, 300));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }
}

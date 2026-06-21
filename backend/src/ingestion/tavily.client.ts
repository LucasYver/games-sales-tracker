import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const TAVILY_URL = 'https://api.tavily.com/search';

export interface TavilyResult {
  title: string;
  url: string;
  // Short relevance snippet; always present.
  content: string;
  // Full cleaned page text; present when include_raw_content succeeds.
  rawContent: string | null;
  publishedDate: string | null;
  score: number;
}

/**
 * Thin wrapper around Tavily's web search API. Used to discover backlog
 * articles (sales coverage published before we started polling feeds) and
 * return their full page text so the existing grounded LLM extractor can run
 * on it. Disabled (returns []) when no API key is configured.
 */
@Injectable()
export class TavilyClient {
  private readonly logger = new Logger(TavilyClient.name);
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('TAVILY_API_KEY') ?? null;
    if (!this.apiKey) {
      this.logger.warn(
        'TAVILY_API_KEY not set: backlog web discovery will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Run a web search and return results with their full page text. Best-effort:
   * returns [] when disabled or on any API failure.
   */
  async search(
    query: string,
    options: { maxResults?: number; excludeDomains?: string[] } = {},
  ): Promise<TavilyResult[]> {
    if (!this.apiKey) return [];

    try {
      const { data } = await axios.post<{
        results?: {
          title?: string;
          url?: string;
          content?: string;
          raw_content?: string | null;
          published_date?: string | null;
          score?: number;
        }[];
      }>(
        TAVILY_URL,
        {
          query,
          search_depth: 'advanced',
          topic: 'general',
          max_results: options.maxResults ?? 8,
          include_raw_content: 'text',
          ...(options.excludeDomains && options.excludeDomains.length > 0
            ? { exclude_domains: options.excludeDomains }
            : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      return (data.results ?? [])
        .filter((r) => r.url && r.title)
        .map((r) => ({
          title: r.title as string,
          url: r.url as string,
          content: r.content ?? '',
          rawContent: r.raw_content ?? null,
          publishedDate: r.published_date ?? null,
          score: r.score ?? 0,
        }));
    } catch (error) {
      this.logger.warn(`Tavily search failed for "${query}": ${error}`);
      return [];
    }
  }
}

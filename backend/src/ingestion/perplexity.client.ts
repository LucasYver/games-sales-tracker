import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TavilyResult } from './tavily.client';

const PERPLEXITY_URL = 'https://api.perplexity.ai/search';

interface PerplexityApiResult {
  title?: string;
  url?: string;
  // Perplexity's "snippet" is not a teaser: with search_context_size="high"
  // (default) it contains a substantial, relevance-extracted passage of the
  // page — comparable in usefulness to Tavily's raw_content for the same URL.
  snippet?: string;
  date?: string | null;
  last_updated?: string | null;
}

/**
 * Thin wrapper around Perplexity's Search API (https://api.perplexity.ai/search).
 * Returned in the same `TavilyResult` shape used by the rest of the ingestion
 * pipeline so it can plug into `discoverBacklog` as a drop-in alternative.
 * Disabled (returns []) when no API key is configured.
 *
 * Pricing note: Perplexity bills $5 / 1000 requests with NO per-token cost on
 * the Search API. A multi-query batch (up to 5 queries in one POST) counts as
 * one request, so we can run our 4-variant query set for the same price as a
 * single Tavily call.
 */
@Injectable()
export class PerplexityClient {
  private readonly logger = new Logger(PerplexityClient.name);
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('PERPLEXITY_API_KEY') ?? null;
    if (!this.apiKey) {
      this.logger.warn(
        'PERPLEXITY_API_KEY not set: Perplexity backlog discovery will be skipped.',
      );
    }
  }

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Run one or more web search queries in a single API call (multi-query batch,
   * up to 5 queries). Returns deduplicated results across all queries — order
   * preserved per Perplexity's ranking. Best-effort: returns [] when disabled
   * or on any API failure.
   *
   * Note: Perplexity's Search API uses an allowlist OR denylist filter (not
   * both). `excludeDomains` is mapped to the denylist form (prefix `-`).
   */
  async search(
    queries: string[],
    options: { maxResults?: number; excludeDomains?: string[] } = {},
  ): Promise<TavilyResult[]> {
    if (!this.apiKey || queries.length === 0) return [];

    const batched = queries.slice(0, 5);
    try {
      const { data } = await axios.post<{
        results?: PerplexityApiResult[] | PerplexityApiResult[][];
      }>(
        PERPLEXITY_URL,
        {
          query: batched.length === 1 ? batched[0] : batched,
          max_results: options.maxResults ?? 10,
          search_context_size: 'high',
          ...(options.excludeDomains && options.excludeDomains.length > 0
            ? {
                search_domain_filter: options.excludeDomains
                  .slice(0, 20)
                  .map((d) => `-${d}`),
              }
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

      // Multi-query returns results grouped per query (array of arrays);
      // single-query returns a flat array. Normalize to a flat list.
      const raw = data.results ?? [];
      const flat: PerplexityApiResult[] = Array.isArray(raw[0])
        ? (raw as PerplexityApiResult[][]).flat()
        : (raw as PerplexityApiResult[]);

      // Dedupe by URL — multi-query batches commonly surface the same URL for
      // overlapping queries. Keep the first occurrence (best rank).
      const seen = new Set<string>();
      const out: TavilyResult[] = [];
      for (const r of flat) {
        if (!r.url || !r.title || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({
          title: r.title,
          url: r.url,
          // Map snippet onto `content` AND `rawContent` so the downstream
          // extractor (which prefers rawContent) can run on the extracted
          // passage without a second fetch.
          content: r.snippet ?? '',
          rawContent: r.snippet ?? null,
          publishedDate: r.date ?? r.last_updated ?? null,
          // Perplexity does not return a numeric score; use a descending
          // rank-based pseudo-score so the existing merge logic still works.
          score: out.length === 0 ? 1 : 1 / (out.length + 1),
        });
      }
      return out;
    } catch (error) {
      this.logger.warn(
        `Perplexity search failed for ${batched.length} query/queries: ${error}`,
      );
      return [];
    }
  }
}

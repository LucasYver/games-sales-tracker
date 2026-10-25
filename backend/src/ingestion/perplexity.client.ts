import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { ProviderCooldown } from '../entities/provider-cooldown.entity';
import { TavilyResult } from './tavily.client';

const PERPLEXITY_URL = 'https://api.perplexity.ai/search';
const PROVIDER_KEY = 'perplexity';
/** How long to skip Perplexity after a credit/billing failure. */
const CREDIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

export type PerplexitySearchStatus =
  | 'ok'
  | 'skipped_no_key'
  | 'skipped_cooldown'
  | 'credit_exhausted'
  | 'error';

export interface PerplexitySearchOutcome {
  status: PerplexitySearchStatus;
  results: TavilyResult[];
  /** Set when status is credit_exhausted or skipped_cooldown. */
  cooldownUntil?: Date | null;
}

class PerplexityCreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerplexityCreditError';
  }
}

/**
 * Thin wrapper around Perplexity's Search API (https://api.perplexity.ai/search).
 * Returned in the same `TavilyResult` shape used by the rest of the ingestion
 * pipeline so it can plug into `discoverBacklog` as the primary engine.
 * Disabled (returns skipped) when no API key is configured.
 *
 * Credit exhaustion trips a DB-backed cooldown (`provider_cooldown`) plus an
 * in-process mirror so a dead balance is not re-probed on every game during a
 * harvest wave, or on every cron across cold starts for a full day.
 *
 * Pricing note: Perplexity bills $5 / 1000 requests with NO per-token cost on
 * the Search API. A multi-query batch (up to 5 queries in one POST) counts as
 * one request.
 */
@Injectable()
export class PerplexityClient {
  private readonly logger = new Logger(PerplexityClient.name);
  private readonly apiKey: string | null;
  /** In-process mirror of DB cooldown — avoids a DB round-trip per game. */
  private memoryCooldownUntil: Date | null = null;
  /** Negative cache: after a DB miss, skip re-reads for a short window. */
  private cooldownMissCachedUntil = 0;

  constructor(
    config: ConfigService,
    @InjectRepository(ProviderCooldown)
    private readonly cooldowns: Repository<ProviderCooldown>,
  ) {
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
   * Run one or more web search queries and return a URL-deduplicated result
   * list. Perplexity's Search API accepts at most 5 queries per HTTP call, so
   * a larger set is split into chunks of 5 — each chunk is ONE billed request
   * (e.g. 9 queries → 2 requests). Chunks run in parallel and are deduped
   * across the whole set.
   *
   * Note: Perplexity's Search API uses an allowlist OR denylist filter (not
   * both). `excludeDomains` is mapped to the denylist form (prefix `-`).
   */
  async search(
    queries: string[],
    options: { maxResults?: number; excludeDomains?: string[] } = {},
  ): Promise<PerplexitySearchOutcome> {
    if (!this.apiKey || queries.length === 0) {
      return { status: 'skipped_no_key', results: [] };
    }

    const cooldownUntil = await this.getActiveCooldownUntil();
    if (cooldownUntil) {
      return {
        status: 'skipped_cooldown',
        results: [],
        cooldownUntil,
      };
    }

    const chunks: string[][] = [];
    for (let i = 0; i < queries.length; i += 5) {
      chunks.push(queries.slice(i, i + 5));
    }

    try {
      // Sequential chunks on purpose: if the first billed request trips a
      // credit/billing error, we must not fire the remaining chunks.
      const seen = new Set<string>();
      const out: TavilyResult[] = [];
      for (const chunk of chunks) {
        const list = await this.searchBatch(chunk, options);
        for (const r of list) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          out.push(r);
        }
      }

      return { status: 'ok', results: out };
    } catch (error) {
      if (error instanceof PerplexityCreditError) {
        const until = await this.tripCreditCooldown(error.message);
        return {
          status: 'credit_exhausted',
          results: [],
          cooldownUntil: until,
        };
      }
      this.logger.warn(`Perplexity search failed: ${error}`);
      return { status: 'error', results: [] };
    }
  }

  // Run a single billed Perplexity request for up to 5 queries.
  private async searchBatch(
    batched: string[],
    options: { maxResults?: number; excludeDomains?: string[] },
  ): Promise<TavilyResult[]> {
    if (!this.apiKey || batched.length === 0) return [];
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

      // Dedupe by URL within this batch — keep the first occurrence (best rank).
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
      if (isPerplexityCreditError(error)) {
        throw new PerplexityCreditError(formatAxiosError(error));
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async getActiveCooldownUntil(): Promise<Date | null> {
    const now = Date.now();
    if (this.memoryCooldownUntil && this.memoryCooldownUntil.getTime() > now) {
      return this.memoryCooldownUntil;
    }
    // After a recent miss, trust memory for ~1 min so a harvest wave does
    // not hit the DB on every game. Other instances still write/read DB.
    if (now < this.cooldownMissCachedUntil) {
      return null;
    }
    try {
      const row = await this.cooldowns.findOne({
        where: { provider: PROVIDER_KEY },
      });
      if (row && row.disabledUntil.getTime() > now) {
        this.memoryCooldownUntil = row.disabledUntil;
        this.cooldownMissCachedUntil = 0;
        return row.disabledUntil;
      }
      this.memoryCooldownUntil = null;
      this.cooldownMissCachedUntil = now + 60_000;
      return null;
    } catch (error) {
      // Table missing mid-deploy should not block backlog search.
      this.logger.warn(`Perplexity cooldown read failed: ${error}`);
      this.cooldownMissCachedUntil = now + 60_000;
      return this.memoryCooldownUntil &&
        this.memoryCooldownUntil.getTime() > now
        ? this.memoryCooldownUntil
        : null;
    }
  }

  private async tripCreditCooldown(reason: string): Promise<Date> {
    const until = new Date(Date.now() + CREDIT_COOLDOWN_MS);
    this.memoryCooldownUntil = until;
    this.cooldownMissCachedUntil = 0;
    try {
      await this.cooldowns.save(
        this.cooldowns.create({
          provider: PROVIDER_KEY,
          disabledUntil: until,
          reason: reason.slice(0, 2000),
        }),
      );
    } catch (error) {
      this.logger.warn(`Perplexity cooldown write failed: ${error}`);
    }
    this.logger.warn(
      `Perplexity credit/billing failure — skipping until ${until.toISOString()} (${reason.slice(0, 200)})`,
    );
    return until;
  }
}

function isPerplexityCreditError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  const body = JSON.stringify(error.response?.data ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  const text = `${body} ${message}`;

  if (status === 402) return true;
  if (
    (status === 401 || status === 403 || status === 429) &&
    /credit|quota|billing|payment|insufficient|balance|spend|out of|exceeded|limit/.test(
      text,
    )
  ) {
    return true;
  }
  return /insufficient.?credit|out of credit|payment.?required|billing|quota.?exceeded|spend.?limit/.test(
    text,
  );
}

function formatAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) return String(error);
  const status = error.response?.status;
  const data: unknown = error.response?.data;
  const detail =
    typeof data === 'string'
      ? data
      : data
        ? JSON.stringify(data)
        : error.message;
  return status ? `HTTP ${status}: ${detail}` : detail;
}

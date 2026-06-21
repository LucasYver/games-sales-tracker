import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface SearchableSource {
  host: string | null;
  searchUrlTemplate: string | null;
}

@Injectable()
export class DiscoveryClient {
  private readonly logger = new Logger(DiscoveryClient.name);

  /**
   * Discover candidate article URLs for a game by scraping the on-site search
   * results of each trusted source. Only same-host links whose slug contains
   * every significant game token are kept, which both ensures relevance and
   * silently drops JS-rendered search pages that return generic navigation.
   * Best-effort: a failed/blocked source yields nothing.
   */
  async findArticles(
    name: string,
    sources: SearchableSource[],
    options: { perSite?: number; total?: number } = {},
  ): Promise<string[]> {
    const perSite = options.perSite ?? 3;
    const total = options.total ?? 8;
    const tokens = this.gameTokens(name);
    if (tokens.length === 0) return [];

    // Bias each outlet's ranking toward sales coverage while still filtering
    // result slugs by the game tokens for relevance.
    const query = `${name} sales`;
    const found = new Set<string>();
    for (const source of sources) {
      if (found.size >= total) break;
      if (!source.host || !source.searchUrlTemplate) continue;

      try {
        const urls = await this.searchSite(
          source.searchUrlTemplate,
          source.host,
          query,
          tokens,
          perSite,
        );
        for (const url of urls) {
          if (found.size >= total) break;
          found.add(url);
        }
      } catch (error) {
        this.logger.warn(`Site search failed for ${source.host}: ${error}`);
      }
      await this.sleep(400);
    }

    return [...found];
  }

  private async searchSite(
    template: string,
    host: string,
    query: string,
    tokens: string[],
    limit: number,
  ): Promise<string[]> {
    const url = template.replace('{q}', encodeURIComponent(query));
    const { data } = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      responseType: 'text',
    });

    const $ = cheerio.load(data);
    const seen = new Set<string>();
    const matches: string[] = [];

    $('a[href]').each((_, el) => {
      if (matches.length >= limit) return;
      const href = $(el).attr('href');
      const abs = this.toAbsolute(href, host);
      if (!abs || seen.has(abs)) return;
      seen.add(abs);
      if (this.isArticleForGame(abs, host, tokens)) matches.push(abs);
    });

    return matches;
  }

  // Significant lowercase tokens of a game name (drops short words, symbols and
  // trademark marks) used to confirm a result URL is about that game.
  private gameTokens(name: string): string[] {
    return name
      .toLowerCase()
      .replace(/[™®©]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 4);
  }

  private isArticleForGame(
    url: string,
    host: string,
    tokens: string[],
  ): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const urlHost = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (urlHost !== host && !urlHost.endsWith(`.${host}`)) return false;

    const path = parsed.pathname.toLowerCase();
    // Skip taxonomy/navigation and hub/guide pages, keep real article slugs.
    if (
      /\/(tag|tags|category|categories|author|page|topic|games|guide|guides|wiki|review|reviews)\/?$/.test(
        path,
      ) ||
      /-(guide|guides|wiki|walkthrough|tips|cheats|mods|review)\/?$/.test(path)
    ) {
      return false;
    }
    const slug = path.replace(/[^a-z0-9]/g, '');
    // Real news slugs are long; hub pages like "/baldurs-gate-3/" are short.
    if (slug.length < 28) return false;
    return tokens.every((t) => slug.includes(t));
  }

  private toAbsolute(href: string | undefined, host: string): string | null {
    if (!href) return null;
    try {
      if (href.startsWith('http')) return href;
      if (href.startsWith('//')) return `https:${href}`;
      if (href.startsWith('/')) return `https://www.${host}${href}`;
      return null;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

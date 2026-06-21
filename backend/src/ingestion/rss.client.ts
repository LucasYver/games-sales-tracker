import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';

export interface FeedArticle {
  title: string;
  url: string;
  publishedAt: Date | null;
  // Best available body: full content when the feed provides it, otherwise the
  // summary/description. May contain HTML.
  contentHtml: string;
}

type FeedItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  ['content:encoded']?: string;
};

@Injectable()
export class RssClient {
  private readonly logger = new Logger(RssClient.name);
  private readonly parser = new Parser<unknown, FeedItem>({
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; GameSalesTracker/0.1; +https://example.com/bot)',
    },
    customFields: { item: [['content:encoded', 'content:encoded']] },
  });

  /**
   * Fetch and parse an RSS/Atom feed into normalized articles. Best-effort: a
   * failed/blocked feed yields an empty list.
   */
  async fetchArticles(feedUrl: string): Promise<FeedArticle[]> {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      const articles: FeedArticle[] = [];
      for (const item of feed.items ?? []) {
        if (!item.link || !item.title) continue;
        const contentHtml =
          item['content:encoded'] ||
          item.content ||
          item.contentSnippet ||
          '';
        articles.push({
          title: item.title.trim(),
          url: item.link.trim(),
          publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
          contentHtml,
        });
      }
      return articles;
    } catch (error) {
      this.logger.warn(`Feed fetch failed for "${feedUrl}": ${error}`);
      return [];
    }
  }

  private parseDate(value: string | undefined): Date | null {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : new Date(ts);
  }
}

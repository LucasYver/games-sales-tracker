import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Platform } from '../entities';

export interface ExophaseAchievement {
  slug: string;
  name: string;
  percentEarned: number;
}

export interface ExophaseGameAchievements {
  platform: Platform;
  sourceUrl: string;
  gameTitle: string;
  playersTracked: number;
  totalAchievements: number;
  achievements: ExophaseAchievement[];
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SEARCH_API = 'https://api.exophase.com/public/archive/games';

// Exophase groups its catalog into "environments". One of these per platform
// we track; anything else (retro consoles, mobile, …) is ignored.
const EXOPHASE_ENVIRONMENT: Record<string, string> = {
  [Platform.PC]: 'steam',
  [Platform.PLAYSTATION]: 'psn',
  [Platform.XBOX]: 'xbox',
};

// PSN entries are split per console generation (ps4 / ps5 / ps3 / vita). We
// pick the most recent generation with a usable sample so the snapshot
// reflects the active playerbase rather than legacy carry-overs.
const PSN_PLATFORM_PRIORITY = ['ps5', 'ps4', 'ps3', 'vita'];

// Below these thresholds the sample is too small / the data too noisy to be
// useful. Returning null is safer than persisting an unreliable snapshot.
const MIN_PLAYERS_TRACKED = 100;
const MIN_MOST_COMMON_PERCENT = 1;
const MIN_ACHIEVEMENTS = 1;
const MAX_ACHIEVEMENTS = 1000;

interface ExophaseSearchGame {
  master_id: number;
  title: string;
  environment_slug: string;
  global_players: number;
  total_awards: number;
  endpoint_awards: string;
  platforms?: Array<{ slug: string; name: string }>;
}

interface ExophaseSearchResponse {
  success: boolean;
  games?: {
    list?: ExophaseSearchGame[];
  };
}

@Injectable()
export class ExophaseClient {
  private readonly logger = new Logger(ExophaseClient.name);

  /**
   * Fetch achievement stats for a game on a given platform from Exophase.
   * Resolves the exact game page via Exophase's public search API (so we
   * don't have to guess slugs that differ per console generation), then
   * scrapes the achievements/trophies page. Best-effort: returns null on
   * any error or if the scraped data fails validation (small sample, no
   * match, malformed page).
   */
  async getAchievements(
    name: string,
    platform: Platform,
  ): Promise<ExophaseGameAchievements | null> {
    const environment = EXOPHASE_ENVIRONMENT[platform];
    if (!environment) {
      this.logger.debug(
        `[exophase] platform ${platform} not supported — skipping`,
      );
      return null;
    }

    try {
      const candidates = await this.search(name);
      const match = this.pickBestMatch(candidates, name, environment);
      if (!match) {
        this.logger.debug(
          `[exophase] "${name}" (${platform}) — no matching entry in search results`,
        );
        return null;
      }

      // Cheap pre-check using API metadata: if the tracked sample is below
      // threshold we don't even bother fetching the page.
      if (match.global_players < MIN_PLAYERS_TRACKED) {
        this.logger.debug(
          `[exophase] "${name}" (${platform}) — search hit has sample too small (${match.global_players})`,
        );
        return null;
      }

      const html = await this.fetch(match.endpoint_awards);
      if (!html) return null;

      return this.parseAndValidate(
        html,
        name,
        platform,
        match.endpoint_awards,
      );
    } catch (error) {
      this.logger.warn(
        `[exophase] lookup failed for "${name}" (${platform}): ${error}`,
      );
      return null;
    }
  }

  private async search(query: string): Promise<ExophaseSearchGame[]> {
    const { data } = await axios.get<ExophaseSearchResponse>(SEARCH_API, {
      params: { q: query },
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 15000,
    });
    return data?.games?.list ?? [];
  }

  private pickBestMatch(
    candidates: ExophaseSearchGame[],
    queryName: string,
    environment: string,
  ): ExophaseSearchGame | null {
    const sameEnv = candidates.filter(
      (c) => c.environment_slug === environment,
    );

    // Try strict equality on normalized titles first; only fall back to the
    // permissive prefix heuristic when no candidate matches exactly. Avoids
    // false positives like "Hollow Knight" matching "Hollow Knight: Silksong".
    const q = this.normalize(queryName);
    const exact = sameEnv.filter((c) => this.normalize(c.title) === q);
    const matches =
      exact.length > 0
        ? exact
        : sameEnv.filter((c) => this.titleMatches(queryName, c.title));
    if (matches.length === 0) return null;

    // For PSN we keep one entry per platform generation (PS5 > PS4 > …).
    // Steam/Xbox normally have a single entry, but if not we fall back to
    // the most-tracked one.
    if (environment === 'psn') {
      for (const slug of PSN_PLATFORM_PRIORITY) {
        const generationHits = matches.filter((c) =>
          c.platforms?.some((p) => p.slug === slug),
        );
        if (generationHits.length === 0) continue;
        return this.mostTracked(generationHits);
      }
    }
    return this.mostTracked(matches);
  }

  private mostTracked(games: ExophaseSearchGame[]): ExophaseSearchGame {
    return games.reduce((best, c) =>
      c.global_players > best.global_players ? c : best,
    );
  }

  private parseAndValidate(
    html: string,
    queryName: string,
    platform: Platform,
    sourceUrl: string,
  ): ExophaseGameAchievements | null {
    const $ = cheerio.load(html);

    const gameTitle = this.extractGameTitle($);
    if (!gameTitle || !this.titleMatches(queryName, gameTitle)) {
      this.logger.debug(
        `[exophase] "${queryName}" (${platform}) — title mismatch (got "${gameTitle ?? '?'}")`,
      );
      return null;
    }

    const stats = this.extractOverviewStats($);
    const playersTracked = stats['Players Tracked'] ?? null;
    if (playersTracked === null || playersTracked < MIN_PLAYERS_TRACKED) {
      this.logger.debug(
        `[exophase] "${queryName}" (${platform}) — sample too small (tracked=${playersTracked ?? '?'})`,
      );
      return null;
    }

    // Steam/Xbox label "Total Achievements"; PSN labels it "Total Trophies".
    const totalAchievements =
      stats['Total Achievements'] ?? stats['Total Trophies'] ?? null;
    if (
      totalAchievements === null ||
      totalAchievements < MIN_ACHIEVEMENTS ||
      totalAchievements > MAX_ACHIEVEMENTS
    ) {
      this.logger.debug(
        `[exophase] "${queryName}" (${platform}) — invalid achievement count (${totalAchievements ?? '?'})`,
      );
      return null;
    }

    const achievements = this.extractAchievements($);
    if (achievements.length === 0) {
      this.logger.debug(
        `[exophase] "${queryName}" (${platform}) — no achievement rows parsed (page has ${$('li.award').length} li.award)`,
      );
      return null;
    }

    const mostCommonPercent = achievements.reduce(
      (max, a) => Math.max(max, a.percentEarned),
      0,
    );
    if (mostCommonPercent < MIN_MOST_COMMON_PERCENT) {
      this.logger.debug(
        `[exophase] "${queryName}" (${platform}) — most common achievement is suspiciously rare (${mostCommonPercent}%)`,
      );
      return null;
    }

    return {
      platform,
      sourceUrl,
      gameTitle,
      playersTracked,
      totalAchievements,
      achievements,
    };
  }

  private extractGameTitle($: cheerio.CheerioAPI): string | null {
    const h1Text = $('h1').first().text();
    if (h1Text) {
      const cleaned = this.cleanTitle(h1Text);
      if (cleaned) return cleaned;
    }
    // Steam/Xbox pages title: "<NAME> Achievements - <PLATFORM> - Exophase.com"
    // PSN pages title:        "<NAME> Trophies - <PLATFORM> - Exophase.com"
    const m = $('title')
      .text()
      .match(/^(.+?)\s+(?:Achievements|Trophies)\s+-\s+/);
    return m ? this.cleanTitle(m[1]) : null;
  }

  /**
   * Read the `<ul class="overview-top">` block at the top of the page, where
   * Exophase emits `<li><strong>NUMBER</strong><span>LABEL</span></li>` for
   * each headline stat (Achievements Earned, Players Tracked, Total
   * Achievements, …). Returns a label → number map for the labels we care
   * about; missing labels are simply absent.
   */
  private extractOverviewStats(
    $: cheerio.CheerioAPI,
  ): Record<string, number> {
    const stats: Record<string, number> = {};
    $('.overview-top li').each((_, el) => {
      const $el = $(el);
      const valueRaw = $el.find('strong').first().text().trim();
      const label = $el.find('span').first().text().trim();
      if (!valueRaw || !label) return;
      const value = Number(valueRaw.replace(/,/g, ''));
      if (Number.isFinite(value) && value >= 0) stats[label] = value;
    });
    return stats;
  }

  /**
   * Each achievement row is a `<li class="... award ...">` carrying its
   * unlock rate as `data-average` (most reliable: no formatting drift). The
   * canonical slug is the trailing segment of the achievement detail URL
   * (`/achievement/<game>/<id>-<slug>`); `data-master` is the stable
   * Exophase ID and is kept as a slug fallback.
   */
  private extractAchievements(
    $: cheerio.CheerioAPI,
  ): ExophaseAchievement[] {
    const results: ExophaseAchievement[] = [];
    const seen = new Set<string>();

    $('li.award').each((_, el) => {
      const $el = $(el);

      const avgRaw = $el.attr('data-average');
      if (!avgRaw) return;
      const percent = Number(avgRaw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;

      const $a = $el.find('.award-title a').first();
      const name = this.cleanTitle($a.text());
      if (!name) return;

      const href = $a.attr('href') ?? '';
      const hrefMatch = href.match(/\/achievement\/[^/]+\/([^/?#]+)/);
      const master = $el.attr('data-master');
      const slug = hrefMatch?.[1] ?? (master ? `master-${master}` : null);
      if (!slug || seen.has(slug)) return;

      seen.add(slug);
      results.push({ slug, name, percentEarned: percent });
    });

    return results;
  }

  private cleanTitle(raw: string): string {
    return raw
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[™®]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Same matching heuristic used elsewhere (store-ratings): accept when one
  // normalized title is a prefix of the other, with a minimum overlap to
  // avoid false positives on short / common words.
  private titleMatches(query: string, found: string): boolean {
    const q = this.normalize(query);
    const f = this.normalize(found);
    if (!q || !f) return false;
    const shorter = q.length < f.length ? q : f;
    return shorter.length >= 4 && (f.startsWith(q) || q.startsWith(f));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async fetch(url: string): Promise<string | null> {
    try {
      const { data } = await axios.get<string>(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' },
        timeout: 20000,
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return data;
    } catch (error) {
      const status =
        axios.isAxiosError(error) && error.response?.status
          ? error.response.status
          : undefined;
      if (status === 404) {
        this.logger.debug(`[exophase] 404 on ${url}`);
        return null;
      }
      throw error;
    }
  }
}

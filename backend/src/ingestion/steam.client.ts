import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

const STEAMCHARTS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export interface SteamPrice {
  // ISO 4217 currency code reported by Steam for the requested region.
  currency: string;
  // Regular ("initial") price in the currency's minor units (cents).
  initial: number;
  // Current price after any active discount, in minor units (cents).
  final: number;
  // Active discount percentage (0 when not on sale).
  discountPercent: number;
}

export interface SteamAppDetails {
  appId: number;
  name: string;
  releaseDate: Date | null;
  headerImage: string | null;
  shortDescription: string | null;
  isFree: boolean;
  developers: string[];
  publishers: string[];
  genres: string[];
  // Steam store "categories" (e.g. "Single-player", "Multi-player",
  // "Co-op", "Steam Achievements"). Display labels, not localized ids.
  categories: string[];
  // appIds of this game's DLC, as listed by the Steam store.
  dlc: number[];
  // Current pricing for the requested region; null for free titles or when
  // Steam omits `price_overview` (unreleased, region-locked, etc.).
  price: SteamPrice | null;
}

@Injectable()
export class SteamClient {
  private readonly logger = new Logger(SteamClient.name);

  async getAppDetails(appId: number): Promise<SteamAppDetails | null> {
    try {
      const { data } = await axios.get(
        'https://store.steampowered.com/api/appdetails',
        { params: { appids: appId, l: 'english', cc: 'us' }, timeout: 15000 },
      );

      const entry = data?.[String(appId)];
      if (!entry?.success || !entry.data) return null;

      const d = entry.data;
      return {
        appId,
        name: d.name,
        releaseDate: this.parseReleaseDate(d.release_date?.date),
        headerImage: d.header_image ?? null,
        shortDescription: d.short_description ?? null,
        isFree: Boolean(d.is_free),
        developers: Array.isArray(d.developers) ? d.developers : [],
        publishers: Array.isArray(d.publishers) ? d.publishers : [],
        genres: Array.isArray(d.genres)
          ? (d.genres as { description: string }[]).map((g) => g.description)
          : [],
        categories: Array.isArray(d.categories)
          ? (d.categories as { description?: unknown }[])
              .map((c) => (typeof c.description === 'string' ? c.description : null))
              .filter((c): c is string => c !== null)
          : [],
        dlc: Array.isArray(d.dlc)
          ? (d.dlc as unknown[])
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id))
          : [],
        price: this.parsePrice(d.price_overview),
      };
    } catch (error) {
      this.logger.warn(`getAppDetails failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Resolve a Steam appId from a game name. Used as a fallback when IGDB
   * has no Steam external_game entry for a title that nevertheless ships on
   * Steam (notably EA / Ubisoft / Epic-exclusive games that joined Steam
   * later). We accept the top match only when the normalized title is an
   * exact or prefix match to avoid linking the wrong app.
   */
  async findAppIdByName(name: string): Promise<number | null> {
    try {
      const { data } = await axios.get<
        { appid: string; name: string }[]
      >(
        `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`,
        { timeout: 15000 },
      );
      if (!Array.isArray(data) || data.length === 0) return null;
      const top = data[0];
      if (!this.titleMatches(name, top.name)) return null;
      const appId = Number(top.appid);
      return Number.isFinite(appId) ? appId : null;
    } catch (error) {
      this.logger.warn(`findAppIdByName failed for "${name}": ${error}`);
      return null;
    }
  }

  /**
   * Steam's public per-achievement global unlock percentages, computed by
   * Valve over the entire Steam playerbase (not a sample). No API key
   * required. Returns null if the app has no achievements or the call
   * fails. The achievement `apiName` is Valve's internal slug (e.g.
   * `ACH00`, `CHARMED`), not the localized display title.
   */
  async getGlobalAchievementPercentages(
    appId: number,
  ): Promise<Array<{ apiName: string; percent: number }> | null> {
    try {
      const { data } = await axios.get(
        'https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/',
        { params: { gameid: appId, format: 'json' }, timeout: 15000 },
      );
      const raw = data?.achievementpercentages?.achievements;
      if (!Array.isArray(raw) || raw.length === 0) return null;

      const parsed: Array<{ apiName: string; percent: number }> = [];
      for (const entry of raw as Array<{ name?: unknown; percent?: unknown }>) {
        const apiName = typeof entry.name === 'string' ? entry.name : null;
        const percent = Number(entry.percent);
        if (!apiName || !Number.isFinite(percent) || percent < 0 || percent > 100) {
          continue;
        }
        parsed.push({ apiName, percent });
      }
      return parsed.length > 0 ? parsed : null;
    } catch (error) {
      this.logger.warn(
        `getGlobalAchievementPercentages failed for ${appId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Current number of concurrent players on Steam, via the public
   * `ISteamUserStats/GetNumberOfCurrentPlayers` endpoint. No API key
   * required. Polled daily to maintain a `STEAM_CONCURRENT` time series and
   * a running `STEAM_PEAK_CCU` peak per game. The peak CCU is a second,
   * largely independent signal of installed base used to tighten the
   * Boxleiter-based PC estimate via range intersection.
   */
  async getCurrentPlayerCount(appId: number): Promise<number | null> {
    try {
      const { data } = await axios.get(
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
        { params: { appid: appId, format: 'json' }, timeout: 15000 },
      );
      const players = data?.response?.player_count;
      if (typeof players !== 'number' || !Number.isFinite(players) || players < 0) {
        return null;
      }
      return players;
    } catch (error) {
      this.logger.warn(`getCurrentPlayerCount failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Scrape SteamCharts' "All-time peak" stat for this app, plus the month
   * in which it was reached. The Steam Web API only exposes the *current*
   * player count, so historical peaks for hits we started tracking late
   * (Palworld's 2.1M in Jan 2024, etc.) are otherwise unrecoverable.
   *
   * Returns `{ peak, peakAt }`:
   *  - `peak`: the all-time peak concurrent players reported by SteamCharts.
   *  - `peakAt`: end-of-month date of the row in the monthly breakdown
   *    whose peak matches the all-time value (UTC). Null when the match
   *    cannot be identified — callers should then fall back to "now" for
   *    the snapshot's capturedAt.
   *
   * Returns `null` on HTTP error, empty payload, or when the all-time peak
   * value can't be located in the page.
   */
  async getAllTimePeakCcu(appId: number): Promise<{
    peak: number;
    peakAt: Date | null;
  } | null> {
    try {
      const { data: html } = await axios.get<string>(
        `https://steamcharts.com/app/${appId}`,
        {
          headers: { 'User-Agent': STEAMCHARTS_USER_AGENT },
          timeout: 20000,
          responseType: 'text',
          transformResponse: (raw: unknown) => raw,
        },
      );
      if (typeof html !== 'string' || html.length === 0) return null;

      const $ = cheerio.load(html);

      let peak: number | null = null;
      $('.app-stat').each((_, el) => {
        const label = $(el).text().toLowerCase();
        if (!label.includes('all-time peak')) return;
        const raw = $(el).find('.num').first().text().trim();
        const n = Number(raw.replace(/[,\s]/g, ''));
        if (Number.isFinite(n) && n > 0) peak = n;
      });
      if (peak === null) return null;

      let peakAt: Date | null = null;
      $('.common-table tbody tr').each((_, tr) => {
        const $tr = $(tr);
        const label = $tr.find('.month-cell').text().trim();
        if (!label || label.toLowerCase().includes('last 30 days')) return;
        const peakCell = $tr.find('td.num').last().text().trim();
        const n = Number(peakCell.replace(/[,\s]/g, ''));
        if (n === peak) {
          const parsed = this.parseSteamChartsMonth(label);
          if (parsed) peakAt = parsed;
        }
      });

      return { peak, peakAt };
    } catch (error) {
      this.logger.warn(`getAllTimePeakCcu failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Total number of Steam reviews. This is the core signal for the Boxleiter
   * estimation method.
   */
  async getTotalReviews(appId: number): Promise<number | null> {
    try {
      const { data } = await axios.get(
        `https://store.steampowered.com/appreviews/${appId}`,
        {
          params: {
            json: 1,
            language: 'all',
            purchase_type: 'all',
            num_per_page: 0,
          },
          timeout: 15000,
        },
      );

      const total = data?.query_summary?.total_reviews;
      return typeof total === 'number' ? total : null;
    } catch (error) {
      this.logger.warn(`getTotalReviews failed for ${appId}: ${error}`);
      return null;
    }
  }

  private parseReleaseDate(raw?: string): Date | null {
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Map Steam's `price_overview` block to `SteamPrice`. `initial`/`final` are
   * already in minor units (cents). Returns null when the block is absent
   * (free or unpriced apps) or malformed.
   */
  private parsePrice(raw: unknown): SteamPrice | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as {
      currency?: unknown;
      initial?: unknown;
      final?: unknown;
      discount_percent?: unknown;
    };
    const currency = typeof p.currency === 'string' ? p.currency : null;
    const initial = Number(p.initial);
    const final = Number(p.final);
    if (!currency || !Number.isFinite(initial) || !Number.isFinite(final)) {
      return null;
    }
    const discountPercent = Number(p.discount_percent);
    return {
      currency,
      initial,
      final,
      discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    };
  }

  /**
   * Convert a SteamCharts month label like `"January 2024"` into the
   * end-of-month date in UTC (so the snapshot timestamp falls inside the
   * month it represents). Returns null on any unexpected format.
   */
  private parseSteamChartsMonth(label: string): Date | null {
    const match = label.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!match) return null;
    const monthIdx = MONTH_NAMES.indexOf(match[1].toLowerCase());
    if (monthIdx < 0) return null;
    const year = Number(match[2]);
    if (!Number.isFinite(year)) return null;
    // Day 0 of the *next* month = last day of the current month.
    return new Date(Date.UTC(year, monthIdx + 1, 0));
  }

  // Accept when one normalized title is a prefix of the other (Steam store
  // names carry edition/year suffixes), with a minimum overlap to avoid noise.
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
}

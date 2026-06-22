import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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
}

@Injectable()
export class SteamClient {
  private readonly logger = new Logger(SteamClient.name);

  async getAppDetails(appId: number): Promise<SteamAppDetails | null> {
    try {
      const { data } = await axios.get(
        'https://store.steampowered.com/api/appdetails',
        { params: { appids: appId, l: 'english' }, timeout: 15000 },
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

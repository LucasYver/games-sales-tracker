import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface SteamChartsMonth {
  // First day of the month, UTC (YYYY-MM-DD).
  monthStart: string;
  avgPlayers: number;
  peakPlayers: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/**
 * Scrapes monthly concurrent-player history from SteamCharts
 * (`steamcharts.com/app/<appId>`), the public mirror of the data SteamDB
 * shows behind Cloudflare. The site exposes a single HTML table with one row
 * per calendar month (avg + peak players) back to launch — exactly the
 * granularity we need for historical CCU calibration. We deliberately do NOT
 * scrape SteamDB itself (Cloudflare-protected and against its ToS).
 */
@Injectable()
export class SteamChartsClient {
  private readonly logger = new Logger(SteamChartsClient.name);

  async fetchMonthlyCcu(appId: number): Promise<SteamChartsMonth[] | null> {
    let html: string;
    try {
      const { data } = await axios.get<string>(
        `https://steamcharts.com/app/${appId}`,
        {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en' },
          timeout: 15000,
          responseType: 'text',
        },
      );
      html = data;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      this.logger.warn(
        `fetchMonthlyCcu failed for ${appId}` +
          (status ? ` (HTTP ${status})` : '') +
          `: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    const $ = cheerio.load(html);
    const months: SteamChartsMonth[] = [];

    $('table.common-table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 5) return;

      const label = $(tds[0]).text().trim();
      const monthStart = this.parseMonthLabel(label);
      // "Last 30 Days" (the live partial month) has no parseable date; skip it
      // so we only persist completed months and never clobber live-poll rows.
      if (!monthStart) return;

      const avgPlayers = this.parseNumber($(tds[1]).text());
      const peakPlayers = this.parseNumber($(tds[tds.length - 1]).text());
      if (peakPlayers === null) return;

      months.push({
        monthStart,
        avgPlayers: avgPlayers ?? 0,
        peakPlayers,
      });
    });

    if (months.length === 0) return null;
    months.sort((a, b) =>
      a.monthStart < b.monthStart ? -1 : a.monthStart > b.monthStart ? 1 : 0,
    );
    return months;
  }

  private parseMonthLabel(label: string): string | null {
    const match = label.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
    if (!match) return null;
    const month = MONTHS[match[1]];
    if (!month) return null;
    return `${match[2]}-${month}-01`;
  }

  private parseNumber(text: string): number | null {
    const cleaned = text.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }
}

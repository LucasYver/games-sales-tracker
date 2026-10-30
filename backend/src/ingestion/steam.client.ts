import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  currencyForCountry,
  type SteamStoreCountry,
} from './steam-store-countries';

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

/** Result of `GetNumberOfCurrentPlayers` — see {@link SteamClient.getCurrentPlayerCount}. */
export type SteamPlayerCountResult =
  | { kind: 'ok'; players: number }
  | { kind: 'unsupported' }
  | { kind: 'transient'; detail: string };

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

export interface SteamReviewDailyCount {
  // UTC day (YYYY-MM-DD).
  day: string;
  // New positive/negative reviews created that day (not cumulative).
  positive: number;
  negative: number;
}

export interface SteamReviewHistory {
  // Per-day new-review counts, sorted ascending by day.
  daily: SteamReviewDailyCount[];
  // Number of individual reviews actually paginated through.
  totalFetched: number;
  // `query_summary.total_reviews` reported by Steam on the first page; may
  // exceed `totalFetched` because deleted reviews are excluded from results.
  reportedTotal: number | null;
}

export interface SteamReviewerPlaytime {
  // Median lifetime playtime across the sampled reviewers, in minutes.
  medianMinutes: number;
  // Mean lifetime playtime across the sampled reviewers, in minutes. Kept for
  // logging/diagnostics only — the mean is heavily skewed by idle outliers,
  // which is exactly why we persist the median as the headline figure.
  averageMinutes: number;
  // Number of reviews that carried a usable `playtime_forever` value.
  sampleSize: number;
}

export interface SteamReviewHistogram {
  // Bucket granularity Steam chose for this app: 'month' (full history for
  // high-volume games), 'week' or 'day' (recent-only for low-volume games).
  rollupType: 'day' | 'week' | 'month';
  // New positive/negative review counts per bucket (NOT cumulative), sorted
  // ascending. `day` is the bucket's start (YYYY-MM-DD, UTC).
  buckets: SteamReviewDailyCount[];
}

// Process-wide Steam gate. Steam's public store (~200 req / 5 min / IP) and the
// keyless `GetAppReviews` limit are shared by every call that goes through it; nested per-request
// retries were burning the budget and thrashing the same app. One gap + one
// 429 circuit-breaker keeps the batch script moving without hammering.
let storeGateChain: Promise<void> = Promise.resolve();
let storeNextSlotAt = 0;
let storeCooldownUntil = 0;

const APP_REVIEWS_URL =
  'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/';
/** `filter` value for newest-created first, which paginates stably. */
const APP_REVIEWS_FILTER_NEWEST = 1;

@Injectable()
export class SteamClient {
  private readonly logger = new Logger(SteamClient.name);

  /** Min spacing between store JSON calls (~150 req / 5 min, under the cap). */
  private static readonly STORE_MIN_GAP_MS = 2_000;
  /** After a 429, freeze the gate for a full Steam window. */
  private static readonly STORE_429_COOLDOWN_MS = 5 * 60_000;

  constructor(private readonly config: ConfigService) {}

  private async acquireStoreSlot(): Promise<void> {
    const run = async (): Promise<void> => {
      const now = Date.now();
      const waitUntil = Math.max(storeNextSlotAt, storeCooldownUntil);
      if (waitUntil > now) {
        const waitMs = waitUntil - now;
        if (waitMs >= 3_000) {
          this.logger.warn(
            `Steam store gate: waiting ${Math.round(waitMs / 1000)}s ` +
              (waitUntil === storeCooldownUntil ? '(429 cooldown)' : '(spacing)'),
          );
        }
        await new Promise((r) => setTimeout(r, waitMs));
      }
      storeNextSlotAt = Date.now() + SteamClient.STORE_MIN_GAP_MS;
    };

    const previous = storeGateChain;
    let release!: () => void;
    storeGateChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await run();
    } finally {
      release();
    }
  }

  private tripStoreCooldown(ms = SteamClient.STORE_429_COOLDOWN_MS): void {
    storeCooldownUntil = Math.max(storeCooldownUntil, Date.now() + ms);
    this.logger.warn(
      `Steam 429 circuit open — no store requests for ${Math.round(ms / 1000)}s`,
    );
  }

  /**
   * The app id Steam itself uses for `appId`. `appdetails` follows retired or
   * regional ids (DOOM's 430910 answers as 379720), which `GetAppReviews` does
   * not: it reports zero reviews for them.
   */
  async getCanonicalAppId(appId: number): Promise<number | null> {
    try {
      const data = await this.getStoreJson(
        'https://store.steampowered.com/api/appdetails',
        { appids: appId, filters: 'basic' },
      );
      const canonical = data?.[String(appId)]?.data?.steam_appid;
      return typeof canonical === 'number' ? canonical : null;
    } catch (error) {
      this.logger.warn(`getCanonicalAppId failed for ${appId}: ${error}`);
      return null;
    }
  }

  async getAppDetails(appId: number): Promise<SteamAppDetails | null> {
    try {
      const data = await this.getStoreJson(
        'https://store.steampowered.com/api/appdetails',
        { appids: appId, l: 'english', cc: 'us' },
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
              .map((c) =>
                typeof c.description === 'string' ? c.description : null,
              )
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
   * Current Steam store prices for many apps in one country, via
   * `IStoreBrowseService/GetItems`. One HTTP call per country × ~50 appids.
   * Currency is not in the payload — it comes from {@link currencyForCountry}.
   */
  async getStorePrices(
    appIds: number[],
    country: SteamStoreCountry,
  ): Promise<Map<number, SteamPrice | null>> {
    const result = new Map<number, SteamPrice | null>();
    if (appIds.length === 0) return result;

    const key = this.config.get<string>('STEAM_API_KEY')?.trim();
    const payload = {
      ids: appIds.map((appid) => ({ appid })),
      context: {
        language: 'english',
        country_code: country.toUpperCase(),
      },
      data_request: { include_best_purchase_option: true },
    };
    const params: Record<string, unknown> = {
      input_json: JSON.stringify(payload),
    };
    if (key) params.key = key;

    const data = await this.getStoreJson(
      'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/',
      params,
    );
    const items = data?.response?.store_items;
    if (!Array.isArray(items)) {
      throw new Error(
        `GetItems returned no store_items for ${country} (${appIds.length} apps).`,
      );
    }

    const currency = currencyForCountry(country);
    const seen = new Set<number>();
    for (const raw of items) {
      const appId = Number(raw?.appid);
      if (!Number.isFinite(appId)) continue;
      seen.add(appId);
      if (raw?.is_free === true) {
        result.set(appId, null);
        continue;
      }
      result.set(
        appId,
        this.parseBestPurchaseOption(raw?.best_purchase_option, currency),
      );
    }
    for (const appId of appIds) {
      if (!seen.has(appId)) result.set(appId, null);
    }
    return result;
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
      const { data } = await axios.get<{ appid: string; name: string }[]>(
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
        if (
          !apiName ||
          !Number.isFinite(percent) ||
          percent < 0 ||
          percent > 100
        ) {
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
   * required. Polled hourly to maintain a `STEAM_CONCURRENT` time series and
   * a running `STEAM_PEAK_CCU` peak per game. The peak CCU is a second,
   * largely independent signal of installed base used to tighten the
   * Boxleiter-based PC estimate via range intersection.
   *
   * Distinguishes permanent "no stats for this app" (HTTP 404 / result 42)
   * from transient rate-limits and transport failures so the CCU cron does
   * not stamp the whole catalog as failed when Steam throttles the egress IP.
   */
  async getCurrentPlayerCount(appId: number): Promise<SteamPlayerCountResult> {
    const maxAttempts = 3;
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, status } = await axios.get(
          'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
          {
            params: { appid: appId, format: 'json' },
            timeout: 15000,
            validateStatus: () => true,
          },
        );

        const players = data?.response?.player_count;
        if (
          status === 200 &&
          typeof players === 'number' &&
          Number.isFinite(players) &&
          players >= 0
        ) {
          return { kind: 'ok', players };
        }

        // HTTP 404 + result 42 usually means the app has no player-count
        // stats — but Steam also serves this shape while throttling an IP,
        // so retry once with a short backoff before concluding unsupported.
        const result = data?.response?.result;
        const looksUnsupported = status === 404 || result === 42;
        lastError = `HTTP ${status}, result=${String(result)}`;

        if (looksUnsupported) {
          if (attempt < 2) {
            const backoffMs = 2000;
            this.logger.warn(
              `getCurrentPlayerCount ${appId}: ${lastError} ` +
                `(attempt ${attempt}/2); retrying in ${backoffMs}ms`,
            );
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          return { kind: 'unsupported' };
        }

        if (
          (status === 429 || status === 503 || status >= 500) &&
          attempt < maxAttempts
        ) {
          const backoffMs = attempt * 5000;
          this.logger.warn(
            `getCurrentPlayerCount ${appId}: ${lastError} ` +
              `(attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) {
          const backoffMs = attempt * 5000;
          this.logger.warn(
            `getCurrentPlayerCount ${appId}: ${lastError} ` +
              `(attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
      }
    }

    this.logger.warn(
      `getCurrentPlayerCount failed for ${appId} after retries: ${lastError}`,
    );
    return { kind: 'transient', detail: lastError };
  }

  /**
   * Total number of Steam reviews. This is the core signal for the Boxleiter
   * estimation method.
   */
  async getTotalReviews(appId: number): Promise<number | null> {
    try {
      // A page size of 0 is read as the default, so ask for a single review.
      const data = await this.getAppReviewsPage(appId, { num_per_page: 1 });

      const total = data.query_summary?.total_reviews;
      return typeof total === 'number' ? total : null;
    } catch (error) {
      this.logger.warn(`getTotalReviews failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * Reconstruct the game's full review history from the public `GetAppReviews`
   * method. Steam doesn't expose a cumulative time series, but it does
   * return every individual review (with its creation timestamp and verdict)
   * when paginated chronologically via the `cursor` token. We aggregate those
   * into per-UTC-day counts of new positive/negative reviews; the caller turns
   * that into a cumulative series.
   *
   * This is the legitimate, API-only equivalent of the SteamDB review-chart
   * CSV (which we can't scrape behind Cloudflare). Deleted reviews are absent
   * from the API, so the reconstructed totals can run slightly below SteamDB's
   * live-recorded history, but the curve shape is faithful.
   *
   * Callers without a publisher key share a rate limit, so pages are throttled
   * and retried on 429. Pagination stops when Steam returns no more
   * reviews or repeats a cursor; `maxPages` is a safety ceiling against loops.
   */
  async fetchReviewHistory(
    appId: number,
    options: { throttleMs?: number; maxPages?: number } = {},
  ): Promise<SteamReviewHistory | null> {
    const throttleMs = options.throttleMs ?? 700;
    const maxPages = options.maxPages ?? 5000;

    const daily = new Map<string, { positive: number; negative: number }>();
    const seenCursors = new Set<string>();
    let cursor = '*';
    let reportedTotal: number | null = null;
    let totalFetched = 0;
    let pages = 0;

    while (pages < maxPages) {
      let data: any;
      try {
        data = await this.getAppReviewsPage(appId, {
          filter: APP_REVIEWS_FILTER_NEWEST,
          num_per_page: 100,
          cursor,
        });
      } catch (error) {
        this.logger.warn(
          `fetchReviewHistory page ${pages + 1} failed for ${appId}: ${error}`,
        );
        break;
      }

      if (pages === 0) {
        const summaryTotal = data?.query_summary?.total_reviews;
        reportedTotal = typeof summaryTotal === 'number' ? summaryTotal : null;
      }

      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) break;

      for (const review of reviews as Array<{
        timestamp_created?: unknown;
        voted_up?: unknown;
      }>) {
        const ts = Number(review.timestamp_created);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const day = new Date(ts * 1000).toISOString().slice(0, 10);
        const bucket = daily.get(day) ?? { positive: 0, negative: 0 };
        if (review.voted_up === true) bucket.positive += 1;
        else bucket.negative += 1;
        daily.set(day, bucket);
        totalFetched += 1;
      }

      const nextCursor = typeof data?.cursor === 'string' ? data.cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      pages += 1;

      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
    }

    if (daily.size === 0) return null;

    const sorted = Array.from(daily.entries())
      .map(([day, counts]) => ({ day, ...counts }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return { daily: sorted, totalFetched, reportedTotal };
  }

  /**
   * Reconstruct cumulative review totals on specific UTC calendar days without
   * walking the full history back to launch.
   *
   * Strategy: page `GetAppReviews` newest-first until every review after the
   * oldest requested day has been seen, then for each day D compute
   * `reportedTotal - count(reviews created after end-of-D)`. Stops early once
   * pagination crosses that floor — typically cheap when the target days are
   * recent, expensive only when a milestone window is near launch on a
   * high-volume title.
   */
  async fetchCumulativeReviewsOnDays(
    appId: number,
    days: string[],
    options: { throttleMs?: number; maxPages?: number } = {},
  ): Promise<{
    points: Array<{
      day: string;
      total: number;
      positive: number;
      negative: number;
    }>;
    pagesFetched: number;
    reportedTotal: number;
    reachedFloor: boolean;
  } | null> {
    const uniqueDays = [
      ...new Set(
        days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      ),
    ].sort();
    if (uniqueDays.length === 0) {
      return {
        points: [],
        pagesFetched: 0,
        reportedTotal: 0,
        reachedFloor: true,
      };
    }

    // Spacing is enforced by the process-wide store gate; no extra per-page
    // sleep unless the caller passes one.
    const throttleMs = options.throttleMs ?? 0;
    const maxPages = options.maxPages ?? 5000;
    const oldest = uniqueDays[0];
    const oldestEndUnix = Math.floor(
      new Date(`${oldest}T23:59:59.999Z`).getTime() / 1000,
    );
    const dayEnds = new Map(
      uniqueDays.map((d) => [
        d,
        Math.floor(new Date(`${d}T23:59:59.999Z`).getTime() / 1000),
      ]),
    );

    const afterTotal = new Map(uniqueDays.map((d) => [d, 0]));
    const afterPos = new Map(uniqueDays.map((d) => [d, 0]));
    const afterNeg = new Map(uniqueDays.map((d) => [d, 0]));

    const seenCursors = new Set<string>();
    let cursor = '*';
    let reportedTotal: number | null = null;
    let reportedPos: number | null = null;
    let reportedNeg: number | null = null;
    let pagesFetched = 0;
    let reachedFloor = false;

    while (pagesFetched < maxPages) {
      let data: any;
      try {
        data = await this.getAppReviewsPage(appId, {
          filter: APP_REVIEWS_FILTER_NEWEST,
          num_per_page: 100,
          cursor,
        });
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        // Surface rate-limits to the caller so the batch script can cool down
        // and retry instead of treating the game as permanently failed.
        if (status === 429) throw error;
        this.logger.warn(
          `fetchCumulativeReviewsOnDays page ${pagesFetched + 1} failed for ${appId}: ${error}`,
        );
        break;
      }
      pagesFetched += 1;

      if (pagesFetched === 1) {
        const summary = data?.query_summary;
        reportedTotal =
          typeof summary?.total_reviews === 'number'
            ? summary.total_reviews
            : null;
        reportedPos =
          typeof summary?.total_positive === 'number'
            ? summary.total_positive
            : null;
        reportedNeg =
          typeof summary?.total_negative === 'number'
            ? summary.total_negative
            : null;
        if (reportedTotal === null || reportedTotal < 0) return null;
      }

      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) {
        reachedFloor = true;
        break;
      }

      let pageMinTs = Number.POSITIVE_INFINITY;
      for (const review of reviews as Array<{
        timestamp_created?: unknown;
        voted_up?: unknown;
      }>) {
        const ts = Number(review.timestamp_created);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (ts < pageMinTs) pageMinTs = ts;
        const votedUp = review.voted_up === true;
        for (const d of uniqueDays) {
          if (ts > (dayEnds.get(d) as number)) {
            afterTotal.set(d, (afterTotal.get(d) as number) + 1);
            if (votedUp) afterPos.set(d, (afterPos.get(d) as number) + 1);
            else afterNeg.set(d, (afterNeg.get(d) as number) + 1);
          }
        }
      }

      // Newest-first: once a page reaches at/before the oldest day end, every
      // later page is older still — we have counted all post-window reviews.
      if (pageMinTs <= oldestEndUnix) {
        reachedFloor = true;
        break;
      }

      const nextCursor = typeof data?.cursor === 'string' ? data.cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        reachedFloor = true;
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;

      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
    }

    if (reportedTotal === null) return null;

    const livePos = reportedPos ?? 0;
    const liveNeg = reportedNeg ?? Math.max(0, reportedTotal - livePos);

    const points = uniqueDays.map((day) => {
      const total = Math.max(
        0,
        reportedTotal - (afterTotal.get(day) as number),
      );
      const positive = Math.max(0, livePos - (afterPos.get(day) as number));
      const negative = Math.max(0, liveNeg - (afterNeg.get(day) as number));
      return { day, total, positive, negative };
    });

    return {
      points,
      pagesFetched,
      reportedTotal,
      reachedFloor,
    };
  }

  /**
   * Sample reviewer lifetime playtime from the public `GetAppReviews` method and
   * return the median/mean (in minutes) over the sample. Each review carries an
   * `author.playtime_forever` field (minutes played in this app, as of the
   * author's last library sync); we page through the most recent reviews and
   * aggregate those values.
   *
   * This is our own, API-only equivalent of SteamSpy's `median_forever`. It is
   * NOT a whole-population statistic: reviewers are a self-selected, engaged
   * subset of owners, and we only sample the most recent `maxPages` worth, so
   * the figure is directional. The median is the meaningful output — the mean
   * is dragged upward by the handful of reviewers who leave a game idling for
   * thousands of hours.
   *
   * Callers without a publisher key share a rate limit, so pages are throttled;
   * newest-first gives stable chronological pagination. Returns null when no
   * review carried a usable playtime value, and throws when not a single page
   * could be read, so a dead endpoint is not mistaken for a game without reviews.
   */
  async fetchReviewerPlaytime(
    appId: number,
    options: { throttleMs?: number; maxPages?: number } = {},
  ): Promise<SteamReviewerPlaytime | null> {
    const throttleMs = options.throttleMs ?? 700;
    const maxPages = options.maxPages ?? 10;

    const playtimes: number[] = [];
    const seenCursors = new Set<string>();
    let cursor = '*';
    let pages = 0;

    while (pages < maxPages) {
      let data: any;
      try {
        data = await this.getAppReviewsPage(appId, {
          filter: APP_REVIEWS_FILTER_NEWEST,
          num_per_page: 100,
          cursor,
        });
      } catch (error) {
        if (pages === 0) throw error;
        this.logger.warn(
          `fetchReviewerPlaytime page ${pages + 1} failed for ${appId}: ${error}`,
        );
        break;
      }

      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) break;

      for (const review of reviews as Array<{
        author?: { playtime_forever?: unknown };
      }>) {
        const minutes = Number(review.author?.playtime_forever);
        if (Number.isFinite(minutes) && minutes >= 0) playtimes.push(minutes);
      }

      const nextCursor = typeof data?.cursor === 'string' ? data.cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      pages += 1;

      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
    }

    if (playtimes.length === 0) return null;

    playtimes.sort((a, b) => a - b);
    const mid = Math.floor(playtimes.length / 2);
    const medianMinutes =
      playtimes.length % 2 === 0
        ? (playtimes[mid - 1] + playtimes[mid]) / 2
        : playtimes[mid];
    const averageMinutes =
      playtimes.reduce((sum, v) => sum + v, 0) / playtimes.length;

    return {
      medianMinutes: Math.round(medianMinutes),
      averageMinutes: Math.round(averageMinutes),
      sampleSize: playtimes.length,
    };
  }

  /**
   * Fetch the public review histogram for an app (`appreviewhistogram`). This
   * is the cheap, single-request equivalent of the SteamDB review chart: Steam
   * returns new positive/negative review counts bucketed by period. For
   * high-volume games the buckets are MONTHLY and span the whole history back
   * to launch; for low-volume games Steam only returns recent WEEKLY buckets,
   * in which case the caller should fall back to `fetchReviewHistory`.
   *
   * Buckets are NOT cumulative — the caller accumulates them into a running
   * total. The `recent` (last-30-days daily) block is intentionally ignored:
   * it overlaps the final rollup bucket and would double-count.
   */
  async fetchReviewHistogram(
    appId: number,
  ): Promise<SteamReviewHistogram | null> {
    let data: any;
    try {
      data = await this.getStoreJson(
        `https://store.steampowered.com/appreviewhistogram/${appId}`,
        { l: 'english' },
      );
    } catch (error) {
      this.logger.warn(`fetchReviewHistogram failed for ${appId}: ${error}`);
      return null;
    }

    const results = data?.results;
    const rollups = Array.isArray(results?.rollups) ? results.rollups : [];
    if (rollups.length === 0) return null;

    const buckets: SteamReviewDailyCount[] = [];
    for (const b of rollups as Array<{
      date?: unknown;
      recommendations_up?: unknown;
      recommendations_down?: unknown;
    }>) {
      const ts = Number(b.date);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      buckets.push({
        day: new Date(ts * 1000).toISOString().slice(0, 10),
        positive: Number(b.recommendations_up) || 0,
        negative: Number(b.recommendations_down) || 0,
      });
    }
    if (buckets.length === 0) return null;
    buckets.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    const raw = results?.rollup_type;
    const rollupType: SteamReviewHistogram['rollupType'] =
      raw === 'month' ? 'month' : raw === 'week' ? 'week' : 'day';

    return { rollupType, buckets };
  }

  /**
   * Scrape a game's Steam **community tags** (e.g. "Grand Strategy", "4X",
   * "Roguelike") from its store page. This is the richest gameplay-type
   * signal for the data-driven matcher — much finer than the coarse store
   * `genres`.
   *
   * Why scrape the HTML instead of an API: neither `appdetails` nor SteamSpy
   * expose community tags reliably. SteamSpy returns an empty list for
   * recently-released or low-traffic games (exactly the titles we most need
   * to estimate), whereas the store page carries the tags Steam assigns at
   * launch. The tags live in an inline `InitAppTagModal( <appId>, [ ... ] )`
   * call, already ordered by popularity; we keep the top `maxTags`.
   *
   * The `birthtime`/`mature_content` cookies bypass the age gate that would
   * otherwise return an interstitial with no tags. Best-effort: returns null
   * on any failure or when the page carries no tags, so the caller leaves the
   * game's existing `steamTags` untouched.
   */
  async getStoreTags(
    appId: number,
    options: { maxTags?: number } = {},
  ): Promise<string[] | null> {
    const maxTags = options.maxTags ?? 20;
    try {
      const html = await this.getStoreHtml(
        `https://store.steampowered.com/app/${appId}/`,
      );
      if (!html) return null;

      const match = html.match(
        new RegExp(`InitAppTagModal\\(\\s*${appId}\\s*,\\s*(\\[.*?\\])`, 's'),
      );
      if (!match) return null;

      const parsed: unknown = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) return null;

      const tags = parsed
        .map((entry) =>
          entry && typeof (entry as { name?: unknown }).name === 'string'
            ? (entry as { name: string }).name.trim()
            : null,
        )
        .filter((name): name is string => !!name && name.length > 0)
        .slice(0, maxTags);

      return tags.length > 0 ? tags : null;
    } catch (error) {
      this.logger.warn(`getStoreTags failed for ${appId}: ${error}`);
      return null;
    }
  }

  /**
   * GET a Steam store HTML page with the age-gate cookies pre-set and a small
   * retry on HTTP 429 (the store shares a ~200 req/5 min IP budget). Returns
   * the raw HTML string, or null after exhausting retries.
   */
  private async getStoreHtml(url: string): Promise<string | null> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await axios.get<string>(url, {
          timeout: 15000,
          responseType: 'text',
          headers: {
            Cookie: 'birthtime=0; mature_content=1; wants_mature_content=1',
          },
        });
        return typeof data === 'string' ? data : null;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 429 && attempt < maxAttempts) {
          const backoffMs = attempt * 5000;
          this.logger.warn(
            `Steam 429 on ${url} (attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  /**
   * One page of `IUserReviewsService/GetAppReviews`. Arguments must travel as
   * JSON in `input_json`: given as plain parameters they are ignored without an
   * error, and the totals silently fall back to English-only Steam purchases.
   * Purchase type 1 counts every purchase (keys and gifts included).
   *
   * Throws when the payload is not the expected envelope. An app Steam has no
   * data for answers `{"response":{}}`, which is valid and carries no total.
   */
  private async getAppReviewsPage(
    appId: number,
    query: { num_per_page: number; filter?: number; cursor?: string },
  ): Promise<any> {
    const data = await this.getStoreJson(APP_REVIEWS_URL, {
      input_json: JSON.stringify({
        appid: appId,
        languages: ['all'],
        purchase_type: 1,
        ...query,
      }),
    });
    const response = data?.response;
    if (!response || typeof response !== 'object') {
      throw new Error(`GetAppReviews sent no response object for app ${appId}`);
    }
    return response;
  }

  /**
   * GET a Steam endpoint through the process-wide rate gate.
   * On 429: open a 5‑minute circuit, wait once, retry once, then throw.
   * Avoids the old nested 15/30/60/120s loops that kept burning the same app.
   */
  private async getStoreJson(
    url: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.acquireStoreSlot();
      try {
        const { data } = await axios.get(url, { params, timeout: 20000 });
        return data;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 429 && attempt < 2) {
          const retryAfterRaw = axios.isAxiosError(error)
            ? Number(error.response?.headers?.['retry-after'])
            : NaN;
          const cooldownMs =
            Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
              ? Math.min(
                  10 * 60_000,
                  Math.max(
                    SteamClient.STORE_429_COOLDOWN_MS,
                    retryAfterRaw * 1000,
                  ),
                )
              : SteamClient.STORE_429_COOLDOWN_MS;
          this.logger.warn(
            `Steam 429 on ${url} — opening ${Math.round(cooldownMs / 1000)}s circuit, then one retry`,
          );
          this.tripStoreCooldown(cooldownMs);
          continue;
        }
        if (status === 429) {
          this.tripStoreCooldown(SteamClient.STORE_429_COOLDOWN_MS);
        }
        throw error;
      }
    }
    return null;
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
  private parseBestPurchaseOption(
    raw: unknown,
    currency: string,
  ): SteamPrice | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as {
      final_price_in_cents?: unknown;
      original_price_in_cents?: unknown;
      discount_pct?: unknown;
    };
    const final = Number(p.final_price_in_cents);
    if (!Number.isFinite(final) || final < 0) return null;
    const original = Number(p.original_price_in_cents);
    const initial =
      Number.isFinite(original) && original > 0 ? original : final;
    const discountRaw = Number(p.discount_pct);
    const discountPercent = Number.isFinite(discountRaw)
      ? discountRaw
      : initial > 0 && final < initial
        ? Math.round((1 - final / initial) * 100)
        : 0;
    return { currency, initial, final, discountPercent };
  }

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

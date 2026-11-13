import { V2Features, V2Target } from './v2-model';

/**
 * The input columns of the V2 model for one game at one date.
 *
 * Mirror of the families `signals`, `time`, `platforms`, `target`, `traits`
 * and `track_record` of `ml2/features.py`, and of `Learned._prep` in
 * `ml2/learned.py`: the model was trained on those exact values, so every
 * rule below (log1p, missing stays missing, clips) must stay the same as the
 * Python side. Pure: the database lookups live in the service.
 */

const MS_PER_DAY = 86_400_000;
export const V2_PLATFORMS = ['PC', 'PLAYSTATION', 'XBOX'] as const;
type V2Platform = (typeof V2_PLATFORMS)[number];

export interface V2FeatureInput {
  asOf: Date;
  /** First release anywhere (earliest of the game's and its platforms' dates). */
  firstRelease: Date;
  /** Earliest release date per platform, when the base has one. */
  releaseDates: Partial<Record<V2Platform, Date | null>>;
  /** Platforms the game is listed on (used when a platform has no date). */
  platforms: string[];

  /** Steam reviews as the model reads them at the date. */
  steamReviews: number | null;
  steamPositiveShare: number | null;
  /** Days since the review count was last read. */
  steamReviewsAgeDays: number | null;
  steamPeakPlayers: number | null;
  psRatings: number | null;
  psAverage: number | null;
  xboxRatings: number | null;
  xboxAverage: number | null;
  steamFollowers: number | null;
  /** Median Twitch viewers over the last 30 days. */
  twitchViewers30d: number | null;
  /** Best (lowest) rank reached in Steam's top sellers. */
  steamBestSalesRank: number | null;
  steamMedianPlaytime: number | null;

  priceCents: number | null;
  timeToBeatSeconds: number | null;
  dlcCount: number | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  /** The game has a series (or, failing that, a franchise). */
  inSeries: boolean;
  /** IGDB game type; `null` counts as a main game. */
  gameType: string | null;
  gameModes: string[] | null;
  /** First 10 Steam tags, lowercased. */
  tags: string[];
  /** Genres, lowercased. */
  genres: string[];

  /** Best total an earlier game of the series had published by the date. */
  seriesBest: number | null;
  /** How many earlier games of the series had published a total. */
  seriesGames: number;
  studioBest: number | null;
  studioGames: number;
}

export interface V2FeatureRow {
  features: V2Features;
  /** The target the model is asked: a PC-only game's total is a PC figure. */
  target: V2Target;
}

const positive = (v: number | null): number | null =>
  v !== null && v > 0 ? v : null;
/** log1p of a positive value; anything else stays missing. */
const log = (v: number | null): number | null => {
  const p = positive(v);
  return p === null ? null : Math.log1p(p);
};
const flag = (b: boolean): number => (b ? 1 : 0);

/** Year with its fraction, as `features.time` counts it (UTC). */
function yearFraction(date: Date): number {
  const year = date.getUTCFullYear();
  const dayOfYear =
    Math.floor(
      (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
        Date.UTC(year, 0, 1)) /
        MS_PER_DAY,
    ) + 1;
  return year + (dayOfYear - 1) / 365.25;
}

const title = (p: string): string => p.charAt(0) + p.slice(1).toLowerCase();

export function buildV2Features(
  input: V2FeatureInput,
  target: V2Target,
  columns: string[],
): V2FeatureRow {
  const f: V2Features = {};
  const asOf = input.asOf.getTime();
  const ageDays = (asOf - input.firstRelease.getTime()) / MS_PER_DAY;

  // signals
  f.log_steamReviews = log(input.steamReviews);
  f.log_steamPeakPlayers = log(input.steamPeakPlayers);
  f.log_psRatings = log(input.psRatings);
  f.log_xboxRatings = log(input.xboxRatings);
  f.log_steamFollowers = log(input.steamFollowers);
  f.log_twitchViewers30d = log(input.twitchViewers30d);
  f.log_steamBestSalesRank = log(input.steamBestSalesRank);
  f.log_steamMedianPlaytime = log(input.steamMedianPlaytime);
  f.log_steamReviewsAgeDays = log(input.steamReviewsAgeDays);
  f.steamPositiveShare = input.steamPositiveShare;
  f.psAverage = input.psAverage;
  f.xboxAverage = input.xboxAverage;
  const reviews = positive(input.steamReviews);
  const peak = positive(input.steamPeakPlayers);
  f.log_reviewsPerDay =
    reviews === null ? null : Math.log(reviews / Math.max(ageDays, 1));
  f.log_peakPerReview =
    reviews === null || peak === null ? null : Math.log(peak / reviews);

  // time
  f.log_ageDays = Math.log1p(Math.max(ageDays, 0));
  f.releaseYear = yearFraction(input.firstRelease);
  f.reportYear = yearFraction(input.asOf);

  // platforms: released by the date; listed without a date counts as released
  let platformCount = 0;
  for (const p of V2_PLATFORMS) {
    const date = input.releaseDates[p] ?? null;
    const days = date === null ? null : (asOf - date.getTime()) / MS_PER_DAY;
    const on = days === null ? input.platforms.includes(p) : days >= 0;
    f[`on${title(p)}`] = flag(on);
    f[`log_daysOn${title(p)}`] =
      days !== null && days >= 0 ? Math.log1p(days) : null;
    platformCount += flag(on);
  }
  f.platformCount = platformCount;
  const pcDate = input.releaseDates.PC ?? null;
  f.log_pcDelayDays =
    pcDate === null
      ? null
      : Math.log1p(
          Math.max(
            (pcDate.getTime() - input.firstRelease.getTime()) / MS_PER_DAY,
            0,
          ),
        );

  // target: the total of a game sold on PC only is a PC figure
  const asked: V2Target =
    target === 'TOTAL' && f.onPc === 1 && platformCount === 1 ? 'PC' : target;
  f.isTotal = flag(asked === 'TOTAL');
  for (const p of V2_PLATFORMS) f[`is${title(p)}`] = flag(asked === p);

  // traits
  f.log_price = input.priceCents === null ? null : Math.log1p(input.priceCents);
  f.log_timeToBeat =
    input.timeToBeatSeconds === null
      ? null
      : Math.log1p(input.timeToBeatSeconds);
  f.log_dlcCount = Math.log1p(input.dlcCount ?? 0);
  f.annualIteration = flag(input.isAnnualIteration);
  f.liveService = flag(input.liveService);
  f.inSeries = flag(input.inSeries);
  f.mainGame = flag((input.gameType ?? 'MAIN_GAME') === 'MAIN_GAME');
  const modes = input.gameModes;
  f.multiplayer = flag(
    modes !== null && modes.some((m) => m !== 'SINGLE_PLAYER'),
  );
  f.singlePlayer = flag(modes !== null && modes.includes('SINGLE_PLAYER'));
  // The vocabulary of tags and genres is the one the model was frozen with.
  const tags = new Set(input.tags);
  const genres = new Set(input.genres);
  for (const column of columns) {
    if (column.startsWith('tag_')) f[column] = flag(tags.has(column.slice(4)));
    else if (column.startsWith('genre_'))
      f[column] = flag(genres.has(column.slice(6)));
  }

  // track record of the series and of the studio
  f.log_seriesBest =
    input.seriesGames > 0 && input.seriesBest !== null
      ? Math.log(input.seriesBest)
      : null;
  f.seriesGames = input.seriesGames;
  f.log_studioBest =
    input.studioGames > 0 && input.studioBest !== null
      ? Math.log(input.studioBest)
      : null;
  f.studioGames = input.studioGames;

  return { features: f, target: asked };
}

import { V2FeatureInput, V2_PLATFORMS } from './v2-features';
import { V2ModelJson } from './v2-model';

/**
 * What the base holds on a game at a date, read the way the lab reads it
 * (`ml2/dataset.py`: `signals_at`, `reviews_at_date`, `total_reason`, the kept
 * figures; and `ml2/features.py`: `Context.best_before`). A handful of queries
 * for any number of games; every one is bounded by the games asked (and their
 * series and studio peers), never by the catalog.
 */

export type V2Query = <T = Record<string, unknown>>(
  sql: string,
  params: unknown[],
) => Promise<T[]>;

const MS_PER_DAY = 86_400_000;
/** The site publishes no estimate for games released before 2017. */
const SCOPE_START = Date.UTC(2017, 0, 1);
const PLAYER_SOURCES = new Set(['STEAM_LEAK', 'PLAYSTATION_LEAK']);

// A reading is known from `at`. Rows imported from monthly history are stamped
// on the first day of a month but hold the value at its end: they are only
// known once that month is over (`with_available_at`).
const AVAILABLE_AT = `CASE
    WHEN metric IN ('STEAM_REVIEWS', 'STEAM_CONCURRENT', 'STEAM_PEAK_CCU')
     AND extract(day FROM "capturedAt") = 1
     AND extract(hour FROM "capturedAt") <= 2
     AND "capturedAt" < TIMESTAMP '2026-09-01'
    THEN date_trunc('month', "capturedAt") + interval '1 month'
    ELSE "capturedAt" END`;

const ms = (column: string): string =>
  `(extract(epoch FROM ${column}) * 1000)::float8`;

const GAMES_SQL = `
  SELECT id::text AS id, ${ms('"releaseDate"')} AS "releaseDate",
         "isFree", ("deletedAt" IS NOT NULL) AS deleted,
         platforms::text[] AS platforms, "developerId"::text AS "developerId",
         "seriesSlug", "franchiseSlug", "isAnnualIteration", "liveService",
         "gameType"::text AS "gameType", "gameModes"::text[] AS "gameModes",
         ("timeToBeat"->>'normally')::float8 AS "timeToBeatSeconds",
         genres, "steamTags", COALESCE(array_length(dlc, 1), 0) AS "dlcCount",
         "estimateHidden", COALESCE("igdbGamePassCloud", false) AS "gamePass"
    FROM game`;

const RELEASES_SQL = `
  SELECT "gameId"::text AS "gameId", platform::text AS platform,
         ${ms('MIN("releaseDate")')} AS "releaseDate"
    FROM game_platform_release_date
   WHERE "gameId" = ANY($1::uuid[])
   GROUP BY 1, 2`;

const SIGNAL_METRICS = `('STEAM_REVIEWS', 'STEAM_CONCURRENT', 'STEAM_PEAK_CCU',
  'PS_RATINGS', 'XBOX_RATINGS', 'STEAM_FOLLOWERS', 'STEAM_TOPSELLER_RANK',
  'TWITCH_VIEWERS', 'STEAM_REVIEWER_MEDIAN_PLAYTIME')`;

// $1 games, $2 the date each one is read at (UTC, no zone).
const SIGNALS_SQL = `
  WITH points AS (
    SELECT * FROM unnest($1::uuid[], $2::timestamp[]) AS p(id, t)
  ), known AS (
    SELECT p.id AS "gameId", p.t, s.metric::text AS metric, s.value, s."averageRating", s.at
      FROM points p
      JOIN LATERAL (
        SELECT metric, value, "averageRating", ${AVAILABLE_AT} AS at
          FROM signal_snapshot
         WHERE "gameId" = p.id AND NOT synthetic AND "capturedAt" <= p.t
           AND metric IN ${SIGNAL_METRICS}
      ) s ON s.at <= p.t
  ), latest AS (
    SELECT DISTINCT ON ("gameId", metric) "gameId", metric, value, "averageRating", at
      FROM known
     WHERE metric IN ('STEAM_REVIEWS', 'PS_RATINGS', 'XBOX_RATINGS',
                      'STEAM_FOLLOWERS', 'STEAM_REVIEWER_MEDIAN_PLAYTIME')
     -- Two readings known at the same instant: the higher one (counts only grow).
     ORDER BY "gameId", metric, at DESC, value DESC
  ), next_reviews AS (
    -- The first review count known after the date, to place the count on that date.
    SELECT DISTINCT ON (p.id) p.id AS "gameId", s.value, s.at
      FROM points p
      JOIN LATERAL (
        SELECT value, ${AVAILABLE_AT} AS at
          FROM signal_snapshot
         WHERE "gameId" = p.id AND NOT synthetic AND metric = 'STEAM_REVIEWS'
           AND "capturedAt" > p.t - interval '32 days'
      ) s ON s.at > p.t
     ORDER BY p.id, s.at ASC, s.value ASC
  )
  SELECT "gameId"::text AS "gameId", metric, value::float8 AS value,
         "averageRating"::float8 AS rating, ${ms('at')} AS at
    FROM latest
  UNION ALL
  SELECT "gameId"::text, 'PEAK', MAX(value)::float8, NULL, NULL
    FROM known WHERE metric IN ('STEAM_CONCURRENT', 'STEAM_PEAK_CCU') GROUP BY 1
  UNION ALL
  SELECT "gameId"::text, 'BEST_RANK', MIN(value)::float8, NULL, NULL
    FROM known WHERE metric = 'STEAM_TOPSELLER_RANK' GROUP BY 1
  UNION ALL
  SELECT "gameId"::text, 'TWITCH_30D',
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY value))::float8, NULL, NULL
    FROM known
   WHERE metric = 'TWITCH_VIEWERS' AND at > t - interval '30 days'
   GROUP BY 1
  UNION ALL
  SELECT "gameId"::text, 'REVIEWS_NEXT', value::float8, NULL, ${ms('at')}
    FROM next_reviews
  UNION ALL
  SELECT p.id::text, 'READ_BY_STEAM', 1, NULL, NULL
    FROM points p
   WHERE EXISTS (SELECT 1 FROM signal_snapshot
                  WHERE "gameId" = p.id AND metric = 'STEAM_REVIEWS' AND NOT synthetic)`;

// Current full Steam price (US, cents): a trait of the game.
const PRICES_SQL = `
  SELECT DISTINCT ON ("gameId") "gameId"::text AS "gameId", initial::float8 AS "priceCents"
    FROM price_snapshot
   WHERE "gameId" = ANY($1::uuid[]) AND country = 'us' AND source = 'STEAM'
     AND initial > 0 AND "capturedAt" <= $2::timestamp
   ORDER BY "gameId", "capturedAt" DESC`;

// Figures entered by the date ($2): one entered later was not known then.
const MILESTONES_SQL = `
  SELECT "gameId"::text AS "gameId", platform::text AS platform, source::text AS source,
         units::float8 AS units, "isEstimate", "isEngagement",
         ${ms('"reportedAt"')} AS "reportedAt", ("rejectedAt" IS NOT NULL) AS rejected
    FROM milestone
   WHERE "gameId" = ANY($1::uuid[]) AND "capturedAt" <= $2::timestamp`;

interface GameRow {
  id: string;
  releaseDate: number | null;
  isFree: boolean | null;
  deleted: boolean;
  platforms: string[] | null;
  developerId: string | null;
  seriesSlug: string | null;
  franchiseSlug: string | null;
  isAnnualIteration: boolean | null;
  liveService: boolean | null;
  gameType: string | null;
  gameModes: string[] | null;
  timeToBeatSeconds: number | null;
  genres: string | null;
  steamTags: string | null;
  dlcCount: number;
  estimateHidden: boolean | null;
  gamePass: boolean;
}

interface MilestoneRow {
  gameId: string;
  platform: string;
  source: string;
  units: number;
  isEstimate: boolean;
  isEngagement: boolean;
  reportedAt: number | null;
  rejected: boolean;
}

interface SignalRow {
  gameId: string;
  metric: string;
  value: number | null;
  rating: number | null;
  at: number | null;
}

/** What the sources said about one game at one date, by metric. */
export type V2Signals = Map<string, SignalRow>;

/** A published figure the lab keeps (`dataset.build`). */
export interface V2Figure {
  reportedAt: number;
  units: number;
  /** The figure counts as the game's total. */
  total: boolean;
  /** Owners or players (a leak), not sales. */
  players: boolean;
}

export type V2Status =
  /** Deleted, free, or released before 2017: the site gives no estimate. */
  | 'out-of-scope'
  /** Excluded by hand (`exclusions` of the frozen file, or hidden in the admin). */
  | 'excluded'
  | 'unreleased'
  | 'estimated';

const split = (text: string | null): string[] =>
  text
    ? text
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    : [];

const seriesOf = (g: GameRow): string | null => g.seriesSlug ?? g.franchiseSlug;

const startOfDay = (time: number): number =>
  Math.floor(time / MS_PER_DAY) * MS_PER_DAY;

/** UTC timestamp without zone, as the `capturedAt` columns hold it. */
const utc = (date: Date): string => date.toISOString().replace('Z', '');

/** Readings of the games, each at its own date. */
export async function loadV2Signals(
  query: V2Query,
  points: { gameId: string; at: Date }[],
): Promise<Map<string, V2Signals>> {
  const out = new Map<string, V2Signals>();
  if (points.length === 0) return out;
  const rows = await query<SignalRow>(SIGNALS_SQL, [
    points.map((p) => p.gameId),
    points.map((p) => utc(p.at)),
  ]);
  for (const row of rows) {
    if (!out.has(row.gameId)) out.set(row.gameId, new Map());
    out.get(row.gameId)!.set(row.metric, row);
  }
  return out;
}

// Reviews pile up like the square root of the days since release during a launch.
const LAUNCH_EXPONENT = 0.5;
const MAX_LOOK_AHEAD = 31 * MS_PER_DAY;
const FRESH = 2 * MS_PER_DAY;

/**
 * Steam reviews on the day `t`, rebuilt from the readings around it
 * (`reviews_at_date`): monthly history only says the count at each month's
 * end. `readThatDay` is true when a reading of the last two days answers.
 */
export function v2ReviewsAtDate(
  signals: V2Signals | undefined,
  t: number,
  pcRelease: number | null,
): { reviews: number | null; readThatDay: boolean } {
  const read = (metric: string): { at: number; value: number } | null => {
    const row = signals?.get(metric);
    return row && row.at !== null && row.value !== null
      ? { at: row.at, value: row.value }
      : null;
  };
  const before = read('STEAM_REVIEWS');
  const after = read('REVIEWS_NEXT');
  if (before && t - before.at <= FRESH) {
    return { reviews: before.value, readThatDay: true };
  }
  if (!after || after.at - t > MAX_LOOK_AHEAD) {
    return { reviews: before ? before.value : null, readThatDay: false };
  }
  const days = (at: number): number =>
    Math.max((at - (pcRelease as number)) / MS_PER_DAY, 0.5) ** LAUNCH_EXPONENT;
  if (!before) {
    if (pcRelease === null || after.at <= pcRelease) {
      return { reviews: null, readThatDay: false };
    }
    if (t < pcRelease) return { reviews: 0, readThatDay: false };
    return {
      reviews: (after.value * days(t)) / days(after.at),
      readThatDay: false,
    };
  }
  // No curve to follow before the release: a straight line in time.
  const share =
    pcRelease === null || before.at <= pcRelease
      ? (t - before.at) / (after.at - before.at)
      : (days(t) - days(before.at)) / (days(after.at) - days(before.at));
  return {
    reviews: before.value + (after.value - before.value) * share,
    readThatDay: false,
  };
}

/**
 * The games asked, their series and studio peers, their release dates, their
 * published figures and their price: everything but the dated signals.
 */
export class V2World {
  private readonly games = new Map<string, GameRow>();
  private readonly dates = new Map<string, Map<string, number>>();
  private readonly milestones = new Map<string, MilestoneRow[]>();
  private readonly price = new Map<string, number>();
  private readonly bySeries = new Map<string, GameRow[]>();
  private readonly byStudio = new Map<string, GameRow[]>();
  private readonly kept = new Map<string, V2Figure[]>();

  private constructor(private readonly model: V2ModelJson) {}

  /** `knownBy`: figures and prices entered after that date are not read. */
  static async load(
    query: V2Query,
    model: V2ModelJson,
    gameIds: string[],
    knownBy: Date,
  ): Promise<V2World> {
    const world = new V2World(model);
    if (gameIds.length === 0) return world;
    const at = utc(knownBy);
    const targets = await query<GameRow>(
      `${GAMES_SQL} WHERE id = ANY($1::uuid[])`,
      [gameIds],
    );
    const series = [
      ...new Set(targets.map(seriesOf).filter((s) => s !== null)),
    ];
    const studios = [
      ...new Set(targets.map((g) => g.developerId).filter((s) => s !== null)),
    ];
    // Peers: the other games of the series and of the studio of the games asked.
    const peers = await query<GameRow>(
      `${GAMES_SQL}
        WHERE COALESCE("seriesSlug", "franchiseSlug") = ANY($1::text[])
           OR "developerId" = ANY($2::uuid[])`,
      [series, studios],
    );
    for (const g of [...peers, ...targets]) world.games.set(g.id, g);
    const allIds = [...world.games.keys()];
    const [releases, prices, milestones] = await Promise.all([
      query<{ gameId: string; platform: string; releaseDate: number | null }>(
        RELEASES_SQL,
        [allIds],
      ),
      query<{ gameId: string; priceCents: number }>(PRICES_SQL, [gameIds, at]),
      query<MilestoneRow>(MILESTONES_SQL, [allIds, at]),
    ]);
    for (const r of releases) {
      if (r.releaseDate === null) continue;
      if (!world.dates.has(r.gameId)) world.dates.set(r.gameId, new Map());
      world.dates.get(r.gameId)!.set(r.platform, r.releaseDate);
    }
    for (const p of prices) world.price.set(p.gameId, p.priceCents);
    for (const m of milestones) {
      if (!world.milestones.has(m.gameId)) world.milestones.set(m.gameId, []);
      world.milestones.get(m.gameId)!.push(m);
    }
    for (const g of world.games.values()) {
      const s = seriesOf(g);
      if (s !== null)
        world.bySeries.set(s, [...(world.bySeries.get(s) ?? []), g]);
      if (g.developerId !== null) {
        world.byStudio.set(g.developerId, [
          ...(world.byStudio.get(g.developerId) ?? []),
          g,
        ]);
      }
    }
    return world;
  }

  has(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /** First release anywhere: `game.releaseDate` is sometimes a later port. */
  firstRelease(gameId: string): number | null {
    const g = this.games.get(gameId);
    if (!g) return null;
    const all = [...(this.dates.get(gameId)?.values() ?? [])];
    if (g.releaseDate !== null) all.push(g.releaseDate);
    return all.length ? Math.min(...all) : null;
  }

  /** PC release, or the first release when Steam reads the game without one. */
  pcRelease(gameId: string, signals: V2Signals | undefined): number | null {
    return (
      this.dates.get(gameId)?.get('PC') ??
      (signals?.has('READ_BY_STEAM') ? this.firstRelease(gameId) : null)
    );
  }

  private excluded(g: GameRow): boolean {
    return (
      g.estimateHidden === true ||
      this.model.exclusions.some((rule) =>
        rule.kind === 'series'
          ? g.seriesSlug === rule.value || g.franchiseSlug === rule.value
          : g.id === rule.value,
      )
    );
  }

  status(gameId: string, asOf: Date): V2Status {
    const g = this.games.get(gameId)!;
    const first = this.firstRelease(gameId);
    if (g.deleted || g.isFree === true) return 'out-of-scope';
    if (first !== null && first < SCOPE_START) return 'out-of-scope';
    if (this.excluded(g)) return 'excluded';
    if (first === null || first > asOf.getTime()) return 'unreleased';
    return 'estimated';
  }

  platforms(gameId: string): string[] {
    return this.games.get(gameId)?.platforms ?? [];
  }

  gamePass(gameId: string): boolean {
    return this.games.get(gameId)?.gamePass === true;
  }

  /** The published figures of a game the lab keeps, oldest first. */
  figures(gameId: string): V2Figure[] {
    const cached = this.kept.get(gameId);
    if (cached) return cached;
    const g = this.games.get(gameId);
    const out: V2Figure[] = [];
    this.kept.set(gameId, out);
    if (!g || g.deleted || g.isFree === true || this.excluded(g)) return out;
    const first = this.firstRelease(gameId);
    if (first !== null && first < SCOPE_START) return out;
    const rows = this.milestones.get(gameId) ?? [];
    const platforms: readonly string[] = V2_PLATFORMS;
    const seen = new Set(
      rows.filter((m) => platforms.includes(m.platform)).map((m) => m.platform),
    );
    const gameDates = this.dates.get(gameId) ?? new Map<string, number>();
    const sorted = rows
      .filter((m) => m.reportedAt !== null)
      // Two figures of the same day: the higher one is the later state.
      .sort((a, b) => a.reportedAt! - b.reportedAt! || a.units - b.units);
    const repeated = new Set<string>();
    for (const m of sorted) {
      const reportedAt = m.reportedAt!;
      if (m.rejected || m.isEngagement) continue;
      if (m.units <= 0 || m.isEstimate || m.platform === 'SWITCH') continue;
      if (first !== null && reportedAt < first) continue;
      const players = PLAYER_SOURCES.has(m.source);
      let total = m.platform === 'GLOBAL';
      if (!total && platforms.includes(m.platform) && !players) {
        // A platform figure is the total when the game sold nowhere else by then.
        const others = new Set<string>([
          ...(g.platforms ?? []),
          ...seen,
          ...platforms.filter((p) => gameDates.has(p)),
        ]);
        others.delete(m.platform);
        const day = startOfDay(reportedAt);
        total = ![...others].some((p) => {
          const date = gameDates.get(p);
          return !(date !== undefined && date > day);
        });
      }
      // The same figure repeated (a threshold quoted again later): its first date stands.
      const key = `${total ? 'TOTAL' : m.platform}|${players}|${m.units}`;
      if (repeated.has(key)) continue;
      repeated.add(key);
      out.push({ reportedAt, units: m.units, total, players });
    }
    return out;
  }

  /** Best total an earlier game of the group had published before `t`. */
  private bestBefore(
    gameId: string,
    group: GameRow[],
    t: number,
  ): { best: number | null; games: number } {
    const mine = this.firstRelease(gameId);
    let best: number | null = null;
    let count = 0;
    for (const peer of group) {
      const theirs = this.firstRelease(peer.id);
      if (peer.id === gameId || theirs === null) continue;
      if (mine !== null && theirs >= mine) continue;
      const known = this.figures(peer.id)
        .filter((f) => f.total && f.reportedAt < t)
        .map((f) => f.units);
      if (known.length === 0) continue;
      best = Math.max(best ?? 0, ...known);
      count += 1;
    }
    return { best, games: count };
  }

  /**
   * The model's inputs for a game at `asOf`, from readings taken at their own
   * date. `steamReviews` overrides the last count read (a rebuilt count).
   */
  input(
    gameId: string,
    asOf: Date,
    signals: V2Signals | undefined,
    steamReviews?: number | null,
  ): V2FeatureInput | null {
    const g = this.games.get(gameId);
    const first = this.firstRelease(gameId);
    if (!g || first === null) return null; // no release date: nothing to estimate
    const t = asOf.getTime();
    const value = (metric: string) => signals?.get(metric)?.value ?? null;
    const reviews = signals?.get('STEAM_REVIEWS');
    const gameDates = this.dates.get(gameId);
    const date = (p: string) => {
      const d = gameDates?.get(p);
      return d === undefined ? null : new Date(d);
    };
    const s = seriesOf(g);
    const seriesRecord = this.bestBefore(
      gameId,
      s === null ? [] : (this.bySeries.get(s) ?? []),
      t,
    );
    const studioRecord = this.bestBefore(
      gameId,
      g.developerId === null ? [] : (this.byStudio.get(g.developerId) ?? []),
      t,
    );
    return {
      asOf,
      firstRelease: new Date(first),
      releaseDates: {
        PC: date('PC'),
        PLAYSTATION: date('PLAYSTATION'),
        XBOX: date('XBOX'),
      },
      platforms: g.platforms ?? [],
      steamReviews:
        steamReviews === undefined ? (reviews?.value ?? null) : steamReviews,
      steamPositiveShare: reviews?.rating ?? null,
      steamReviewsAgeDays: null, // set by the caller: it depends on the reading date
      steamPeakPlayers: value('PEAK'),
      psRatings: value('PS_RATINGS'),
      psAverage: signals?.get('PS_RATINGS')?.rating ?? null,
      xboxRatings: value('XBOX_RATINGS'),
      xboxAverage: signals?.get('XBOX_RATINGS')?.rating ?? null,
      steamFollowers: value('STEAM_FOLLOWERS'),
      twitchViewers30d: value('TWITCH_30D'),
      steamBestSalesRank: value('BEST_RANK'),
      steamMedianPlaytime: value('STEAM_REVIEWER_MEDIAN_PLAYTIME'),
      priceCents: this.price.get(gameId) ?? null,
      timeToBeatSeconds: g.timeToBeatSeconds,
      dlcCount: g.dlcCount,
      isAnnualIteration: g.isAnnualIteration === true,
      liveService: g.liveService === true,
      inSeries: s !== null,
      gameType: g.gameType,
      gameModes: g.gameModes,
      tags: split(g.steamTags).slice(0, 10),
      genres: split(g.genres),
      seriesBest: seriesRecord.best,
      seriesGames: seriesRecord.games,
      studioBest: studioRecord.best,
      studioGames: studioRecord.games,
    };
  }
}

/** Days since the review count was last read, at the date the signals are read. */
export function v2ReviewsAge(
  signals: V2Signals | undefined,
  readAt: Date,
): number | null {
  const at = signals?.get('STEAM_REVIEWS')?.at;
  return at === null || at === undefined
    ? null
    : (readAt.getTime() - at) / MS_PER_DAY;
}

/** The model's inputs of each game at one date. */
export async function loadV2Inputs(
  query: V2Query,
  model: V2ModelJson,
  gameIds: string[],
  asOf: Date,
): Promise<Map<string, V2FeatureInput>> {
  const out = new Map<string, V2FeatureInput>();
  if (gameIds.length === 0) return out;
  const [world, signals] = await Promise.all([
    V2World.load(query, model, gameIds, asOf),
    loadV2Signals(
      query,
      gameIds.map((gameId) => ({ gameId, at: asOf })),
    ),
  ]);
  for (const gameId of gameIds) {
    const read = signals.get(gameId);
    const input = world.input(gameId, asOf, read);
    if (!input) continue;
    input.steamReviewsAgeDays = v2ReviewsAge(read, asOf);
    out.set(gameId, input);
  }
  return out;
}

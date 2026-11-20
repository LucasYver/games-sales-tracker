import { V2FeatureInput } from './v2-features';
import { V2Features, V2Model } from './v2-model';

/**
 * Why the V2 model gave a game its total: the share of each family of inputs
 * in the answer, for the admin only (the rebuild never calls this). Pure.
 *
 * Exact Shapley values over families: the model is asked with every subset
 * of families known and the others missing (the trees send a missing value
 * where the training data mostly went), so the contributions add up exactly
 * to the gap between "a game the model knows nothing of" and the game. The
 * answer is in log space, so each contribution is a factor (×1.4, ×0.7).
 * The columns saying which figure is asked (total, PC…) stay known.
 */

interface Family {
  name: string;
  /** Column names, or prefixes ending with `_`. */
  columns: string[];
}

const FAMILIES: Family[] = [
  {
    name: 'Steam reviews',
    columns: [
      'log_steamReviews',
      'steamPositiveShare',
      'log_reviewsPerDay',
      'log_steamReviewsAgeDays',
    ],
  },
  {
    name: 'Steam players',
    columns: [
      'log_steamPeakPlayers',
      'log_peakPerReview',
      'log_steamMedianPlaytime',
    ],
  },
  {
    name: 'Audience',
    columns: [
      'log_steamFollowers',
      'log_twitchViewers30d',
      'log_steamBestSalesRank',
    ],
  },
  {
    name: 'Console ratings',
    columns: ['log_psRatings', 'log_xboxRatings', 'psAverage', 'xboxAverage'],
  },
  { name: 'Age', columns: ['log_ageDays', 'releaseYear', 'reportYear'] },
  {
    name: 'Platforms',
    columns: [
      'onPc',
      'log_daysOnPc',
      'onPlaystation',
      'log_daysOnPlaystation',
      'onXbox',
      'log_daysOnXbox',
      'platformCount',
      'log_pcDelayDays',
    ],
  },
  {
    name: 'Game traits',
    columns: [
      'log_price',
      'log_timeToBeat',
      'log_dlcCount',
      'annualIteration',
      'liveService',
      'inSeries',
      'mainGame',
      'multiplayer',
      'singlePlayer',
    ],
  },
  { name: 'Tags & genres', columns: ['tag_', 'genre_'] },
  {
    name: 'Series & studio',
    columns: ['log_seriesBest', 'seriesGames', 'log_studioBest', 'studioGames'],
  },
];

/** Which figure is asked: always known. */
const FIXED = new Set(['isTotal', 'isPc', 'isPlaystation', 'isXbox']);

export interface V2ExplainInput {
  label: string;
  /** Formatted for display; null when the base has nothing. */
  value: string | null;
}

export interface V2Explanation {
  /**
   * `perReview`: the model answers sales per Steam review, times the reviews;
   * `direct`: it answers sales (no Steam reviews).
   */
  head: 'perReview' | 'direct';
  steamReviews: number | null;
  /** Sales (direct) or sales per review (perReview) knowing nothing. */
  base: number;
  /** Same, knowing everything: the model's answer. */
  full: number;
  families: {
    name: string;
    /** Multiplicative contribution: exp(Shapley value in log space). */
    factor: number;
    inputs: V2ExplainInput[];
  }[];
}

function familyOf(column: string): number {
  const i = FAMILIES.findIndex((f) =>
    f.columns.some((c) =>
      c.endsWith('_') ? column.startsWith(c) : c === column,
    ),
  );
  return i === -1 ? FAMILIES.length : i; // an unknown column: "Other"
}

const compact = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : `${Math.round(n)}`;
const num = (v: number | null): string | null =>
  v === null || v <= 0 ? null : compact(v);
const pct = (v: number | null): string | null =>
  v === null ? null : `${Math.round(v * 100)}%`;
const hours = (v: number | null, perHour: number): string | null =>
  v === null || v <= 0 ? null : `${(v / perHour).toFixed(1)} h`;
const yes = (b: boolean): string => (b ? 'yes' : 'no');

/** What the model was given, per family, in readable units. */
function inputsByFamily(
  input: V2FeatureInput,
  columns: string[],
): V2ExplainInput[][] {
  const ageDays = Math.max(
    (input.asOf.getTime() - input.firstRelease.getTime()) / 86_400_000,
    0,
  );
  // A tag and a genre can share a name (indie): list it once.
  const tags = [
    ...new Set(
      columns
        .filter(
          (c) =>
            (c.startsWith('tag_') && input.tags.includes(c.slice(4))) ||
            (c.startsWith('genre_') && input.genres.includes(c.slice(6))),
        )
        .map((c) => c.slice(c.indexOf('_') + 1)),
    ),
  ];
  const platform = (p: 'PC' | 'PLAYSTATION' | 'XBOX'): string | null => {
    const d = input.releaseDates[p];
    if (d) return d.toISOString().slice(0, 10);
    return input.platforms.includes(p) ? 'listed' : null;
  };
  return [
    [
      { label: 'reviews', value: num(input.steamReviews) },
      { label: 'positive', value: pct(input.steamPositiveShare) },
      {
        label: 'per day',
        value:
          input.steamReviews && input.steamReviews > 0
            ? (input.steamReviews / Math.max(ageDays, 1)).toFixed(1)
            : null,
      },
    ],
    [
      { label: 'peak players', value: num(input.steamPeakPlayers) },
      { label: 'median playtime', value: hours(input.steamMedianPlaytime, 60) },
    ],
    [
      { label: 'followers', value: num(input.steamFollowers) },
      { label: 'Twitch viewers (30 d)', value: num(input.twitchViewers30d) },
      {
        label: 'best top-seller rank',
        value:
          input.steamBestSalesRank !== null && input.steamBestSalesRank > 0
            ? `#${input.steamBestSalesRank}`
            : null,
      },
    ],
    [
      {
        label: 'PS ratings',
        value:
          num(input.psRatings) &&
          `${num(input.psRatings)}${input.psAverage !== null ? ` (${input.psAverage.toFixed(1)}★)` : ''}`,
      },
      {
        label: 'Xbox ratings',
        value:
          num(input.xboxRatings) &&
          `${num(input.xboxRatings)}${input.xboxAverage !== null ? ` (${input.xboxAverage.toFixed(1)}★)` : ''}`,
      },
    ],
    [
      { label: 'age', value: `${Math.round(ageDays)} d` },
      {
        label: 'released',
        value: input.firstRelease.toISOString().slice(0, 10),
      },
    ],
    [
      { label: 'PC', value: platform('PC') },
      { label: 'PlayStation', value: platform('PLAYSTATION') },
      { label: 'Xbox', value: platform('XBOX') },
    ],
    [
      {
        label: 'price',
        value:
          input.priceCents !== null
            ? `$${(input.priceCents / 100).toFixed(2)}`
            : null,
      },
      { label: 'time to beat', value: hours(input.timeToBeatSeconds, 3600) },
      { label: 'DLC', value: `${input.dlcCount ?? 0}` },
      { label: 'live service', value: yes(input.liveService) },
      { label: 'annual', value: yes(input.isAnnualIteration) },
      { label: 'in a series', value: yes(input.inSeries) },
      {
        label: 'modes',
        value: input.gameModes?.length
          ? input.gameModes
              .map((m) => m.toLowerCase().replace('_', ' '))
              .join(', ')
          : null,
      },
    ],
    [{ label: 'in the model', value: tags.length ? tags.join(', ') : null }],
    [
      {
        label: 'series best',
        value:
          input.seriesGames > 0 && input.seriesBest !== null
            ? `${compact(input.seriesBest)} (${input.seriesGames} games)`
            : null,
      },
      {
        label: 'studio best',
        value:
          input.studioGames > 0 && input.studioBest !== null
            ? `${compact(input.studioBest)} (${input.studioGames} games)`
            : null,
      },
    ],
    [],
  ];
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

export function explainV2(
  model: V2Model,
  input: V2FeatureInput,
  features: V2Features,
): V2Explanation {
  const columns = model.columns;
  const byFamily = new Map<number, string[]>();
  for (const column of columns) {
    if (FIXED.has(column)) continue;
    const i = familyOf(column);
    byFamily.set(i, [...(byFamily.get(i) ?? []), column]);
  }
  const families = [...byFamily.keys()].sort((a, b) => a - b);
  const n = families.length;

  // The model's log answer for every subset of known families (bit k = family k).
  const value = new Float64Array(1 << n);
  for (let mask = 0; mask < 1 << n; mask++) {
    const row: V2Features = { ...features };
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) continue;
      for (const column of byFamily.get(families[k])!) row[column] = null;
    }
    value[mask] = model.predictLog(row, input.steamReviews);
  }

  const weight = Array.from(
    { length: n },
    (_, size) => (factorial(size) * factorial(n - size - 1)) / factorial(n),
  );
  const bits = (m: number): number => {
    let c = 0;
    for (; m; m &= m - 1) c++;
    return c;
  };
  const shapley = families.map((_, k) => {
    let phi = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask & (1 << k)) continue;
      phi += weight[bits(mask)] * (value[mask | (1 << k)] - value[mask]);
    }
    return phi;
  });

  const perReview = (input.steamReviews ?? 0) > 0;
  // predictLog adds log(reviews) on the per-review head: take it out.
  const offset = perReview ? Math.log(input.steamReviews!) : 0;
  const inputs = inputsByFamily(input, columns);
  return {
    head: perReview ? 'perReview' : 'direct',
    steamReviews: input.steamReviews,
    base: Math.exp(value[0] - offset),
    full: Math.exp(value[(1 << n) - 1] - offset),
    families: families
      .map((f, k) => ({
        name: FAMILIES[f]?.name ?? 'Other',
        factor: Math.exp(shapley[k]),
        inputs: (inputs[f] ?? []).filter((x) => x.value !== null),
      }))
      .sort(
        (a, b) => Math.abs(Math.log(b.factor)) - Math.abs(Math.log(a.factor)),
      ),
  };
}

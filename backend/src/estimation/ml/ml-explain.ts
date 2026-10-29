import type { MlContributions } from './ml-ensemble';
import type { MlNeighbours, MlSignals } from './ml-features';

/**
 * Admin explanation of an ML estimate: what the model read, how much each
 * family of inputs moved the figure, and the « never down » steps. Pure —
 * `MlEstimateService.explain` gathers the inputs.
 */

const FAMILIES: Array<{ family: string; features: string[] }> = [
  {
    family: 'Steam reviews',
    features: [
      'log_reviews',
      'has_reviews',
      'log_reviews_stale_days',
      'log_reviews_30d',
      'log_reviews_90d',
      'has_early_reviews',
      'log_reviews_growth_90d',
      'has_reviews_growth',
      'reviews_x_release',
      'reviews_x_report',
      'reviews_x_age',
    ],
  },
  {
    family: 'Steam concurrent players',
    features: [
      'log_launch_ccu',
      'has_launch_ccu',
      'log_peak_ccu',
      'log_ccu_now',
      'launch_x_age',
    ],
  },
  {
    family: 'Consoles (PS / Xbox ratings, platforms)',
    features: [
      'log_ps_ratings',
      'has_ps_ratings',
      'log_xbox_ratings',
      'has_xbox_ratings',
      'on_ps',
      'on_xbox',
      'reviews_x_onps',
    ],
  },
  {
    family: 'Age and year',
    features: ['log_age_days', 'release_year', 'report_year'],
  },
  {
    family: 'Neighbours (matcher)',
    features: [
      'log_matcher_reviews_to_units',
      'log_matcher_m1',
      'matcher_pc_share',
    ],
  },
  {
    family: 'Series & developer track record',
    features: [
      'log_series_best',
      'has_series_best',
      'log_developer_best',
      'has_developer_best',
    ],
  },
  { family: 'Steam followers', features: ['log_followers', 'has_followers'] },
];
const OTHER_FAMILY = 'The game (genre, tags, DLC, series…)';

const familyOf = (feature: string): string =>
  FAMILIES.find((f) => f.features.includes(feature))?.family ?? OTHER_FAMILY;

export interface MlFamilyEffect {
  family: string;
  /** Multiplicative effect on the estimate (×). */
  forest: number;
  ridge: number;
  average: number;
}

export interface MlDecomposition {
  /** Estimate of a typical training game, before any input. */
  start: { forest: number; ridge: number; average: number };
  families: MlFamilyEffect[];
  result: { forest: number; ridge: number; average: number };
}

export function decompose(c: MlContributions): MlDecomposition {
  const sum = (by: Record<string, number>) => {
    const out = new Map<string, number>();
    for (const [feature, v] of Object.entries(by)) {
      const fam = familyOf(feature);
      out.set(fam, (out.get(fam) ?? 0) + v);
    }
    return out;
  };
  const forest = sum(c.forest);
  const ridge = sum(c.ridge);
  const names = [...FAMILIES.map((f) => f.family), OTHER_FAMILY].filter(
    (f) => forest.has(f) || ridge.has(f),
  );
  const families = names
    .map((family) => {
      const f = forest.get(family) ?? 0;
      const r = ridge.get(family) ?? 0;
      return {
        family,
        forest: Math.exp(f),
        ridge: Math.exp(r),
        average: Math.exp((f + r) / 2),
      };
    })
    .sort((a, b) => a.average - b.average);
  const forestLog =
    c.forestStart + Object.values(c.forest).reduce((s, v) => s + v, 0);
  const ridgeLog =
    c.ridgeStart + Object.values(c.ridge).reduce((s, v) => s + v, 0);
  return {
    start: {
      forest: Math.exp(c.forestStart),
      ridge: Math.exp(c.ridgeStart),
      average: Math.exp((c.forestStart + c.ridgeStart) / 2),
    },
    families,
    result: {
      forest: Math.exp(forestLog),
      ridge: Math.exp(ridgeLog),
      average: Math.exp((forestLog + ridgeLog) / 2),
    },
  };
}

export interface MlInput {
  label: string;
  value: number | string | null;
}

/** The raw inputs, as an admin reads them. */
export function describeInputs(
  signals: MlSignals,
  neighbours: MlNeighbours | null,
  ageDays: number | null,
): MlInput[] {
  return [
    { label: 'Days since PC release', value: ageDays },
    {
      label: 'Steam reviews',
      value: signals.reviews?.value ?? null,
    },
    {
      label: 'Steam reviews captured on',
      value: signals.reviews?.capturedAt.toISOString().slice(0, 10) ?? null,
    },
    { label: 'Steam reviews 30 days after release', value: signals.reviews30d },
    { label: 'Steam reviews 90 days after release', value: signals.reviews90d },
    { label: 'Launch peak concurrent players', value: signals.launchPeakCcu },
    { label: 'All-time peak concurrent players', value: signals.peakCcu },
    { label: 'Concurrent players at the date', value: signals.ccuNow },
    { label: 'PlayStation Store ratings', value: signals.psRatings },
    { label: 'Xbox Store ratings', value: signals.xboxRatings },
    { label: 'Steam followers', value: signals.followers },
    {
      label: 'Best published figure, earlier game of the series',
      value: signals.seriesBest,
    },
    {
      label: 'Best published figure, earlier game of the developer',
      value: signals.developerBest,
    },
    {
      label: 'Neighbours: PC units per Steam review',
      value:
        neighbours?.pcBoxleiterLow != null
          ? round1(
              (neighbours.pcBoxleiterLow + (neighbours.pcBoxleiterHigh ?? 0)) /
                2,
            )
          : null,
    },
    {
      label: 'Neighbours: year-one / week-one sales',
      value: neighbours
        ? round1(neighbours.firstWeekToYearOneMultiplier)
        : null,
    },
    {
      label: 'Neighbours: PC share of sales',
      value: neighbours ? round1(neighbours.pcShare * 100) + ' %' : null,
    },
  ];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

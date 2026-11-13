import { V2ModelJson, V2Prediction } from './v2-model';

/**
 * The rules after the V2 model: how a game's estimate is reached from the
 * model's answer, its console ratings and its own published figures.
 *
 * Mirror of `ml2/estimate_catalog.py` (anchoring, floor, ranges) and of
 * `console_units` and `combine` in `ml2/consoles.py`. Pure.
 *
 *   1. a game that published a total is anchored on it: last total × growth
 *      of its Steam reviews since (or of the model's answer when it has no
 *      reviews to follow), never below the published total;
 *   2. otherwise the model stands, raised to consoles + PC when the console
 *      ratings say more; under 10 Steam reviews the consoles stand alone;
 *   3. a published platform figure is a floor;
 *   4. with no signal at all the game is not estimated.
 */

const MS_PER_DAY = 86_400_000;
/** Upper bounds, in whole days, of the anchor's age groups (`anchor.GAPS`). */
const ANCHOR_GAPS: [number, string][] = [
  [30, "moins d'un mois"],
  [180, '1 à 6 mois'],
  [365, '6 à 12 mois'],
  [Infinity, "plus d'un an"],
];

export type V2Basis =
  | 'anchored'
  | 'platform-floor'
  | 'model'
  | 'model-raised-by-consoles'
  | 'consoles'
  | 'not-estimated';

/** The game's last published total, with what was known at its date. */
export interface V2Anchor {
  units: number;
  reportedAt: Date;
  /** Steam reviews at the figure's date, as the model reads them. */
  steamReviewsAtDate: number | null;
  /** Whether that count was read that day (not rebuilt from readings around). */
  reviewsReadThatDay: boolean;
  /** log of the model's total for the game at the figure's date. */
  modelLogAtDate: number;
}

export interface V2EstimateInput {
  asOf: Date;
  firstRelease: Date;
  /** The model's total today, with its range. */
  model: V2Prediction;
  /** The model's PC sales today. */
  modelPc: number;
  /** Steam reviews today. */
  steamReviews: number | null;
  /** Platforms the game is listed on. */
  onPc: boolean;
  onPlaystation: boolean;
  onXbox: boolean;
  psRatings: number | null;
  xboxRatings: number | null;
  /** On Game Pass: its Xbox ratings also come from subscribers. */
  gamePass: boolean;
  anchor: V2Anchor | null;
  /** Highest published sales figure of the game, any platform. */
  bestPublished: number | null;
}

export interface V2Estimate {
  basis: V2Basis;
  /** Null when the game is not estimated. */
  units: number | null;
  low: number | null;
  high: number | null;
  /** PlayStation + Xbox sales from the store ratings. */
  consoleUnits: number;
}

function consoleUnits(model: V2ModelJson, g: V2EstimateInput): number {
  const { ratios } = model.consoles;
  const rated = (ratings: number | null) =>
    ratings !== null && ratings > 0 ? ratings : 0;
  const ps = g.onPlaystation ? rated(g.psRatings) * ratios.PLAYSTATION : 0;
  const xbox = g.onXbox
    ? rated(g.xboxRatings) * (g.gamePass ? ratios.XBOX_GAME_PASS : ratios.XBOX)
    : 0;
  return ps + xbox;
}

function anchored(
  model: V2ModelJson,
  g: V2EstimateInput,
  a: V2Anchor,
): { units: number; low: number; high: number } {
  const now = g.asOf.getTime();
  const release = g.firstRelease.getTime();
  const ageAtAnchor = Math.max(
    (a.reportedAt.getTime() - release) / MS_PER_DAY,
    1,
  );
  const ageNow = Math.max((now - release) / MS_PER_DAY, 1);
  const then = a.steamReviewsAtDate;
  const today = g.steamReviews;
  const byReviews =
    then !== null && then > 0 && today !== null && today >= then;
  const strength = a.reviewsReadThatDay
    ? model.anchor.launch.real
    : model.anchor.launch.rebuilt;
  // Reviews pile up faster than sales during a launch: the correction fades with age.
  const growth = byReviews
    ? Math.log(today / then) - strength * (1 / ageAtAnchor - 1 / ageNow)
    : Math.log(g.model.units) - a.modelLogAtDate;
  const mid =
    Math.log(a.units) + Math.max(Number.isFinite(growth) ? growth : 0, 0);
  const days = Math.floor((now - a.reportedAt.getTime()) / MS_PER_DAY);
  const gap = ANCHOR_GAPS.find(([upTo]) => days <= upTo)![1];
  const width = model.anchor.widths[gap];
  return {
    units: Math.exp(mid),
    low: Math.max(Math.exp(mid - width), a.units),
    high: Math.exp(mid + width),
  };
}

export function estimateV2(model: V2ModelJson, g: V2EstimateInput): V2Estimate {
  const consoles = consoleUnits(model, g);
  if (g.anchor) {
    return {
      basis: 'anchored',
      ...anchored(model, g, g.anchor),
      consoleUnits: consoles,
    };
  }

  // Without an anchor: the model, raised by the console ratings when they say more.
  const hasReviews =
    g.steamReviews !== null && g.steamReviews >= model.consoles.minSteamReviews;
  let basis: V2Basis;
  let units: number | null;
  let low: number | null;
  let high: number | null;
  if (hasReviews) {
    // A game sold at least what its consoles sold plus its PC version.
    const floor = consoles + (g.onPc ? g.modelPc : 0);
    units = Math.max(g.model.units, floor);
    basis = floor > g.model.units ? 'model-raised-by-consoles' : 'model';
    const scale = units / g.model.units;
    low = g.model.low * scale;
    high = g.model.high * scale;
  } else if (consoles > 0) {
    basis = 'consoles';
    units = consoles;
    low = consoles / model.consoles.consoleOnlyRange;
    high = consoles * model.consoles.consoleOnlyRange;
  } else {
    basis = 'not-estimated';
    units = low = high = null;
  }

  // A platform figure is still a floor: the game sold at least that.
  if (g.bestPublished !== null && g.bestPublished > (units ?? 0)) {
    return {
      basis: 'platform-floor',
      units: g.bestPublished,
      low: g.bestPublished,
      high: Math.max(high ?? g.bestPublished, g.bestPublished),
      consoleUnits: consoles,
    };
  }
  return { basis, units, low, high, consoleUnits: consoles };
}

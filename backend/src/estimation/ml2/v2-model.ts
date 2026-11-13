import rawModel from './v2-frozen.json';

/**
 * The V2 sales model frozen by `ml2/freeze.py` (two gradient-boosted models,
 * 300 trees each). `v2-frozen.json` is a copy of `ml2/models/<snapshot>/v2.json`
 * and `ml2/frozen.py` is the reference reader this file mirrors. Pure.
 *
 * `direct` answers log(sales); `perReview` answers log(sales per Steam review)
 * and is used, plus log(reviews), whenever the game has Steam reviews. The
 * range is symmetric in log space; its width depends on the type of figure
 * and on what is known of the game.
 */

interface TreeJson {
  /** Column asked per node, -1 on a leaf. */
  f: number[];
  /** Threshold of the node (`x <= t` goes left), or the value of a leaf. */
  t: number[];
  l: number[];
  r: number[];
  /** 1 when a missing value goes left. */
  m: number[];
}

interface BoostedJson {
  columns: string[];
  baseline: number;
  trees: TreeJson[];
}

export interface V2ModelJson {
  version: string;
  model: string;
  snapshot: string;
  direct: BoostedJson;
  perReview: BoostedJson | null;
  widths: Record<string, number>;
  widthScales: Record<string, number>;
  widthGroups: { manyReviews: number };
  anchor: {
    launch: { real: number; rebuilt: number };
    widths: Record<string, number>;
  };
  consoles: {
    ratios: Record<string, number>;
    minSteamReviews: number;
    consoleOnlyRange: number;
  };
  /** Games excluded by hand: a whole series (its slug) or one game (its id). */
  exclusions: { kind: string; value: string; reason: string }[];
}

interface CompiledTree {
  feature: Int32Array;
  value: Float64Array;
  left: Int32Array;
  right: Int32Array;
  missingLeft: Uint8Array;
}

interface CompiledBoosted {
  columns: string[];
  baseline: number;
  trees: CompiledTree[];
}

/** The type of figure asked of the model. */
export type V2Target = 'TOTAL' | 'PC' | 'PLAYSTATION' | 'XBOX';

/** Input columns by name; a missing value is `null` (never 0). */
export type V2Features = Record<string, number | null | undefined>;

export interface V2Prediction {
  units: number;
  low: number;
  high: number;
}

function compile(part: BoostedJson): CompiledBoosted {
  return {
    columns: part.columns,
    baseline: part.baseline,
    trees: part.trees.map((tree) => ({
      feature: Int32Array.from(tree.f),
      value: Float64Array.from(tree.t),
      left: Int32Array.from(tree.l),
      right: Int32Array.from(tree.r),
      missingLeft: Uint8Array.from(tree.m),
    })),
  };
}

function boosted(part: CompiledBoosted, x: Float64Array): number {
  let out = part.baseline;
  for (const tree of part.trees) {
    let node = 0;
    while (tree.feature[node] >= 0) {
      const value = x[tree.feature[node]];
      const goLeft = Number.isNaN(value)
        ? tree.missingLeft[node] === 1
        : value <= tree.value[node];
      node = goLeft ? tree.left[node] : tree.right[node];
    }
    out += tree.value[node];
  }
  return out;
}

/**
 * What is known of a game, from the finest description to the coarsest:
 * Steam reviews (none, few, many), then peak players known or not, then
 * console ratings known or not. Mirrors `signal_groups` of `ml2/learned.py`.
 */
export function v2SignalGroups(
  model: V2ModelJson,
  steamReviews: number | null,
  steamPeakPlayers: number | null,
  consoleRatings: number | null,
): string[] {
  const reviews = steamReviews ?? 0;
  const coarse =
    reviews <= 0
      ? 'no reviews'
      : reviews < model.widthGroups.manyReviews
        ? 'few reviews'
        : 'many reviews';
  const middle = `${coarse} / ${(steamPeakPlayers ?? 0) > 0 ? 'peak' : 'no peak'}`;
  const fine = `${middle} / ${
    (consoleRatings ?? 0) > 0 ? 'console ratings' : 'no console ratings'
  }`;
  return [fine, middle, coarse];
}

export class V2Model {
  readonly json: V2ModelJson;
  private readonly direct: CompiledBoosted;
  private readonly perReview: CompiledBoosted | null;

  constructor(json: V2ModelJson) {
    this.json = json;
    this.direct = compile(json.direct);
    this.perReview = json.perReview ? compile(json.perReview) : null;
  }

  get version(): string {
    return this.json.version;
  }

  get columns(): string[] {
    return this.direct.columns;
  }

  /** log(sales) for one row of input columns. */
  predictLog(features: V2Features, steamReviews: number | null): number {
    const row = (part: CompiledBoosted) =>
      Float64Array.from(part.columns, (name) => features[name] ?? NaN);
    if (this.perReview && (steamReviews ?? 0) > 0) {
      return (
        boosted(this.perReview, row(this.perReview)) +
        Math.log(steamReviews as number)
      );
    }
    return boosted(this.direct, row(this.direct));
  }

  /**
   * Estimate and range. `groups` comes from `v2SignalGroups`: the width of
   * the figure type is scaled by the finest group that was measured.
   */
  predict(
    features: V2Features,
    steamReviews: number | null,
    target: V2Target,
    groups: string[],
  ): V2Prediction {
    const mid = this.predictLog(features, steamReviews);
    const base = this.json.widths[target] ?? this.json.widths['*'];
    const group = groups.find((name) => name in this.json.widthScales);
    const width = base * (group ? this.json.widthScales[group] : 1);
    return {
      units: Math.exp(mid),
      low: Math.exp(mid - width),
      high: Math.exp(mid + width),
    };
  }
}

export const v2Model = new V2Model(rawModel);

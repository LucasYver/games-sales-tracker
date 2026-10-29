import rawModel from './ensemble-model.json';

/**
 * The worldwide sales model chosen in `ml/` (« Moyenne forêt + linéaire »):
 * the mean, in log space, of a 300-tree random forest and a ridge regression,
 * trained on real worldwide milestones and frozen by `ml/freeze.py`. Its
 * range is symmetric in log space: estimate ÷ factor → estimate × factor,
 * which held the published figure ~8 times out of 10 on unseen games.
 *
 * `ensemble-model.json` is a copy of `ml/models/<version>/ensemble.json`;
 * `ml/frozen.py` is the reference reader this file mirrors. Pure.
 */

interface ForestTreeJson {
  /** Feature index per node, -1 for a leaf. */
  f: number[];
  /** Threshold (internal node) or value (leaf), exact float32. */
  x: number[];
  /** Right child per node; the left child of node i is always i + 1. */
  r: number[];
  /** Mean value of every node (explanations only). */
  v?: number[];
}

export interface EnsembleModelJson {
  name: string;
  version: string;
  halfWidthFactor: number;
  tags: { column: string; tag: string }[];
  ridge: {
    features: string[];
    mean: number[];
    scale: number[];
    coef: number[];
    intercept: number;
  };
  forest: { features: string[]; trees: ForestTreeJson[] };
}

interface CompiledTree {
  feature: Int32Array;
  x: Float32Array;
  right: Int32Array;
  value: Float32Array | null;
}

/** log(units) = start + Σ contributions, per member of the ensemble. */
export interface MlContributions {
  forestStart: number;
  ridgeStart: number;
  forest: Record<string, number>;
  ridge: Record<string, number>;
}

export interface MlPrediction {
  units: number;
  low: number;
  high: number;
}

export class EnsembleModel {
  readonly version: string;
  readonly halfWidthFactor: number;
  readonly tagColumns: readonly string[];
  private readonly trees: CompiledTree[];

  constructor(private readonly json: EnsembleModelJson) {
    this.version = json.version;
    this.halfWidthFactor = json.halfWidthFactor;
    this.tagColumns = json.tags.map((t) => t.column);
    this.trees = json.forest.trees.map((t) => ({
      feature: Int32Array.from(t.f),
      x: Float32Array.from(t.x),
      right: Int32Array.from(t.r),
      value: t.v ? Float32Array.from(t.v) : null,
    }));
  }

  /** log(units) from the forest: mean of the trees' leaves. */
  predictForest(features: Record<string, number>): number {
    // scikit-learn compares float32 features with the thresholds.
    const row = Float32Array.from(
      this.json.forest.features.map((name) => valueOf(features, name)),
    );
    let sum = 0;
    for (const tree of this.trees) {
      let i = 0;
      while (tree.feature[i] >= 0) {
        i = row[tree.feature[i]] <= tree.x[i] ? i + 1 : tree.right[i];
      }
      sum += tree.x[i];
    }
    return sum / this.trees.length;
  }

  /** log(units) from the ridge regression (standardised features). */
  predictRidge(features: Record<string, number>): number {
    const r = this.json.ridge;
    let sum = r.intercept;
    r.features.forEach((name, j) => {
      sum += ((valueOf(features, name) - r.mean[j]) / r.scale[j]) * r.coef[j];
    });
    return sum;
  }

  /**
   * Exact split of each member's log(units) by feature. Ridge: coefficient ×
   * standardised value. Forest: along each tree's path, every split moves the
   * value from the node to the chosen child; the move is credited to the
   * split's feature, then averaged over the trees.
   */
  explain(features: Record<string, number>): MlContributions {
    const names = this.json.forest.features;
    const row = Float32Array.from(names.map((n) => valueOf(features, n)));
    const forest: Record<string, number> = {};
    let forestStart = 0;
    for (const tree of this.trees) {
      if (!tree.value) throw new Error('Model has no node values to explain');
      let i = 0;
      forestStart += tree.value[0];
      while (tree.feature[i] >= 0) {
        const f = tree.feature[i];
        const child = row[f] <= tree.x[i] ? i + 1 : tree.right[i];
        forest[names[f]] =
          (forest[names[f]] ?? 0) + tree.value[child] - tree.value[i];
        i = child;
      }
    }
    for (const n of Object.keys(forest)) forest[n] /= this.trees.length;
    const r = this.json.ridge;
    const ridge: Record<string, number> = {};
    r.features.forEach((name, j) => {
      ridge[name] =
        ((valueOf(features, name) - r.mean[j]) / r.scale[j]) * r.coef[j];
    });
    return {
      forestStart: forestStart / this.trees.length,
      ridgeStart: r.intercept,
      forest,
      ridge,
    };
  }

  /** log(units): the mean of the forest and the ridge, in log space. */
  predictLog(features: Record<string, number>): number {
    return (this.predictForest(features) + this.predictRidge(features)) / 2;
  }

  /** The estimate and its range for a log(units) prediction. */
  fromLog(log: number): MlPrediction {
    const units = Math.exp(log);
    return {
      units,
      low: units / this.halfWidthFactor,
      high: units * this.halfWidthFactor,
    };
  }

  predict(features: Record<string, number>): MlPrediction {
    return this.fromLog(this.predictLog(features));
  }
}

function valueOf(features: Record<string, number>, name: string): number {
  const v = features[name];
  if (v === undefined || !Number.isFinite(v)) {
    throw new Error(`ML feature "${name}" is missing or not finite`);
  }
  return v;
}

let model: EnsembleModel | null = null;

/** The production model, compiled once per process. */
export function ensembleModel(): EnsembleModel {
  model ??= new EnsembleModel(rawModel);
  return model;
}

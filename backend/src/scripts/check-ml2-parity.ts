import { readFileSync } from 'node:fs';
import { estimateV2, V2Basis } from '../estimation/ml2/v2-estimate';
import { buildV2Features, V2FeatureInput } from '../estimation/ml2/v2-features';
import {
  v2Model,
  v2SignalGroups,
  V2Features,
  V2Target,
} from '../estimation/ml2/v2-model';

/**
 * Parity of the TypeScript port with the lab, on every catalog game, as a
 * total and as a PC figure (`ml2/freeze.py --install` writes the file):
 *   1. reader: the lab's input columns give the lab's estimate and range
 *      (`ml2/frozen.py`);
 *   2. inputs: what the base holds on a game gives the lab's input columns
 *      (`ml2/features.py`), then the same estimate;
 *   3. rules: the model's answers, the console ratings and the game's own
 *      published figures give the estimate the lab keeps
 *      (`ml2/estimate_catalog.py`).
 *
 *   npx ts-node src/scripts/check-ml2-parity.ts ../ml2/data/<snapshot>/v2_parity.json
 */

type RawGame = Omit<
  V2FeatureInput,
  'asOf' | 'firstRelease' | 'releaseDates'
> & {
  asOf: number;
  firstRelease: number;
  releaseDates: Record<string, number | null>;
  /** What the rules after the model are given, and the estimate the lab keeps. */
  rules: {
    onPc: boolean;
    onPlaystation: boolean;
    onXbox: boolean;
    gamePass: boolean;
    bestPublished: number | null;
    anchor: {
      units: number;
      reportedAt: number;
      steamReviewsAtDate: number | null;
      reviewsReadThatDay: boolean;
      modelLogAtDate: number;
    } | null;
    expected: {
      basis: string;
      units: number | null;
      low: number | null;
      high: number | null;
    };
  };
};

/** The lab's wording of how a game is estimated. */
function labBasis(text: string): V2Basis {
  if (text.startsWith('ancré')) return 'anchored';
  if (text.startsWith('plancher')) return 'platform-floor';
  if (text.startsWith('non estimé')) return 'not-estimated';
  if (text === 'notes console') return 'consoles';
  return text === 'modèle' ? 'model' : 'model-raised-by-consoles';
}

interface ParityFile {
  version: string;
  columns: string[];
  rows: {
    gameId: string;
    /** Type of figure asked, and the one the model is given after its rule. */
    asked: V2Target;
    target: V2Target;
    x: (number | null)[];
    steamReviews: number | null;
    steamPeakPlayers: number | null;
    consoleRatings: number | null;
    expected: [number, number, number];
  }[];
  /** Per game: the raw values, with dates in milliseconds. */
  games: Record<string, RawGame>;
}

function toInput(raw: RawGame): V2FeatureInput {
  const date = (ms: number | null | undefined) =>
    ms === null || ms === undefined ? null : new Date(ms);
  const { rules, ...values } = raw;
  void rules;
  return {
    ...values,
    asOf: new Date(raw.asOf),
    firstRelease: new Date(raw.firstRelease),
    releaseDates: {
      PC: date(raw.releaseDates.PC),
      PLAYSTATION: date(raw.releaseDates.PLAYSTATION),
      XBOX: date(raw.releaseDates.XBOX),
    },
  };
}

function logGap(
  got: { units: number; low: number; high: number },
  expected: [number, number, number],
): number {
  return Math.max(
    Math.abs(Math.log(got.units / expected[0])),
    Math.abs(Math.log(got.low / expected[1])),
    Math.abs(Math.log(got.high / expected[2])),
  );
}

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error('usage: check-ml2-parity.ts <v2_parity.json>');
  const file = JSON.parse(readFileSync(path, 'utf8')) as ParityFile;
  if (file.version !== v2Model.version) {
    throw new Error(
      `file is ${file.version}, backend model is ${v2Model.version}`,
    );
  }
  const reader = { worst: 0, different: 0 };
  const inputs = { worst: 0, different: 0, columns: 0 };
  const badColumns = new Map<string, number>();
  for (const row of file.rows) {
    // 1. the reader, on the lab's own columns
    const features: V2Features = {};
    file.columns.forEach((name, i) => (features[name] = row.x[i]));
    const groups = v2SignalGroups(
      v2Model.json,
      row.steamReviews,
      row.steamPeakPlayers,
      row.consoleRatings,
    );
    const gap = logGap(
      v2Model.predict(features, row.steamReviews, row.target, groups),
      row.expected,
    );
    reader.worst = Math.max(reader.worst, gap);
    if (gap > 1e-9) reader.different += 1;

    // 2. the same row rebuilt from the raw values of the game
    const raw = toInput(file.games[row.gameId]);
    const built = buildV2Features(raw, row.asked, file.columns);
    let rowDiffers = built.target !== row.target;
    file.columns.forEach((name, i) => {
      const mine = built.features[name] ?? null;
      const theirs = row.x[i];
      const same =
        mine === null || theirs === null
          ? mine === theirs
          : Math.abs(mine - theirs) <= 1e-9 * Math.max(1, Math.abs(theirs));
      if (!same) {
        rowDiffers = true;
        badColumns.set(name, (badColumns.get(name) ?? 0) + 1);
      }
    });
    if (rowDiffers) inputs.columns += 1;
    const rebuiltGap = logGap(
      v2Model.predict(
        built.features,
        raw.steamReviews,
        built.target,
        v2SignalGroups(
          v2Model.json,
          raw.steamReviews,
          raw.steamPeakPlayers,
          (raw.psRatings ?? 0) + (raw.xboxRatings ?? 0),
        ),
      ),
      row.expected,
    );
    inputs.worst = Math.max(inputs.worst, rebuiltGap);
    if (rebuiltGap > 1e-9) inputs.different += 1;
  }

  // 3. the rules after the model, from the raw values of each game
  const rules = { worst: 0, different: 0, basis: 0 };
  const close = (a: number | null, b: number | null): number =>
    a === null || b === null
      ? a === b
        ? 0
        : Infinity
      : Math.abs(Math.log(a / b));
  for (const [gameId, rawGame] of Object.entries(file.games)) {
    const raw = toInput(rawGame);
    const ask = (target: V2Target) => {
      const built = buildV2Features(raw, target, file.columns);
      return v2Model.predict(
        built.features,
        raw.steamReviews,
        built.target,
        v2SignalGroups(
          v2Model.json,
          raw.steamReviews,
          raw.steamPeakPlayers,
          (raw.psRatings ?? 0) + (raw.xboxRatings ?? 0),
        ),
      );
    };
    const r = rawGame.rules;
    const got = estimateV2(v2Model.json, {
      asOf: raw.asOf,
      firstRelease: raw.firstRelease,
      model: ask('TOTAL'),
      modelPc: ask('PC').units,
      steamReviews: raw.steamReviews,
      onPc: r.onPc,
      onPlaystation: r.onPlaystation,
      onXbox: r.onXbox,
      psRatings: raw.psRatings,
      xboxRatings: raw.xboxRatings,
      gamePass: r.gamePass,
      anchor: r.anchor && {
        ...r.anchor,
        reportedAt: new Date(r.anchor.reportedAt),
      },
      bestPublished: r.bestPublished,
    });
    const gap = Math.max(
      close(got.units, r.expected.units),
      close(got.low, r.expected.low),
      close(got.high, r.expected.high),
    );
    if (got.basis !== labBasis(r.expected.basis)) {
      rules.basis += 1;
      if (rules.basis <= 5) {
        console.log(
          `  basis ${gameId}: backend ${got.basis} / lab ${r.expected.basis}`,
        );
      }
    }
    if (gap > 1e-9) {
      rules.different += 1;
      if (rules.different <= 5) {
        console.log(
          `  estimate ${gameId}: backend ${JSON.stringify([got.units, got.low, got.high])} / lab ${JSON.stringify(r.expected)}`,
        );
      }
    } else {
      rules.worst = Math.max(rules.worst, gap);
    }
  }
  console.log(`${file.rows.length} rows, model ${file.version}`);
  console.log(
    `reader: ${reader.different} estimates differ, largest gap ${reader.worst.toExponential(1)}`,
  );
  console.log(
    `inputs: ${inputs.columns} rows with a different column, ${inputs.different} estimates differ, largest gap ${inputs.worst.toExponential(1)}`,
  );
  for (const [name, count] of [...badColumns].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count} rows`);
  }
  console.log(
    `rules: ${Object.keys(file.games).length} games, ${rules.basis} with a different basis, ${rules.different} estimates differ, largest gap ${rules.worst.toExponential(1)}`,
  );
  if (
    reader.different > 0 ||
    inputs.different > 0 ||
    inputs.columns > 0 ||
    rules.different > 0 ||
    rules.basis > 0
  ) {
    process.exit(1);
  }
}

main();

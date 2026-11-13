import { readFileSync } from 'node:fs';
import dataSource from '../db/data-source';
import { V2FeatureInput } from '../estimation/ml2/v2-features';
import { loadV2Inputs, V2Query } from '../estimation/ml2/v2-inputs';
import { v2Model } from '../estimation/ml2/v2-model';

/**
 * Does the backend read in the base what the lab read? For every catalog
 * game of the lab's snapshot, `loadV2Inputs` is run at the snapshot's date
 * and compared, value by value, with the lab's raw values
 * (`ml2/freeze.py --install` writes them). Read-only.
 *
 * The base moved since the snapshot (figures added or rejected, game sheets
 * edited, release dates fixed): a few differences are expected, and the
 * report says where they are.
 *
 *   npx ts-node src/scripts/check-ml2-inputs.ts ../ml2/data/<snapshot>/v2_parity.json [--show 5]
 */

type RawGame = Record<string, unknown> & {
  asOf: number;
  firstRelease: number;
  releaseDates: Record<string, number | null>;
};

const BATCH = 200;

function flatten(input: V2FeatureInput): Record<string, unknown> {
  const { asOf, firstRelease, releaseDates, ...rest } = input;
  void asOf;
  return {
    ...rest,
    firstRelease: firstRelease.getTime(),
    releasePC: releaseDates.PC?.getTime() ?? null,
    releasePLAYSTATION: releaseDates.PLAYSTATION?.getTime() ?? null,
    releaseXBOX: releaseDates.XBOX?.getTime() ?? null,
  };
}

function flattenRaw(raw: RawGame): Record<string, unknown> {
  const { asOf, releaseDates, rules, ...rest } = raw;
  void asOf;
  void rules; // what the rules after the model are given: see check-ml2-estimates.ts
  return {
    ...rest,
    releasePC: releaseDates.PC ?? null,
    releasePLAYSTATION: releaseDates.PLAYSTATION ?? null,
    releaseXBOX: releaseDates.XBOX ?? null,
  };
}

function same(a: unknown, b: unknown): boolean {
  if (a === null || b === null || a === undefined || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = (list: unknown[]) => list.map(String).sort().join('|');
    return a.length === b.length && key(a) === key(b);
  }
  return a === b;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('usage: check-ml2-inputs.ts <v2_parity.json>');
  const showAt = process.argv.indexOf('--show');
  const show = showAt > 0 ? Number(process.argv[showAt + 1]) : 3;
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    games: Record<string, RawGame>;
  };
  const ids = Object.keys(file.games);
  const asOf = new Date(file.games[ids[0]].asOf);

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.query('SET default_transaction_read_only = on');
  // One connection, so one query at a time (the read-only setting is per connection).
  let queue: Promise<unknown> = Promise.resolve();
  const query: V2Query = <T>(sql: string, params: unknown[]) => {
    const next = queue.then(() => runner.query(sql, params) as Promise<T[]>);
    queue = next.catch(() => undefined);
    return next;
  };

  const started = Date.now();
  const got = new Map<string, V2FeatureInput>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = await loadV2Inputs(
      query,
      v2Model.json,
      ids.slice(i, i + BATCH),
      asOf,
    );
    for (const [id, input] of part) got.set(id, input);
  }
  const seconds = (Date.now() - started) / 1000;
  await runner.release();
  await dataSource.destroy();

  const fields = new Map<string, { count: number; examples: string[] }>();
  let gamesDiffering = 0;
  for (const id of ids) {
    const mine = got.get(id);
    if (!mine) {
      const f = fields.get('(game not returned)') ?? { count: 0, examples: [] };
      f.count += 1;
      if (f.examples.length < show) f.examples.push(id);
      fields.set('(game not returned)', f);
      gamesDiffering += 1;
      continue;
    }
    const a = flatten(mine);
    const b = flattenRaw(file.games[id]);
    let differs = false;
    for (const key of Object.keys(b)) {
      if (same(a[key], b[key])) continue;
      differs = true;
      const f = fields.get(key) ?? { count: 0, examples: [] };
      f.count += 1;
      if (f.examples.length < show) {
        f.examples.push(
          `${id}: backend ${JSON.stringify(a[key])} / lab ${JSON.stringify(b[key])}`,
        );
      }
      fields.set(key, f);
    }
    if (differs) gamesDiffering += 1;
  }
  console.log(
    `${ids.length} games at ${asOf.toISOString()}, read in ${seconds.toFixed(1)} s ` +
      `(${((seconds / ids.length) * 1000).toFixed(0)} ms per game in batches of ${BATCH})`,
  );
  console.log(
    `${ids.length - gamesDiffering} games identical, ${gamesDiffering} with at least one different value`,
  );
  for (const [key, f] of [...fields].sort((x, y) => y[1].count - x[1].count)) {
    console.log(`  ${key}: ${f.count} games`);
    for (const example of f.examples) console.log(`      ${example}`);
  }
}

void main();

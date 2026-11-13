import dataSource from '../db/data-source';
import { estimateV2Games } from '../estimation/ml2/v2-catalog';
import { V2Query } from '../estimation/ml2/v2-inputs';
import { v2Model } from '../estimation/ml2/v2-model';

/**
 * What the switch to the V2 estimate stores and shows, game by game, on the
 * base as it is now: the worldwide row a rebuild would write for every game
 * (an estimate, the "not estimated" mark, or nothing). Read-only: nothing is
 * written, no rebuild is run.
 *
 *   npx ts-node src/scripts/preview-ml2-switch.ts
 */

const BATCH = 200;

async function main(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.query('SET default_transaction_read_only = on');
  let queue: Promise<unknown> = Promise.resolve();
  const query: V2Query = <T>(sql: string, params: unknown[]) => {
    const next = queue.then(() => runner.query(sql, params) as Promise<T[]>);
    queue = next.catch(() => undefined);
    return next;
  };
  const games = await query<{ id: string }>(
    `SELECT id::text AS id FROM game WHERE "deletedAt" IS NULL ORDER BY id`,
    [],
  );
  const ids = games.map((g) => g.id);
  const now = new Date();
  const counts = new Map<string, number>();
  const count = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  let sum = 0;
  let invalid = 0;
  const started = Date.now();
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = await estimateV2Games(
      query,
      v2Model,
      ids.slice(i, i + BATCH),
      now,
    );
    for (const [, g] of part) {
      if (g.status === 'excluded') {
        count('row stored: "not estimated" (excluded by hand)');
      } else if (g.status !== 'estimated') {
        count(`no row: ${g.status} (the site already handles it)`);
      } else if (!g.estimate || g.estimate.units === null) {
        count('row stored: "not estimated" (no signal)');
      } else {
        const { units, low, high, basis } = g.estimate;
        count(`row stored: estimate (${basis})`);
        sum += units;
        const ok =
          Number.isFinite(units) &&
          low !== null &&
          high !== null &&
          low > 0 &&
          low <= units * (1 + 1e-9) &&
          units <= high * (1 + 1e-9) &&
          high < 2_147_483_647;
        if (!ok) {
          invalid += 1;
          console.log('  invalid:', basis, units, low, high);
        }
      }
    }
  }
  await runner.release();
  await dataSource.destroy();
  console.log(
    `${ids.length} games, model ${v2Model.version}, at ${now.toISOString()} ` +
      `(${((Date.now() - started) / 1000).toFixed(0)} s)`,
  );
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${key}`);
  }
  console.log(
    `sum of the estimates: ${(sum / 1e9).toFixed(2)} billion; estimates with an invalid range: ${invalid}`,
  );
}

void main();

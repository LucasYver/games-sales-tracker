import { readFileSync } from 'node:fs';
import dataSource from '../db/data-source';
import { estimateV2Games, V2GameEstimate } from '../estimation/ml2/v2-catalog';
import { V2Basis } from '../estimation/ml2/v2-estimate';
import { V2Query } from '../estimation/ml2/v2-inputs';
import { v2Model } from '../estimation/ml2/v2-model';

/**
 * The whole V2 chain on the base, against the lab's catalog: for every game
 * of the lab's snapshot, `estimateV2Games` is run at the snapshot's date and
 * its basis, estimate and range are compared with what the lab kept
 * (`ml2/freeze.py --install` writes them). Read-only.
 *
 * The base moved since the snapshot (the day's readings, figures rejected or
 * edited, game sheets): the report sorts the differences by size and by what
 * the rules were given.
 *
 *   npx ts-node src/scripts/check-ml2-estimates.ts ../ml2/data/<snapshot>/v2_parity.json [--show 5]
 */

interface LabGame {
  asOf: number;
  rules: {
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
}

const BATCH = 200;

function labBasis(text: string): V2Basis {
  if (text.startsWith('ancré')) return 'anchored';
  if (text.startsWith('plancher')) return 'platform-floor';
  if (text.startsWith('non estimé')) return 'not-estimated';
  if (text === 'notes console') return 'consoles';
  return text === 'modèle' ? 'model' : 'model-raised-by-consoles';
}

const near = (
  a: number | null,
  b: number | null,
  tolerance: number,
): boolean =>
  a === null || b === null
    ? a === b
    : Math.abs(Math.log(a / b)) <= tolerance || (a === 0 && b === 0);

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('usage: check-ml2-estimates.ts <v2_parity.json>');
  const showAt = process.argv.indexOf('--show');
  const show = showAt > 0 ? Number(process.argv[showAt + 1]) : 3;
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    games: Record<string, LabGame>;
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
  const got = new Map<string, V2GameEstimate>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = await estimateV2Games(
      query,
      v2Model,
      ids.slice(i, i + BATCH),
      asOf,
    );
    for (const [id, estimate] of part) got.set(id, estimate);
  }
  const seconds = (Date.now() - started) / 1000;
  await runner.release();
  await dataSource.destroy();

  const issues = new Map<string, string[]>();
  const note = (kind: string, text: string) =>
    issues.set(kind, [...(issues.get(kind) ?? []), text]);
  let identical = 0;
  let within1 = 0;
  let within10 = 0;
  for (const id of ids) {
    const lab = file.games[id].rules;
    const mine = got.get(id);
    if (!mine || mine.status !== 'estimated' || !mine.estimate) {
      note('status', `${id}: backend ${mine?.status ?? 'not returned'}`);
      continue;
    }
    const e = mine.estimate;
    const expected = lab.expected;
    const sameBasis = e.basis === labBasis(expected.basis);
    if (!sameBasis) {
      note('basis', `${id}: backend ${e.basis} / lab ${expected.basis}`);
    }
    // What the rules were given: the game's own figures.
    if (!near(mine.bestPublished, lab.bestPublished, 1e-9)) {
      note(
        'best published figure',
        `${id}: backend ${mine.bestPublished} / lab ${lab.bestPublished}`,
      );
    }
    const a = mine.anchor;
    const b = lab.anchor;
    if ((a === null) !== (b === null)) {
      note(
        'anchor present',
        `${id}: backend ${a?.units ?? null} / lab ${b?.units ?? null}`,
      );
    } else if (a && b) {
      if (a.units !== b.units || a.reportedAt.getTime() !== b.reportedAt) {
        note(
          'anchor figure',
          `${id}: backend ${a.units} on ${a.reportedAt.toISOString()} / lab ${b.units} on ${new Date(b.reportedAt).toISOString()}`,
        );
      } else {
        if (!near(a.steamReviewsAtDate, b.steamReviewsAtDate, 1e-6)) {
          note(
            'reviews at the anchor date',
            `${id}: backend ${a.steamReviewsAtDate} / lab ${b.steamReviewsAtDate}`,
          );
        }
        if (a.reviewsReadThatDay !== b.reviewsReadThatDay) {
          note('anchor reviews read that day', id);
        }
        if (Math.abs(a.modelLogAtDate - b.modelLogAtDate) > 1e-6) {
          note(
            'model at the anchor date',
            `${id}: backend ${Math.exp(a.modelLogAtDate).toFixed(0)} / lab ${Math.exp(b.modelLogAtDate).toFixed(0)}`,
          );
        }
      }
    }
    const all = (tolerance: number) =>
      sameBasis &&
      near(e.units, expected.units, tolerance) &&
      near(e.low, expected.low, tolerance) &&
      near(e.high, expected.high, tolerance);
    if (all(1e-9)) identical += 1;
    if (all(0.01)) within1 += 1;
    if (all(0.1)) within10 += 1;
    else {
      note(
        'estimate off by more than 10 %',
        `${id}: backend ${e.basis} ${e.units?.toFixed(0)} / lab ${expected.basis} ${expected.units?.toFixed(0)}`,
      );
    }
  }
  console.log(
    `${ids.length} games at ${asOf.toISOString()}, estimated in ${seconds.toFixed(1)} s ` +
      `(${((seconds / ids.length) * 1000).toFixed(0)} ms per game in batches of ${BATCH})`,
  );
  console.log(
    `same basis, estimate and range: identical ${identical}, within 1 % ${within1}, within 10 % ${within10}`,
  );
  for (const [kind, list] of [...issues].sort(
    (x, y) => y[1].length - x[1].length,
  )) {
    console.log(`  ${kind}: ${list.length} games`);
    for (const text of list.slice(0, show)) console.log(`      ${text}`);
  }
}

void main();

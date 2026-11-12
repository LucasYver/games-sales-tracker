/**
 * The Modern Warfare 4 sales page. Activision publishes no unit counts, and
 * the Call of Duty HQ launcher hides the players and the PlayStation ratings
 * of each title (see `game.estimateHidden`), so the page compares what still
 * measures one game alone: the Steam reviews of its own store page, against
 * the previous HQ games at the same age.
 *
 * Benchmarks are the HQ games whose page kept counting through launch:
 * - MW III is left out: its page no longer counts reviews (total near 0).
 * - MW II is left out: our review history starts ten months after launch.
 * - BO6's page stopped counting in 2026; its curve ends there (backend).
 */

export const MW4_SLUG = 'call-of-duty-modern-warfare-4';
export const MW4_PATH = '/mw4-sales';

export interface Mw4Benchmark {
  key: 'bo7' | 'bo6';
  label: string;
  name: string;
  slug: string;
}

export const MW4_BENCHMARKS: Mw4Benchmark[] = [
  {
    key: 'bo7',
    label: 'BO7',
    name: 'Call of Duty: Black Ops 7',
    slug: 'call-of-duty-black-ops-7',
  },
  {
    key: 'bo6',
    label: 'BO6',
    name: 'Call of Duty: Black Ops 6',
    slug: 'call-of-duty-black-ops-6',
  },
];

type Point = { day: number; reviews: number };

/** Last point at or before `day`, or null. Points are sorted by day. */
export function pointAtOrBefore(points: Point[], day: number): Point | null {
  let found: Point | null = null;
  for (const p of points) {
    if (p.day > day) break;
    found = p;
  }
  return found;
}

/**
 * MW4 against one benchmark at the same age: the benchmark's latest point no
 * older than MW4 today, and MW4's latest point no later than that day. Both
 * are real measurements with their own day, so nothing is interpolated.
 */
export function sameAgeComparison(
  mw4: Point[],
  benchmark: Point[],
): { mw4: Point; benchmark: Point; ratio: number } | null {
  const age = mw4.at(-1)?.day;
  if (age == null) return null;
  const b = pointAtOrBefore(benchmark, age);
  if (!b || b.reviews <= 0) return null;
  const m = pointAtOrBefore(mw4, b.day);
  if (!m) return null;
  return { mw4: m, benchmark: b, ratio: m.reviews / b.reviews };
}

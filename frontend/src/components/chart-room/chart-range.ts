import type { ReviewPoint } from '@/lib/api';

export const CHART_RANGES = [
  { key: '48h', days: 2 },
  { key: '1w', days: 7 },
  { key: '1m', days: 30 },
  { key: '3m', days: 90 },
  { key: '1y', days: 365 },
  { key: '3y', days: 365 * 3 },
  { key: 'all', days: null },
] as const;

export type ChartRangeKey = (typeof CHART_RANGES)[number]['key'];

export type ChartAggregation = 'none' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Window measured back from the series' own last point, not wall-clock time,
 * so a stale series still has a readable "last week".
 */
export function windowedPoints(
  points: ReviewPoint[],
  days: number | null,
): ReviewPoint[] {
  if (!days || points.length === 0) return points;
  const last = new Date(points[points.length - 1].capturedAt).getTime();
  const cutoff = last - days * DAY_MS;
  return points.filter((p) => new Date(p.capturedAt).getTime() >= cutoff);
}

/** 1y → weekly buckets; 3y / all → monthly; shorter ranges stay raw. */
export function aggregationForRange(key: ChartRangeKey): ChartAggregation {
  if (key === '1y') return 'week';
  if (key === '3y' || key === 'all') return 'month';
  return 'none';
}

function weekBucketKey(d: Date): string {
  // UTC calendar week starting Monday (ISO-like).
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7; // Mon=1 … Sun=7
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return `w-${utc.toISOString().slice(0, 10)}`;
}

function monthBucketKey(d: Date): string {
  return `m-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type BucketPick = 'peak' | 'end';

/**
 * Collapse a window to one point per week/month.
 * - peak: highest value in the bucket (CCU / Twitch)
 * - end: last observation in the bucket (cumulative reviews / ratings / followers)
 */
export function aggregatePoints(
  points: ReviewPoint[],
  mode: ChartAggregation,
  pick: BucketPick = 'peak',
): ReviewPoint[] {
  if (mode === 'none' || points.length === 0) return points;

  const keyOf = mode === 'week' ? weekBucketKey : monthBucketKey;
  const best = new Map<string, ReviewPoint>();

  for (const p of points) {
    const d = new Date(p.capturedAt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = keyOf(d);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, p);
      continue;
    }
    const pT = d.getTime();
    const prevT = new Date(prev.capturedAt).getTime();
    const better =
      pick === 'end'
        ? pT > prevT
        : p.value > prev.value || (p.value === prev.value && pT > prevT);
    if (better) best.set(key, p);
  }

  return Array.from(best.values()).sort(
    (a, b) =>
      new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
}

/** Window + optional week/month aggregation for a range key. */
export function prepareRangePoints(
  points: ReviewPoint[],
  rangeKey: ChartRangeKey,
  options?: { cumulative?: boolean },
): ReviewPoint[] {
  const days = CHART_RANGES.find((r) => r.key === rangeKey)?.days ?? null;
  const pick: BucketPick = options?.cumulative ? 'end' : 'peak';
  return aggregatePoints(
    windowedPoints(points, days),
    aggregationForRange(rangeKey),
    pick,
  );
}

export function rangeHasEnoughPoints(
  points: ReviewPoint[],
  days: number | null,
): boolean {
  return windowedPoints(points, days).length > 1;
}

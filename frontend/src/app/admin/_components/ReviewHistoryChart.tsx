'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import type { AdminCcuPoint } from '@/lib/admin';

interface Props {
  reviewHistory: AdminCcuPoint[];
  // Optional reconstructed (synthetic) series drawn as a dashed overlay, e.g.
  // the rebuilt PS ratings curve filling the pre-measurement gap.
  syntheticHistory?: AdminCcuPoint[];
}

type RangeKey = '1m' | '3m' | '6m' | '1y' | 'max';

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'max', label: 'Max', days: null },
];

// Above this visible span the daily series is collapsed to one point per
// month (the month's last value), since reviews are cumulative and we
// want to keep the end-of-month state.
const MONTHLY_AGGREGATION_THRESHOLD_DAYS = 270;
const DAY_MS = 24 * 3600 * 1000;

const chartConfig: ChartConfig = {
  current: {
    label: 'Reviews',
    color: 'var(--chart-2)',
  },
  synthetic: {
    label: 'Reconstructed',
    color: 'var(--chart-4)',
  },
};

function formatReviews(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toString();
}

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

interface ChartPoint {
  t: number;
  current?: number;
  synthetic?: number;
}

// Reduce a cumulative series to end-of-month points when the visible span is
// wide (reviews are cumulative, so the month's last value is the right one).
function aggregateMonthly<T extends { t: number }>(points: T[]): T[] {
  const byMonth = new Map<string, T>();
  for (const p of points) {
    const d = new Date(p.t);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const existing = byMonth.get(key);
    if (!existing || p.t > existing.t) byMonth.set(key, p);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.t - b.t);
}

export function ReviewHistoryChart({ reviewHistory, syntheticHistory }: Props) {
  const [range, setRange] = useState<RangeKey>('max');

  const realPoints = useMemo(
    () =>
      reviewHistory
        .map((s) => ({ t: new Date(s.capturedAt).getTime(), value: s.value }))
        .sort((a, b) => a.t - b.t),
    [reviewHistory],
  );

  const synthPoints = useMemo(
    () =>
      (syntheticHistory ?? [])
        .map((s) => ({ t: new Date(s.capturedAt).getTime(), value: s.value }))
        .sort((a, b) => a.t - b.t),
    [syntheticHistory],
  );

  const { data, aggregated } = useMemo(() => {
    const union = [...realPoints.map((p) => p.t), ...synthPoints.map((p) => p.t)];
    if (union.length === 0)
      return { data: [] as ChartPoint[], aggregated: false };

    const lastT = Math.max(...union);
    const cfg = RANGES.find((r) => r.key === range) ?? RANGES[RANGES.length - 1];
    const cutoff = cfg.days === null ? -Infinity : lastT - cfg.days * DAY_MS;

    let real = realPoints.filter((p) => p.t >= cutoff);
    let synth = synthPoints.filter((p) => p.t >= cutoff);
    const windowedTs = [...real.map((p) => p.t), ...synth.map((p) => p.t)];
    if (windowedTs.length === 0)
      return { data: [] as ChartPoint[], aggregated: false };

    const spanDays =
      (Math.max(...windowedTs) - Math.min(...windowedTs)) / DAY_MS;
    const doAggregate = spanDays > MONTHLY_AGGREGATION_THRESHOLD_DAYS;
    if (doAggregate) {
      real = aggregateMonthly(real);
      synth = aggregateMonthly(synth);
    }

    // Merge both series into one dataset keyed by timestamp so recharts can
    // draw the real (solid) and reconstructed (dashed) lines together.
    const byT = new Map<number, ChartPoint>();
    for (const p of real) {
      byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), current: p.value });
    }
    for (const p of synth) {
      byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), synthetic: p.value });
    }
    return {
      data: Array.from(byT.values()).sort((a, b) => a.t - b.t),
      aggregated: doAggregate,
    };
  }, [realPoints, synthPoints, range]);

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        No snapshots yet. They will be captured on the next refresh.
      </p>
    );
  }

  if (data.length === 1) {
    const only = data[0];
    const onlyValue = only.current ?? only.synthetic ?? 0;
    return (
      <div className="text-muted-foreground p-6 text-sm">
        Only one snapshot so far ({onlyValue.toLocaleString()} on{' '}
        {formatDay(only.t)}). The chart will appear after the next refresh.
      </div>
    );
  }

  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];
  const yMax =
    Math.max(...data.flatMap((d) => [d.current ?? 0, d.synthetic ?? 0])) * 1.1 ||
    undefined;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-2 px-6 pt-2">
        {aggregated && (
          <span className="text-muted-foreground mr-auto text-xs">
            End-of-month total
          </span>
        )}
        {RANGES.map((r) => (
          <Button
            key={r.key}
            type="button"
            size="sm"
            variant={range === r.key ? 'default' : 'ghost'}
            className="h-7 px-2 text-xs"
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      <ChartContainer
        config={chartConfig}
        className="h-[280px] w-full px-6 pb-4"
      >
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={xDomain}
            scale="time"
            tickFormatter={formatDay}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={formatReviews}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, yMax ?? 'auto']}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const t = payload?.[0]?.payload?.t;
                  return typeof t === 'number'
                    ? new Date(t).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : '';
                }}
                formatter={(value, name) => {
                  if (name === 'current') {
                    return [
                      formatReviews(value as number),
                      aggregated ? 'Reviews (end of month)' : 'Reviews',
                    ];
                  }
                  if (name === 'synthetic') {
                    return [formatReviews(value as number), 'Reconstructed'];
                  }
                  return null;
                }}
              />
            }
          />
          <Line
            dataKey="synthetic"
            type="monotone"
            stroke="var(--color-synthetic)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="current"
            type="monotone"
            stroke="var(--color-current)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

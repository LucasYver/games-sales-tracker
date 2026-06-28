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
  current: number;
}

export function ReviewHistoryChart({ reviewHistory }: Props) {
  const [range, setRange] = useState<RangeKey>('max');

  const allPoints = useMemo<ChartPoint[]>(
    () =>
      reviewHistory
        .map((s) => ({
          t: new Date(s.capturedAt).getTime(),
          current: s.value,
        }))
        .sort((a, b) => a.t - b.t),
    [reviewHistory],
  );

  const { data, aggregated } = useMemo(() => {
    if (allPoints.length === 0)
      return { data: [] as ChartPoint[], aggregated: false };

    const lastT = allPoints[allPoints.length - 1].t;
    const cfg = RANGES.find((r) => r.key === range) ?? RANGES[RANGES.length - 1];
    const cutoff = cfg.days === null ? -Infinity : lastT - cfg.days * DAY_MS;
    const windowed = allPoints.filter((p) => p.t >= cutoff);
    if (windowed.length === 0)
      return { data: [] as ChartPoint[], aggregated: false };

    const spanDays =
      (windowed[windowed.length - 1].t - windowed[0].t) / DAY_MS;
    if (spanDays <= MONTHLY_AGGREGATION_THRESHOLD_DAYS) {
      return { data: windowed, aggregated: false };
    }

    // Reviews are cumulative: keep the last point of each UTC month so the
    // line still represents the running total at end of month.
    const byMonth = new Map<string, ChartPoint>();
    for (const p of windowed) {
      const d = new Date(p.t);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const existing = byMonth.get(key);
      if (!existing || p.t > existing.t) byMonth.set(key, p);
    }
    return {
      data: Array.from(byMonth.values()).sort((a, b) => a.t - b.t),
      aggregated: true,
    };
  }, [allPoints, range]);

  if (allPoints.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        No Steam review snapshots yet. They will be captured on the next
        refresh (the daily cron polls Steam&apos;s appreviews endpoint for
        every tracked Steam app).
      </p>
    );
  }

  if (allPoints.length === 1) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        Only one Steam review snapshot so far (
        {allPoints[0].current.toLocaleString()} on {formatDay(allPoints[0].t)}
        ). The chart will appear after the next refresh.
      </div>
    );
  }

  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];
  const yMax = Math.max(...data.map((d) => d.current)) * 1.1 || undefined;

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
                  return null;
                }}
              />
            }
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

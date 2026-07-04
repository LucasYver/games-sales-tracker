'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import type { AdminCcuPoint } from '@/lib/admin';

interface Props {
  topSellerRankHistory: AdminCcuPoint[];
}

type RangeKey = '1m' | '3m' | '6m' | '1y' | 'max';

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'max', label: 'Max', days: null },
];

// Above this visible span the daily series is collapsed to one point per month
// (the month's BEST/lowest rank), since rank is a "lower is better" position.
const MONTHLY_AGGREGATION_THRESHOLD_DAYS = 270;
const DAY_MS = 24 * 3600 * 1000;
// The series is sparse (charted days only). Break the line across gaps longer
// than this so we don't draw a misleading segment over periods the game was
// off the chart.
const DAILY_GAP_BREAK_DAYS = 10;
const MONTHLY_GAP_BREAK_DAYS = 45;

const chartConfig: ChartConfig = {
  current: {
    label: 'Top-seller rank',
    color: 'var(--chart-5)',
  },
};

function formatRank(value: number): string {
  return `#${value}`;
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
  current: number | null;
}

export function TopSellerRankChart({ topSellerRankHistory }: Props) {
  const [range, setRange] = useState<RangeKey>('max');

  const allPoints = useMemo(
    () =>
      topSellerRankHistory
        .map((s) => ({ t: new Date(s.capturedAt).getTime(), current: s.value }))
        .sort((a, b) => a.t - b.t),
    [topSellerRankHistory],
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

    let points: { t: number; current: number }[];
    let isAggregated: boolean;
    if (spanDays <= MONTHLY_AGGREGATION_THRESHOLD_DAYS) {
      points = windowed;
      isAggregated = false;
    } else {
      // Keep the best (lowest) rank of each UTC month.
      const byMonth = new Map<string, { t: number; current: number }>();
      for (const p of windowed) {
        const d = new Date(p.t);
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        const existing = byMonth.get(key);
        if (!existing || p.current < existing.current) byMonth.set(key, p);
      }
      points = Array.from(byMonth.values()).sort((a, b) => a.t - b.t);
      isAggregated = true;
    }

    // Insert a null break wherever consecutive charted points are far apart, so
    // the line does not span off-chart gaps.
    const gapMs =
      (isAggregated ? MONTHLY_GAP_BREAK_DAYS : DAILY_GAP_BREAK_DAYS) * DAY_MS;
    const withGaps: ChartPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0 && points[i].t - points[i - 1].t > gapMs) {
        withGaps.push({ t: points[i - 1].t + 1, current: null });
      }
      withGaps.push(points[i]);
    }

    return { data: withGaps, aggregated: isAggregated };
  }, [allPoints, range]);

  if (allPoints.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        This game has never appeared in Steam&apos;s top-seller chart (tracked
        from games-popularity.com since ~2024-03), or the rank backfill
        hasn&apos;t run yet.
      </p>
    );
  }

  if (allPoints.length === 1) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        Charted only once so far (#{allPoints[0].current} on{' '}
        {formatDay(allPoints[0].t)}). The chart will appear once more charted
        days are captured.
      </div>
    );
  }

  const realValues = data
    .map((d) => d.current)
    .filter((v): v is number => v !== null);
  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];
  // Reversed axis: #1 sits at the top. Give a little headroom below the worst
  // observed rank.
  const yMax = Math.ceil((Math.max(...realValues) || 1) * 1.1);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-2 px-6 pt-2">
        <span className="text-muted-foreground mr-auto text-xs">
          {aggregated ? 'Best rank / month · ' : ''}Lower is better (#1 = top)
        </span>
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
            reversed
            tickFormatter={formatRank}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[1, yMax]}
            allowDecimals={false}
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
                  if (name === 'current' && value != null) {
                    return [
                      formatRank(value as number),
                      aggregated ? 'Best rank (month)' : 'Top-seller rank',
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
            dot={{ r: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

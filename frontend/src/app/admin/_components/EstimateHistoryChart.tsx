'use client';

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { AdminEstimateSnapshot } from '@/lib/admin';

interface Props {
  snapshots: AdminEstimateSnapshot[];
}

const chartConfig: ChartConfig = {
  range: {
    label: 'Estimated range',
    color: 'var(--chart-1)',
  },
  mid: {
    label: 'Midpoint',
    color: 'var(--chart-1)',
  },
};

function formatUnits(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toString();
}

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function EstimateHistoryChart({ snapshots }: Props) {
  const data = useMemo(
    () =>
      snapshots.map((s) => ({
        t: new Date(s.computedAt).getTime(),
        low: s.estimatedTodayLow,
        high: s.estimatedTodayHigh,
        mid: Math.round(
          (s.estimatedTodayLow + s.estimatedTodayHigh) / 2,
        ),
        range: [s.estimatedTodayLow, s.estimatedTodayHigh] as [number, number],
      })),
    [snapshots],
  );

  if (data.length < 2) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        Need at least 2 estimate snapshots to draw a chart (currently{' '}
        {data.length}). Trigger a few refreshes or rebuild the history.
      </p>
    );
  }

  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];

  return (
    <ChartContainer config={chartConfig} className="h-[280px] w-full px-6 pb-4">
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
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
          tickFormatter={formatUnits}
          tickLine={false}
          axisLine={false}
          width={48}
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
              formatter={(value, name, item) => {
                if (name === 'range') {
                  const [lo, hi] = item.payload.range as [number, number];
                  return [
                    `${formatUnits(lo)} – ${formatUnits(hi)}`,
                    'Estimated range',
                  ];
                }
                if (name === 'mid') {
                  return [formatUnits(value as number), 'Midpoint'];
                }
                return null;
              }}
            />
          }
        />
        <Area
          dataKey="range"
          type="monotone"
          stroke="none"
          fill="var(--color-range)"
          fillOpacity={0.25}
          isAnimationActive={false}
        />
        <Area
          dataKey="mid"
          type="monotone"
          stroke="var(--color-mid)"
          strokeWidth={2}
          fill="transparent"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

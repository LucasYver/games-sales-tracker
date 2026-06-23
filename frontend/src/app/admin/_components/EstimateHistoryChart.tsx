'use client';

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { Platform } from '@/lib/api';
import type { AdminEstimateSnapshot } from '@/lib/admin';

interface Props {
  snapshots: AdminEstimateSnapshot[];
}

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  PC: 'PC',
  PLAYSTATION: 'PlayStation',
  XBOX: 'Xbox',
  SWITCH: 'Switch',
  GLOBAL: 'Global',
};

const PLATFORM_COLORS: Partial<Record<Platform, string>> = {
  PC: 'var(--chart-2)',
  PLAYSTATION: 'var(--chart-3)',
  XBOX: 'var(--chart-4)',
  SWITCH: 'var(--chart-5)',
};

const chartConfig: ChartConfig = {
  range: {
    label: 'Estimated range',
    color: 'var(--chart-1)',
  },
  mid: {
    label: 'Midpoint',
    color: 'var(--chart-1)',
  },
  pcMid: { label: 'PC', color: PLATFORM_COLORS.PC! },
  playstationMid: {
    label: 'PlayStation',
    color: PLATFORM_COLORS.PLAYSTATION!,
  },
  xboxMid: { label: 'Xbox', color: PLATFORM_COLORS.XBOX! },
  switchMid: { label: 'Switch', color: PLATFORM_COLORS.SWITCH! },
};

const PLATFORM_DATA_KEY: Partial<Record<Platform, string>> = {
  PC: 'pcMid',
  PLAYSTATION: 'playstationMid',
  XBOX: 'xboxMid',
  SWITCH: 'switchMid',
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

interface ChartPoint {
  t: number;
  low: number;
  high: number;
  mid: number;
  range: [number, number];
  pcMid?: number;
  playstationMid?: number;
  xboxMid?: number;
  switchMid?: number;
}

export function EstimateHistoryChart({ snapshots }: Props) {
  const { data, presentPlatforms } = useMemo(() => {
    const platforms = new Set<Platform>();
    const points: ChartPoint[] = snapshots.map((s) => {
      const point: ChartPoint = {
        t: new Date(s.computedAt).getTime(),
        low: s.estimatedTodayLow,
        high: s.estimatedTodayHigh,
        mid: Math.round((s.estimatedTodayLow + s.estimatedTodayHigh) / 2),
        range: [s.estimatedTodayLow, s.estimatedTodayHigh],
      };
      for (const r of s.reconciliation) {
        const key = PLATFORM_DATA_KEY[r.platform];
        if (!key) continue;
        platforms.add(r.platform);
        (point as unknown as Record<string, number | undefined>)[key] =
          Math.round((r.estimateLow + r.estimateHigh) / 2);
      }
      return point;
    });
    return { data: points, presentPlatforms: platforms };
  }, [snapshots]);

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
      <ComposedChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
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
                  return [formatUnits(value as number), 'Headline midpoint'];
                }
                for (const [platform, key] of Object.entries(
                  PLATFORM_DATA_KEY,
                )) {
                  if (name === key) {
                    return [
                      formatUnits(value as number),
                      PLATFORM_LABELS[platform as Platform] ?? platform,
                    ];
                  }
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
          fillOpacity={0.18}
          isAnimationActive={false}
        />
        <Line
          dataKey="mid"
          type="monotone"
          stroke="var(--color-mid)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {(Object.keys(PLATFORM_DATA_KEY) as Platform[])
          .filter((p) => presentPlatforms.has(p))
          .map((p) => (
            <Line
              key={p}
              dataKey={PLATFORM_DATA_KEY[p]!}
              type="monotone"
              stroke={PLATFORM_COLORS[p]!}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
      </ComposedChart>
    </ChartContainer>
  );
}

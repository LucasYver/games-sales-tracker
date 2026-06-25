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
  ChartLegend,
  ChartLegendContent,
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

// Explicit, distinct hues instead of the theme's monochrome --chart-*
// palette (all grey, chroma 0), which made every line hard to tell apart.
const RECONCILED_COLOR = 'oklch(0.55 0.2 255)'; // blue
const PURE_ALGO_COLOR = 'oklch(0.72 0.17 60)'; // amber

const PLATFORM_COLORS: Partial<Record<Platform, string>> = {
  PC: 'oklch(0.6 0.16 150)', // green
  PLAYSTATION: 'oklch(0.55 0.2 290)', // violet
  XBOX: 'oklch(0.62 0.13 195)', // teal
  SWITCH: 'oklch(0.58 0.21 18)', // red
};

const chartConfig: ChartConfig = {
  range: {
    label: 'Estimated range (low–high)',
    color: RECONCILED_COLOR,
  },
  mid: {
    label: 'Reconciled estimate',
    color: RECONCILED_COLOR,
  },
  pureMid: {
    label: 'Pure algo (no declared figures)',
    color: PURE_ALGO_COLOR,
  },
  pcMid: { label: 'PC (per-platform)', color: PLATFORM_COLORS.PC! },
  playstationMid: {
    label: 'PlayStation (per-platform)',
    color: PLATFORM_COLORS.PLAYSTATION!,
  },
  xboxMid: { label: 'Xbox (per-platform)', color: PLATFORM_COLORS.XBOX! },
  switchMid: { label: 'Switch (per-platform)', color: PLATFORM_COLORS.SWITCH! },
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

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((s) => s >= normalized);
  return (step ?? 10) * magnitude;
}

interface ChartPoint {
  t: number;
  low: number;
  high: number;
  mid: number;
  range: [number, number];
  pureMid?: number;
  pcMid?: number;
  playstationMid?: number;
  xboxMid?: number;
  switchMid?: number;
}

export function EstimateHistoryChart({ snapshots }: Props) {
  const { data, presentPlatforms, hasPure, yMax } = useMemo(() => {
    const platforms = new Set<Platform>();
    let pure = false;
    let maxValue = 0;
    const points: ChartPoint[] = snapshots.map((s) => {
      const point: ChartPoint = {
        t: new Date(s.computedAt).getTime(),
        low: s.estimatedTodayLow,
        high: s.estimatedTodayHigh,
        mid: Math.round((s.estimatedTodayLow + s.estimatedTodayHigh) / 2),
        range: [s.estimatedTodayLow, s.estimatedTodayHigh],
      };
      if (
        s.pureEstimatedTodayLow !== null &&
        s.pureEstimatedTodayHigh !== null
      ) {
        point.pureMid = Math.round(
          (s.pureEstimatedTodayLow + s.pureEstimatedTodayHigh) / 2,
        );
        pure = true;
      }
      for (const r of s.reconciliation) {
        const key = PLATFORM_DATA_KEY[r.platform];
        if (!key) continue;
        platforms.add(r.platform);
        (point as unknown as Record<string, number | undefined>)[key] =
          Math.round((r.estimateLow + r.estimateHigh) / 2);
      }
      maxValue = Math.max(maxValue, point.high);
      return point;
    });
    return {
      data: points,
      presentPlatforms: platforms,
      hasPure: pure,
      yMax: niceCeiling(maxValue),
    };
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
          domain={[0, yMax]}
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
                  return [formatUnits(value as number), 'Reconciled mid'];
                }
                if (name === 'pureMid') {
                  return [formatUnits(value as number), 'Pure algo mid'];
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
        <ChartLegend
          content={<ChartLegendContent className="flex-wrap" />}
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
        {hasPure && (
          <Line
            dataKey="pureMid"
            type="monotone"
            stroke="var(--color-pureMid)"
            strokeWidth={1.5}
            strokeDasharray="2 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
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

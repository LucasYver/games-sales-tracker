'use client';

import { useFormatter } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReviewPoint } from '@/lib/api';
import { downsample } from '@/lib/chart';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export type SeriesKind = 'count' | 'money';

export interface ChartSeries {
  key: string;
  label: string;
  points: ReviewPoint[];
}

const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

function buildChartConfig(series: ChartSeries[]): ChartConfig {
  const config: ChartConfig = {};
  series.forEach((s, i) => {
    config[s.key] = {
      label: s.label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
    };
  });
  return config;
}

/**
 * Measured series over time (reviews, CCU, price…). Money uses step curves:
 * a price holds until the next observation. Multiple series share one area chart.
 */
export function SeriesChart({
  series,
  ariaLabel,
  kind = 'count',
  currency = 'USD',
  animationKey,
}: {
  series: ChartSeries[];
  ariaLabel: string;
  kind?: SeriesKind;
  currency?: string;
  /** Change this to replay the enter animation (range / series switch). */
  animationKey?: string;
}) {
  const format = useFormatter();

  const prepared = series
    .map((s) => ({
      ...s,
      samples: downsample(
        s.points
          .map((p) => ({
            t: new Date(p.capturedAt).getTime(),
            value: p.value,
          }))
          .filter((p) => Number.isFinite(p.t) && p.value > 0)
          .sort((a, b) => a.t - b.t),
      ),
    }))
    .filter((s) => s.samples.length > 1);

  if (prepared.length === 0) return null;

  const chartConfig = buildChartConfig(prepared);

  const byT = new Map<number, Record<string, number>>();
  for (const s of prepared) {
    for (const p of s.samples) {
      const row = byT.get(p.t) ?? { t: p.t };
      row[s.key] = p.value;
      byT.set(p.t, row);
    }
  }
  const data = Array.from(byT.values()).sort(
    (a, b) => (a.t as number) - (b.t as number),
  );

  const tMin = data[0].t as number;
  const tMax = data[data.length - 1].t as number;
  const xDomain: [number, number] = [tMin, tMax];

  const value = (n: number) =>
    kind === 'money'
      ? format.number(n / 100, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        })
      : format.number(n, { notation: 'compact', maximumFractionDigits: 1 });

  const exactValue = (n: number) =>
    kind === 'money'
      ? format.number(n / 100, { style: 'currency', currency })
      : format.number(n);

  const tickDate = (t: number) =>
    format.dateTime(new Date(t), { month: 'short', day: 'numeric' });

  const fullDay = (t: number) =>
    format.dateTime(new Date(t), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[250px] w-full"
      aria-label={ariaLabel}
    >
      <AreaChart
        key={animationKey}
        accessibilityLayer
        data={data}
        margin={{ left: 8, right: 12, top: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={xDomain}
          scale="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={tickDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={value}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t;
                return typeof t === 'number' ? fullDay(t) : '';
              }}
              formatter={(v, name) => {
                const label =
                  chartConfig[String(name)]?.label ?? String(name);
                return (
                  <div className="flex w-full items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground font-mono font-medium tabular-nums">
                      {exactValue(Number(v))}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        {prepared.length > 1 && (
          <ChartLegend content={<ChartLegendContent />} />
        )}
        {prepared.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type={kind === 'money' ? 'stepAfter' : 'monotone'}
            fill={`var(--color-${s.key})`}
            fillOpacity={prepared.length > 1 ? 0.08 : 0.18}
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive
            animationDuration={450}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

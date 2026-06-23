'use client';

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { PublicEstimateSnapshot } from '@/lib/api';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  snapshots: PublicEstimateSnapshot[];
}

const chartConfig: ChartConfig = {
  range: {
    label: 'Estimated range',
    color: 'var(--primary)',
  },
  mid: {
    label: 'Estimate',
    color: 'var(--primary)',
  },
};

interface DataPoint {
  t: number;
  low: number;
  high: number;
  mid: number;
  range: [number, number];
}

export function SalesHistoryChart({ snapshots }: Props) {
  const t = useTranslations('salesHistory');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const data = useMemo<DataPoint[]>(
    () =>
      snapshots
        .map((s) => ({
          t: new Date(s.computedAt).getTime(),
          low: s.estimatedTodayLow,
          high: s.estimatedTodayHigh,
          mid: Math.round((s.estimatedTodayLow + s.estimatedTodayHigh) / 2),
          range: [s.estimatedTodayLow, s.estimatedTodayHigh] as [number, number],
        }))
        .sort((a, b) => a.t - b.t),
    [snapshots],
  );

  if (data.length < 2) return null;

  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 1 });

  const formatRange = (low: number, high: number) =>
    low === high ? compact(low) : `${compact(low)} – ${compact(high)}`;

  const formatTickDate = (ts: number) =>
    format.dateTime(new Date(ts), { year: 'numeric', month: 'short' });

  const formatTooltipDate = (ts: number) =>
    format.dateTime(new Date(ts), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {t('title')}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[260px] w-full"
        >
          <AreaChart
            data={data}
            margin={{ left: 8, right: 16, top: 16, bottom: 4 }}
          >
            <defs>
              <linearGradient id="salesRangeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-range)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-range)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 6"
              className="stroke-border/60"
            />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={xDomain}
              tickFormatter={formatTickDate}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={(v: number) => compact(v)}
              tickLine={false}
              axisLine={false}
              width={44}
              tickMargin={4}
            />
            <ChartTooltip
              cursor={{
                stroke: 'var(--color-mid)',
                strokeOpacity: 0.4,
                strokeDasharray: '3 3',
              }}
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload as DataPoint | undefined;
                    return point ? formatTooltipDate(point.t) : '';
                  }}
                  formatter={(_, name, item) => {
                    if (name !== 'mid') return null;
                    const point = item.payload as DataPoint;
                    return (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          {tCommon('units')}
                        </span>
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          {formatRange(point.low, point.high)}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Area
              dataKey="range"
              type="monotone"
              stroke="none"
              fill="url(#salesRangeGradient)"
              isAnimationActive={false}
            />
            <Area
              dataKey="mid"
              type="monotone"
              stroke="var(--color-mid)"
              strokeWidth={2.5}
              fill="transparent"
              dot={false}
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: 'var(--background)',
                fill: 'var(--color-mid)',
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

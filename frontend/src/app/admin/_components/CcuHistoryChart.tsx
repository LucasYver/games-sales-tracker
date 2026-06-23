'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { AdminSignal } from '@/lib/admin';

interface Props {
  signals: AdminSignal[];
}

const chartConfig: ChartConfig = {
  current: {
    label: 'Concurrent players',
    color: 'var(--chart-1)',
  },
  peak: {
    label: 'All-time peak',
    color: 'var(--chart-3)',
  },
};

function formatPlayers(value: number): string {
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

export function CcuHistoryChart({ signals }: Props) {
  const { data, peak, peakAt } = useMemo(() => {
    const concurrent = signals
      .filter((s) => s.metric === 'STEAM_CONCURRENT')
      .map((s) => ({
        t: new Date(s.capturedAt).getTime(),
        current: s.value,
      }))
      .sort((a, b) => a.t - b.t);

    // Pick the all-time peak by `value` (not `capturedAt`): the
    // historical-import path writes a peak row with the SteamCharts
    // month as capturedAt, so the row with the largest value — not the
    // most recently captured — represents the true current peak.
    const peakRows = signals
      .filter((s) => s.metric === 'STEAM_PEAK_CCU')
      .sort((a, b) => b.value - a.value);
    const latestPeak = peakRows[0] ?? null;

    return {
      data: concurrent,
      peak: latestPeak?.value ?? null,
      peakAt: latestPeak?.capturedAt ?? null,
    };
  }, [signals]);

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        No concurrent-player snapshots yet. They will be captured on the next
        refresh (the daily cron polls Steam&apos;s GetNumberOfCurrentPlayers
        for every tracked Steam app).
      </p>
    );
  }

  if (data.length === 1) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        Only one concurrent-player snapshot so far (
        {data[0].current.toLocaleString()} on {formatDay(data[0].t)}). The
        chart will appear after the next refresh.
      </div>
    );
  }

  const xDomain: [number, number] = [data[0].t, data[data.length - 1].t];
  const yMax =
    Math.max(...data.map((d) => d.current), peak ?? 0) * 1.1 || undefined;

  return (
    <ChartContainer config={chartConfig} className="h-[280px] w-full px-6 pb-4">
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
          tickFormatter={formatPlayers}
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
                    formatPlayers(value as number),
                    'Concurrent players',
                  ];
                }
                return null;
              }}
            />
          }
        />
        {peak !== null && (
          <ReferenceLine
            y={peak}
            stroke="var(--color-peak)"
            strokeDasharray="4 4"
            label={{
              value: `All-time peak ${formatPlayers(peak)}${
                peakAt
                  ? ` · ${new Date(peakAt).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}`
                  : ''
              }`,
              position: 'insideTopLeft',
              fill: 'var(--color-peak)',
              fontSize: 11,
            }}
          />
        )}
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
  );
}

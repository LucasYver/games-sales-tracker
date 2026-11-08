'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import type { AdminDashboardOverview } from '@/lib/admin';
import { SOURCE_GROUPS, groupBySource } from './milestone-source-groups';

type Granularity = 'day' | 'week';

const GRANULARITIES: Array<{ key: Granularity; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
];

const chartConfig: ChartConfig = Object.fromEntries(
  SOURCE_GROUPS.map((g) => [g.key, { label: g.label, color: g.color }]),
);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function MilestonesAddedChart({
  days,
  weeks,
}: {
  days: AdminDashboardOverview['dailyMilestones'];
  weeks: AdminDashboardOverview['weeklyMilestones'];
}) {
  const [granularity, setGranularity] = useState<Granularity>('week');

  const data =
    granularity === 'day'
      ? days.map((d) => ({ date: d.day, ...groupBySource(d.bySource) }))
      : weeks.map((w) => ({
          date: w.weekStart,
          ...groupBySource(w.bySource),
        }));

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex justify-end gap-1"
        role="group"
        aria-label="Group by"
      >
        {GRANULARITIES.map((g) => (
          <Button
            key={g.key}
            type="button"
            size="sm"
            variant={granularity === g.key ? 'default' : 'ghost'}
            className="h-7 px-2 text-xs"
            aria-pressed={granularity === g.key}
            onClick={() => setGranularity(g.key)}
          >
            {g.label}
          </Button>
        ))}
      </div>
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)' }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const date = payload?.[0]?.payload?.date;
                  if (typeof date !== 'string') return '';
                  return granularity === 'week'
                    ? `Week of ${formatDate(date)}`
                    : formatDate(date);
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {SOURCE_GROUPS.map((g, i) => (
            <Bar
              key={g.key}
              dataKey={g.key}
              stackId="sources"
              fill={`var(--color-${g.key})`}
              stroke="var(--card)"
              strokeWidth={1}
              radius={i === SOURCE_GROUPS.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}

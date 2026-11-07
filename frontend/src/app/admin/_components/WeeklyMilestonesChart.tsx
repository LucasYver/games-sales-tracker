'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { AdminDashboardOverview } from '@/lib/admin';
import { SOURCE_GROUPS, groupBySource } from './milestone-source-groups';

const chartConfig: ChartConfig = Object.fromEntries(
  SOURCE_GROUPS.map((g) => [g.key, { label: g.label, color: g.color }]),
);

function formatWeek(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function WeeklyMilestonesChart({
  weeks,
}: {
  weeks: AdminDashboardOverview['weeklyMilestones'];
}) {
  const data = weeks.map((w) => ({
    week: w.weekStart,
    ...groupBySource(w.bySource),
  }));

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tickFormatter={formatWeek}
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
                const week = payload?.[0]?.payload?.week;
                return typeof week === 'string'
                  ? `Week of ${formatWeek(week)}`
                  : '';
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
  );
}

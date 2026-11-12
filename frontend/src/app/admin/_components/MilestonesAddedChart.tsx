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

type Scope = 'all' | 'first';

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'all', label: 'All milestones' },
  { key: 'first', label: 'First for a game' },
];

function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <Button
          key={o.key}
          type="button"
          size="sm"
          variant={value === o.key ? 'default' : 'ghost'}
          className="h-7 px-2 text-xs"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

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
  firstDays,
  firstWeeks,
}: {
  days: AdminDashboardOverview['dailyMilestones'];
  weeks: AdminDashboardOverview['weeklyMilestones'];
  /** Same buckets, counting only each game's first sales milestone. */
  firstDays: AdminDashboardOverview['dailyFirstMilestones'];
  firstWeeks: AdminDashboardOverview['weeklyFirstMilestones'];
}) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [scope, setScope] = useState<Scope>('all');
  const dayRows = scope === 'first' ? firstDays : days;
  const weekRows = scope === 'first' ? firstWeeks : weeks;

  const data =
    granularity === 'day'
      ? dayRows.map((d) => ({ date: d.day, ...groupBySource(d.bySource) }))
      : weekRows.map((w) => ({
          date: w.weekStart,
          ...groupBySource(w.bySource),
        }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-between gap-2">
        <Toggle
          label="Milestones counted"
          options={SCOPES}
          value={scope}
          onChange={setScope}
        />
        <Toggle
          label="Group by"
          options={GRANULARITIES}
          value={granularity}
          onChange={setGranularity}
        />
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

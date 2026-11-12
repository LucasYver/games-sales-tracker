'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';

export interface LaunchCurve {
  key: string;
  label: string;
  /** Days since launch → value (copies, reviews…); starts at day 0. */
  points: { day: number; units: number }[];
}

/** The tracked game first, in the primary colour; benchmarks after it. */
const PALETTE = ['var(--primary)', 'var(--chart-2)', 'var(--chart-4)'];

/**
 * One line per game against days since launch. The messages (`chartAria`,
 * `dayTick`, `tooltip` with `{units}` and `{day}`) come from `namespace`,
 * so each tracker page names its own unit. Points past `maxDay` are cut.
 */
export function LaunchCurvesChart({
  curves,
  namespace = 'gta6Sales',
  maxDay: maxDayProp,
}: {
  curves: LaunchCurve[];
  namespace?: 'gta6Sales' | 'mw4Sales';
  maxDay?: number;
}) {
  const t = useTranslations(namespace);
  const format = useFormatter();
  const config: ChartConfig = Object.fromEntries(
    curves.map((c, i) => [
      c.key,
      { label: c.label, color: PALETTE[i % PALETTE.length] },
    ]),
  );
  const maxDay =
    maxDayProp ??
    Math.max(30, ...curves.flatMap((c) => c.points.map((p) => p.day)));
  const units = (v: number) =>
    format.number(v, { notation: 'compact', maximumFractionDigits: 1 });

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-72 w-full"
      aria-label={t('chartAria')}
    >
      <LineChart margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          type="number"
          dataKey="day"
          domain={[0, maxDay]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: number) => t('dayTick', { day: d })}
          allowDuplicatedCategory={false}
        />
        <YAxis
          type="number"
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={units}
        />
        <ChartTooltip
          cursor={false}
          content={({ active, payload }) => {
            const item = payload?.[0];
            if (!active || !item) return null;
            const point = item.payload as { day: number };
            const label = config[String(item.dataKey)]?.label;
            return (
              <div className="rounded-[3px] border border-border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                <div className="font-medium">{label ?? String(item.dataKey)}</div>
                <div className="text-muted-foreground">
                  {t('tooltip', {
                    units: units(Number(item.value)),
                    day: point.day,
                  })}
                </div>
              </div>
            );
          }}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {curves.map((c, i) => (
          <Line
            key={c.key}
            // One dataKey per game, so the legend and tooltip find its label.
            data={c.points
              .filter((p) => p.day <= maxDay)
              .map((p) => ({ day: p.day, [c.key]: p.units }))}
            dataKey={c.key}
            type="linear"
            stroke={`var(--color-${c.key})`}
            strokeWidth={i === 0 ? 2.5 : 1.5}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

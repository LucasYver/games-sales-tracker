'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import {
  CHART_METRICS,
  monthDate,
  valueAt,
  type ChartMetric,
  type CompareGame,
  type MonthPoint,
} from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Segmented } from './Segmented';
import { useAgeText } from './useAgeText';

type Mode = 'aligned' | 'calendar';
type Range = 'y1' | 'y3' | 'all';
type Scale = 'linear' | 'log';

/** A series that starts this many months after launch gets a "tracking starts" marker. */
const LATE_TRACKING_MONTHS = 3;

interface Marker {
  x: number;
  label: string;
  color: string;
  top: boolean;
}

/**
 * Both games on one chart. "Aligned" puts each launch at month 0, so a 2022
 * game and a 2025 game are compared at the same age; "calendar" shows them
 * on real dates. A series that only starts long after launch is marked, so
 * a late start never reads as zero.
 */
export function CompareChart({
  games,
  colors,
}: {
  games: readonly [CompareGame, CompareGame];
  colors: readonly [string, string];
}) {
  const t = useTranslations('compare');
  const format = useFormatter();
  const ageText = useAgeText();
  const [mode, setMode] = useState<Mode>('aligned');
  const [metricChoice, setMetric] = useState<ChartMetric>('reviews');
  const [rangeChoice, setRange] = useState<Range>('all');
  const [scale, setScale] = useState<Scale>('linear');
  const [hover, setHover] = useState<number | null>(null);

  const available = CHART_METRICS.filter((m) =>
    games.some((g) => g.series[m].calendar.length > 0),
  );
  if (available.length === 0) return null;
  const metric = available.includes(metricChoice) ? metricChoice : available[0];

  const oldest = Math.max(0, ...games.map((g) => g.ageMonths ?? 0));
  const aligned = mode === 'aligned' && oldest > 0;
  const ranges: Range[] = [
    ...(oldest > 12 ? (['y1'] as const) : []),
    ...(oldest > 36 ? (['y3'] as const) : []),
    'all',
  ];
  const range = ranges.includes(rangeChoice) ? rangeChoice : 'all';

  const pointsOf = (g: CompareGame): MonthPoint[] =>
    aligned ? g.series[metric].aligned : g.series[metric].calendar;

  let xmin = 0;
  let xmax: number;
  if (aligned) {
    xmax = range === 'y1' ? 12 : range === 'y3' ? 36 : oldest;
  } else {
    const months = games.flatMap((g) => g.series[metric].calendar.map((p) => p[0]));
    xmin = Math.min(...months);
    xmax = Math.max(xmin + 1, ...months);
  }

  const rows = new Map<number, { x: number; a?: number; b?: number }>();
  games.forEach((g, i) => {
    for (const [x, v] of pointsOf(g)) {
      if (x < xmin || x > xmax) continue;
      const row = rows.get(x) ?? { x };
      row[i === 0 ? 'a' : 'b'] = v;
      rows.set(x, row);
    }
  });
  const data = [...rows.values()].sort((p, q) => p.x - q.x);

  const values = data
    .flatMap((r) => [r.a, r.b])
    .filter((v): v is number => v != null && v > 0);
  const log = scale === 'log' && values.length > 0;
  let yDomain: [number, number] | undefined;
  let yTicks: number[] | undefined;
  if (log) {
    const lmin = Math.log10(Math.min(...values)) - 0.08;
    const lmax = Math.log10(Math.max(...values)) + 0.04;
    yDomain = [10 ** lmin, 10 ** lmax];
    const ticks: number[] = [];
    for (let e = Math.floor(lmin); e <= Math.ceil(lmax); e++) {
      for (const k of [1, 2, 5]) {
        const v = k * 10 ** e;
        if (v >= yDomain[0] && v <= yDomain[1]) ticks.push(v);
      }
    }
    yTicks = ticks.length >= 2 ? ticks : undefined;
  }

  const xTicks: number[] = [];
  if (aligned) {
    const step = xmax <= 12 ? 3 : xmax <= 36 ? 6 : 12;
    for (let m = 0; m <= xmax; m += step) xTicks.push(m);
  } else {
    xTicks.push(xmin);
    for (let m = Math.ceil((xmin + 1) / 12) * 12; m <= xmax; m += 12) {
      if (m - xmin >= 6) xTicks.push(m);
    }
  }

  const monthYear = (index: number, month: 'short' | 'long' = 'long') =>
    format.dateTime(monthDate(index), { month, year: 'numeric', timeZone: 'UTC' });
  const compact = (v: number) =>
    format.number(v, { notation: 'compact', maximumFractionDigits: 1 });
  const tickLabel = (x: number) => {
    if (aligned) {
      if (x === 0) return t('tickLaunch');
      return x % 12 === 0 ? t('tickYears', { n: x / 12 }) : t('tickMonths', { n: x });
    }
    return x !== xmin && x % 12 === 0 ? String(x / 12) : monthYear(x, 'short');
  };

  const markers: Marker[] = [];
  if (!aligned) {
    games.forEach((g, i) => {
      if (g.releaseMonth != null && g.releaseMonth > xmin && g.releaseMonth <= xmax) {
        markers.push({
          x: g.releaseMonth,
          label: t('releaseMarker', { name: g.name }),
          color: colors[i],
          top: true,
        });
      }
    });
  }
  const coverage: string[] = [];
  games.forEach((g, i) => {
    const first = g.series[metric].aligned[0]?.[0];
    const firstCal = g.series[metric].calendar[0]?.[0];
    if (first == null || firstCal == null || first < LATE_TRACKING_MONTHS) return;
    coverage.push(
      t('coverage', { name: g.name, date: monthYear(firstCal), age: ageText(first) }),
    );
    const x = aligned ? first : firstCal;
    if (x >= xmin && x <= xmax) {
      markers.push({ x, label: t('trackingStart'), color: colors[i], top: false });
    }
  });

  const describe = (g: CompareGame, x: number): { text: string; muted: boolean } => {
    const series = g.series[metric];
    const muted = (text: string) => ({ text, muted: true });
    if (aligned) {
      if (g.ageMonths == null) return muted(t('notReleased'));
      if (x > g.ageMonths) return muted(t('notYetAtAge'));
      const first = series.aligned[0]?.[0];
      if (first == null) return muted(t('noData'));
      if (x < first) return muted(t('notTracked'));
    } else {
      const first = series.calendar[0]?.[0];
      if (first == null) return muted(t('noData'));
      if (x < first) {
        return muted(
          g.releaseMonth == null || x < g.releaseMonth ? t('notReleased') : t('notTracked'),
        );
      }
    }
    const v = valueAt(aligned ? series.aligned : series.calendar, x);
    return v == null ? muted(t('noData')) : { text: format.number(v), muted: false };
  };

  const latest = (g: CompareGame): { text: string; muted: boolean } => {
    const visible = pointsOf(g).filter(([x]) => x >= xmin && x <= xmax);
    const last = visible.at(-1);
    return last
      ? { text: format.number(last[1]), muted: false }
      : { text: t('noData'), muted: true };
  };

  const readLabel =
    hover == null
      ? t('readoutLatest')
      : aligned
        ? hover === 0
          ? t('readoutLaunchMonth')
          : t('readoutMonth', { n: hover })
        : monthYear(hover);
  const readItems = games.map((g, i) => ({
    name: g.name,
    color: colors[i],
    ...(hover == null ? latest(g) : describe(g, hover)),
  }));

  const config: ChartConfig = {
    a: { label: games[0].name, color: colors[0] },
    b: { label: games[1].name, color: colors[1] },
  };

  const pick = <V extends string>(option: string, set: (v: V) => void) => (v: V) => {
    set(v);
    setHover(null);
    trackEvent('compare_option', { option, value: v });
  };

  return (
    <section
      aria-labelledby="compare-chart-title"
      className="flex flex-col gap-4 border-b border-border px-4 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="compare-chart-title"
          className="font-mono text-[0.8rem] font-bold tracking-wider uppercase"
        >
          {t('chartTitle')}
        </h2>
        {oldest > 0 && (
          <Segmented<Mode>
            label={t('timeAxis')}
            value={aligned ? 'aligned' : 'calendar'}
            onChange={pick<Mode>('mode', setMode)}
            options={[
              { value: 'aligned', label: t('modeAligned') },
              { value: 'calendar', label: t('modeCalendar') },
            ]}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <Segmented<ChartMetric>
          showLabel
          label={t('metricLabel')}
          value={metric}
          onChange={pick<ChartMetric>('metric', setMetric)}
          options={available.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
        />
        {aligned && ranges.length > 1 && (
          <Segmented<Range>
            showLabel
            label={t('rangeLabel')}
            value={range}
            onChange={pick<Range>('range', setRange)}
            options={ranges.map((r) => ({ value: r, label: t(`range.${r}`) }))}
          />
        )}
        <Segmented<Scale>
          showLabel
          label={t('scaleLabel')}
          value={scale}
          onChange={pick<Scale>('scale', setScale)}
          options={[
            { value: 'linear', label: t('scale.linear') },
            { value: 'log', label: t('scale.log') },
          ]}
        />
      </div>

      <div
        aria-live="polite"
        className="flex min-h-12 flex-wrap items-baseline gap-x-6 gap-y-1.5 rounded-[3px] border border-border-soft bg-surface-alt px-3 py-2.5"
      >
        <span className="basis-full font-mono text-xs text-muted-foreground">{readLabel}</span>
        {readItems.map((item) => (
          <span key={item.name} className="inline-flex items-baseline gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: item.color }}
            />
            <span className="text-[0.82rem]">{item.name}</span>
            <span
              className={`font-mono text-[0.95rem] font-semibold tabular-nums ${
                item.muted ? 'text-muted-foreground' : 'text-foreground'
              }`}
            >
              {item.text}
            </span>
          </span>
        ))}
      </div>

      <ChartContainer
        config={config}
        className="aspect-auto h-72 w-full"
        aria-label={t('chartAria', {
          metric: t(`metric.${metric}`),
          a: games[0].name,
          b: games[1].name,
        })}
      >
        <LineChart
          data={data}
          margin={{ left: 4, right: 16, top: 8, bottom: 0 }}
          onMouseMove={(state) => {
            // Recharts gives the hovered point's index; its label is not
            // always set on a numeric axis.
            const index = Number(state?.activeTooltipIndex);
            const fromIndex = Number.isInteger(index) ? data[index]?.x : undefined;
            const x = fromIndex ?? Number(state?.activeLabel);
            if (Number.isFinite(x) && x !== hover) setHover(x);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[xmin, xmax]}
            ticks={xTicks}
            tickFormatter={tickLabel}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={0}
            allowDataOverflow
          />
          <YAxis
            type="number"
            scale={log ? 'log' : 'linear'}
            domain={log && yDomain ? yDomain : [0, 'auto']}
            ticks={log ? yTicks : undefined}
            allowDataOverflow={log}
            tickFormatter={compact}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={() => null} />
          {markers.map((m) => (
            <ReferenceLine
              key={`${m.label}-${m.x}`}
              x={m.x}
              stroke={m.color}
              strokeOpacity={0.6}
              strokeDasharray="4 4"
              label={{
                value: m.label,
                position: m.top ? 'insideTopRight' : 'insideBottomRight',
                fill: m.color,
                fontSize: 11,
              }}
            />
          ))}
          <Line
            dataKey="b"
            type="linear"
            stroke="var(--color-b)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="a"
            type="linear"
            stroke="var(--color-a)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>

      {coverage.length > 0 && (
        <p className="rounded-[3px] border border-primary/30 bg-accent px-3 py-2 text-[0.82rem] text-foreground">
          {coverage.join(' ')}
        </p>
      )}
      <p className="text-[0.82rem] text-muted-foreground">{t(`note.${metric}`)}</p>
    </section>
  );
}

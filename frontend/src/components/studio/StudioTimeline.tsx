'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Segmented } from '@/components/compare/Segmented';
import { cursorLabel } from '@/components/compare/cursorLabel';
import { trackEvent } from '@/lib/analytics';
import type { HubKind, HubTimeline, PopularGame } from '@/lib/api';
import { monthDate } from '@/lib/compare';
import {
  GAME_COLORS,
  METRICS,
  OTHERS_COLOR,
  TOP_GAMES,
  buildTimelineGames,
  gainValue,
  lineValue,
  recentTotal,
  stackValue,
  studioTotals,
  weekDate,
  weekIndex,
  type Dense,
  type Metric,
  type Store,
  type TimelineGame,
} from '@/lib/studio-timeline';
import { StudioTimelineTable } from './StudioTimelineTable';

type View = 'stack' | 'lines' | 'launch' | 'bars';
type Range = 'all' | 'long' | 'short';

/** One band or line of the chart: a game, or the studio's other games together. */
interface Entry {
  key: string;
  name: string;
  color: string;
  members: TimelineGame[];
  release: number | null;
}

/** Bucket count of each period, per axis: Steam months, console weeks, months since launch. */
const SPANS = {
  month: { long: 60, short: 24 },
  week: { long: 26, short: 13 },
  launch: { long: 60, short: 24 },
} as const;

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Every game of a hub over time, store by store (and Steam players): the studio's total as
 * stacked bands, each game's curve, launches side by side and new reviews per
 * period, then the per-game table. The eight games with the most reviews and
 * ratings have their own colour; the rest share one band.
 */
export function StudioTimeline({
  kind,
  games: hubGames,
  timeline,
}: {
  kind: HubKind;
  games: PopularGame[];
  timeline: HubTimeline;
}) {
  const t = useTranslations('studioTimeline');
  const format = useFormatter();
  const games = useMemo(() => buildTimelineGames(hubGames, timeline), [hubGames, timeline]);
  const totals = useMemo(() => studioTotals(games), [games]);

  const [metricChoice, setMetric] = useState<Metric>('steam');
  const [viewChoice, setView] = useState<View>('stack');
  const [rangeChoice, setRange] = useState<Range>('all');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<number | null>(null);

  const withData = games.filter((g) => g.total > 0);
  if (withData.length === 0) return null;
  const top = withData.slice(0, TOP_GAMES);
  const rest = withData.slice(TOP_GAMES);
  const colorOf = new Map(top.map((g, i) => [g.slug, GAME_COLORS[i]]));

  const metrics = METRICS.filter((m) => games.some((g) => g.series[m]));
  const metric = metrics.includes(metricChoice) ? metricChoice : metrics[0];
  const weekly = metric === 'ps' || metric === 'xbox';
  const players = metric === 'ccu';
  // Players are not cumulative: a month's new players means nothing.
  const views: View[] = weekly
    ? ['stack', 'lines', 'bars']
    : players
      ? ['stack', 'lines', 'launch']
      : ['stack', 'lines', 'launch', 'bars'];
  const view = views.includes(viewChoice) ? viewChoice : 'lines';
  const launch = view === 'launch';
  const stacked = view === 'stack' || view === 'bars';

  // Oldest release at the bottom of a stack, the other games under it all.
  const entries: Entry[] = top
    .filter((g) => g.series[metric] && (!launch || g.releaseMonth != null))
    .map((g) => ({
      key: `g${top.indexOf(g)}`,
      name: g.name,
      color: colorOf.get(g.slug) as string,
      members: [g],
      release: g.releaseMonth,
    }))
    .sort((a, b) => (a.release ?? 0) - (b.release ?? 0));
  const restHere = rest.filter((g) => g.series[metric]);
  if (restHere.length > 0 && !launch) {
    entries.unshift({
      key: 'others',
      name: t('others', { count: restHere.length }),
      color: OTHERS_COLOR,
      members: restHere,
      release: null,
    });
  }
  const shown = entries.filter((e) => !hidden.has(e.key));

  const dense = (g: TimelineGame): Dense | null => g.series[metric];
  const lastBucket = (d: Dense | null) => (d ? d.start + d.values.length - 1 : -Infinity);

  // X axis: calendar buckets, or months since launch.
  const axis = launch ? 'launch' : weekly ? 'week' : 'month';
  let xmin = 0;
  let xmax = 0;
  let fullSpan = 0;
  if (launch) {
    fullSpan = Math.max(
      1,
      ...shown.map((e) => lastBucket(dense(e.members[0])) - (e.release ?? 0)),
    );
  } else {
    const firsts = shown.flatMap((e) => e.members.map((g) => dense(g)?.start ?? Infinity));
    xmax = Math.max(...shown.flatMap((e) => e.members.map((g) => lastBucket(dense(g)))));
    xmin = Math.min(...firsts);
    fullSpan = xmax - xmin;
  }
  const ranges: Range[] = [
    'all',
    ...(fullSpan > SPANS[axis].long ? (['long'] as const) : []),
    ...(fullSpan > SPANS[axis].short ? (['short'] as const) : []),
  ];
  const range = ranges.includes(rangeChoice) ? rangeChoice : 'all';
  if (launch) {
    xmax = range === 'all' ? fullSpan : SPANS.launch[range];
  } else if (range !== 'all') {
    xmin = xmax - SPANS[axis][range] + 1;
  }

  const valueOf = (e: Entry, x: number): number | null => {
    if (launch) return lineValue(dense(e.members[0]), (e.release ?? 0) + x);
    if (view === 'bars') return sum(e.members.map((g) => gainValue(dense(g), x, metric)));
    if (view === 'stack') return sum(e.members.map((g) => stackValue(dense(g), x)));
    const parts = e.members
      .map((g) => lineValue(dense(g), x))
      .filter((v): v is number => v != null);
    return parts.length > 0 ? sum(parts) : null;
  };

  const data: Record<string, number | null>[] = [];
  if (shown.length > 0 && Number.isFinite(xmin) && Number.isFinite(xmax)) {
    for (let x = xmin; x <= xmax; x++) {
      const row: Record<string, number | null> = { x };
      for (const e of shown) row[e.key] = valueOf(e, x);
      data.push(row);
    }
  }

  // Ticks: a year (or two) on Steam, a month on consoles, a year since launch.
  const xTicks: number[] = [];
  const tickText = new Map<number, string>();
  if (launch) {
    const step = xmax <= 24 ? 6 : xmax <= 72 ? 12 : 24;
    for (let m = 0; m <= xmax; m += step) {
      xTicks.push(m);
      tickText.set(
        m,
        m === 0 ? t('tickLaunch') : m % 12 === 0 ? t('tickYears', { n: m / 12 }) : t('tickMonths', { n: m }),
      );
    }
  } else if (!weekly) {
    const years = Math.ceil((xmax - xmin) / 12);
    const every = years > 20 ? 4 : years > 10 ? 2 : 1;
    for (let m = Math.ceil(xmin / 12) * 12; m <= xmax; m += 12) {
      const year = m / 12;
      if (year % every === 0) {
        xTicks.push(m);
        tickText.set(m, String(year));
      }
    }
  } else {
    const months = (xmax - xmin) / 4.35;
    const step = months <= 8 ? 1 : months <= 16 ? 2 : months <= 30 ? 3 : 6;
    let previous: number | null = null;
    for (let w = xmin; w <= xmax; w++) {
      const d = weekDate(w);
      const m = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (previous != null && m !== previous && m % step === 0) {
        xTicks.push(w);
        tickText.set(
          w,
          format.dateTime(d, {
            month: 'short',
            ...(step >= 3 || d.getUTCMonth() === 0 ? { year: 'numeric' } : {}),
            timeZone: 'UTC',
          }),
        );
      }
      previous = m;
    }
  }

  // Release dots (and, on consoles, where tracking began) on the x axis.
  const dots: { key: string; x: number; color: string; hollow: boolean }[] = [];
  if (!launch) {
    for (const e of shown) {
      if (e.key === 'others') continue;
      const g = e.members[0];
      if (g.releaseMonth != null) {
        const x = weekly ? weekIndex(monthDate(g.releaseMonth)) : g.releaseMonth;
        if (x >= xmin && x <= xmax) dots.push({ key: `${e.key}-r`, x, color: e.color, hollow: false });
      }
      // Tracking that began well after launch is marked, so its start never reads as a launch.
      const first = g.firstBucket[metric];
      const releaseX =
        g.releaseMonth == null ? null : weekly ? weekIndex(monthDate(g.releaseMonth)) : g.releaseMonth;
      const late = first != null && (releaseX == null || first > releaseX + (weekly ? 4 : 1));
      if (late && first > xmin && first <= xmax) {
        dots.push({ key: `${e.key}-t`, x: first, color: e.color, hollow: true });
      }
    }
  }

  const n = (v: number) => format.number(v);
  const compact = (v: number) => format.number(v, { notation: 'compact', maximumFractionDigits: 1 });
  const pct = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 1 });

  const readX = hover ?? xmax;
  const readLabel = launch
    ? hover == null
      ? t('readoutLatest')
      : hover === 0
        ? t('readoutLaunchMonth')
        : t('readoutMonth', { n: hover })
    : weekly
      ? t('readoutWeek', {
          date: format.dateTime(weekDate(readX), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
        })
      : format.dateTime(monthDate(readX), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Each launch curve reads at its own latest month before any hover.
  const latestOf = (e: Entry) =>
    launch ? (dense(e.members[0])?.values.at(-1) ?? null) : valueOf(e, xmax);
  // Every shown game keeps its row, in an order fixed by its latest value, so
  // the panel keeps its size while the pointer moves: a game with nothing at
  // the hovered month shows a dash instead of leaving the list.
  const readItems = shown
    .map((e) => {
      const v = hover == null ? latestOf(e) : valueOf(e, readX);
      return { e, v: v != null && v > 0 ? v : null, rank: latestOf(e) ?? 0 };
    })
    .sort((a, b) => b.rank - a.rank);
  const readTotal = sum(readItems.map((r) => r.v ?? 0));
  const sign = view === 'bars' ? '+' : '';

  const config: ChartConfig = Object.fromEntries(
    shown.map((e) => [e.key, { label: e.name, color: e.color }]),
  );

  const choose = <V extends string>(option: string, set: (v: V) => void) => (v: V) => {
    set(v);
    setHover(null);
    trackEvent('studio_timeline_option', { option, value: v });
  };
  const toggle = (e: Entry) => {
    const next = new Set(hidden);
    if (next.has(e.key)) next.delete(e.key);
    else next.add(e.key);
    setHidden(next);
    setHover(null);
    trackEvent('studio_timeline_option', {
      option: 'game',
      value: e.key === 'others' ? 'others' : e.members[0].slug,
    });
  };

  const lead = withData[0];
  const mover = withData.reduce<TimelineGame | null>(
    (best, g) => (!best || recentTotal(g) > recentTotal(best) ? g : best),
    null,
  );
  const recentShare = (s: Store) =>
    totals.recentTotal > 0 ? pct(totals.recent[s] / totals.recentTotal) : '—';
  const kpis = [
    {
      label: t('kpi.total'),
      value: n(totals.total),
      note: t('kpi.split', {
        steam: compact(totals.counts.steam),
        ps: compact(totals.counts.ps),
        xbox: compact(totals.counts.xbox),
      }),
    },
    {
      label: t('kpi.recent'),
      value: `+${n(totals.recentTotal)}`,
      note: t('kpi.split', { steam: recentShare('steam'), ps: recentShare('ps'), xbox: recentShare('xbox') }),
    },
    ...(mover && totals.recentTotal > 0
      ? [
          {
            label: t('kpi.mover'),
            value: mover.name,
            note: t('kpi.moverNote', { share: pct(recentTotal(mover) / totals.recentTotal) }),
          },
        ]
      : []),
    ...(totals.steamYear.before > 0
      ? [
          {
            label: t('kpi.steamYear'),
            value: `+${n(totals.steamYear.gain)}`,
            note: t('kpi.steamYearNote', { growth: pct(totals.steamYear.gain / totals.steamYear.before) }),
          },
        ]
      : []),
  ];

  const metricName = t(`metric.${metric}`);
  const family = players ? 'ccu' : weekly ? 'console' : 'steam';
  const storeName = weekly ? t(`store.${metric}`) : '';
  const viewLabel = (v: View) =>
    v === 'bars' ? t(weekly ? 'view.barsWeek' : 'view.barsMonth') : t(`view.${v}`);
  const rangeLabel = (r: Range) =>
    r === 'all' ? t('range.all') : t(`range.${axis}.${r}`);

  return (
    <>
      <section aria-labelledby="studio-timeline-title" className="flex flex-col gap-4 border-b border-border px-4 py-5">
        <div>
          <h2 id="studio-timeline-title" className="font-mono text-[0.8rem] font-bold tracking-wider uppercase">
            {t('title', { kind })}
          </h2>
          <p className="mt-1.5 max-w-[85ch] text-sm text-muted-foreground">
            {t('leadShare', { kind, game: lead.name, share: pct(lead.total / totals.total) })}
            {mover && totals.recentTotal > 0 &&
              ` ${t('moverShare', { game: mover.name, share: pct(recentTotal(mover) / totals.recentTotal) })}`}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-px overflow-hidden rounded-[3px] border border-border bg-border">
          {kpis.map((k) => (
            <div key={k.label} className="min-w-0 bg-card px-4 py-3">
              <div className="font-mono text-[0.68rem] tracking-wider text-muted-foreground uppercase">{k.label}</div>
              <div className="mt-1 truncate font-mono text-xl leading-tight font-bold tabular-nums">{k.value}</div>
              <div className="mt-0.5 font-mono text-[0.72rem] text-muted-foreground">{k.note}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          {metrics.length > 1 && (
            <Segmented<Metric>
              showLabel
              label={t('sourceLabel')}
              value={metric}
              onChange={choose<Metric>('store', setMetric)}
              options={metrics.map((m) => ({ value: m, label: t(`source.${m}`) }))}
            />
          )}
          <Segmented<View>
            showLabel
            label={t('viewLabel')}
            value={view}
            onChange={choose<View>('view', setView)}
            options={views.map((v) => ({ value: v, label: viewLabel(v) }))}
          />
          {ranges.length > 1 && (
            <Segmented<Range>
              showLabel
              label={t('rangeLabel')}
              value={range}
              onChange={choose<Range>('range', setRange)}
              options={ranges.map((r) => ({ value: r, label: rangeLabel(r) }))}
            />
          )}
        </div>
        <p className="text-[0.82rem] text-muted-foreground">
          {t(`note.${family}.${view}`, { kind, store: storeName })}
        </p>

        <div
          aria-live="polite"
          className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-[3px] border border-border-soft bg-surface-alt px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {/* The month itself is written on the chart, above the hovered column. */}
          <span className="sr-only">{readLabel}</span>
          {readItems.map(({ e, v }) => (
            <ReadoutRow
              key={e.key}
              color={e.color}
              name={e.name}
              value={v == null ? '—' : `${sign}${n(v)}`}
              muted={v == null}
            />
          ))}
          {stacked && readItems.length > 1 && (
            <ReadoutRow name={t('studioTotal', { kind })} value={`${sign}${n(readTotal)}`} total />
          )}
        </div>

        {data.length > 0 && (
          <ChartContainer
            config={config}
            className="aspect-auto h-80 w-full"
            aria-label={t('chartAria', { kind, metric: metricName })}
          >
            <ComposedChart
              data={data}
              margin={{ left: 4, right: 16, top: 24, bottom: 0 }}
              barCategoryGap={1}
              onMouseMove={(state) => {
                const index = Number(state?.activeTooltipIndex);
                const x = Number.isInteger(index) ? data[index]?.x : undefined;
                if (x != null && x !== hover) setHover(x);
              }}
              onMouseLeave={() => setHover(null)}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                type="number"
                dataKey="x"
                domain={view === 'bars' ? [xmin - 0.5, xmax + 0.5] : [xmin, xmax]}
                ticks={xTicks}
                tickFormatter={(x: number) => tickText.get(x) ?? ''}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={0}
                allowDataOverflow
              />
              <YAxis
                type="number"
                domain={[0, 'auto']}
                tickFormatter={compact}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={() => null} />
              <ReferenceLine
                x={readX}
                stroke="none"
                ifOverflow="visible"
                label={{ content: cursorLabel(readLabel, (readX - xmin) / (xmax - xmin || 1)) }}
              />
              {shown.map((e) =>
                view === 'stack' ? (
                  <Area
                    key={e.key}
                    dataKey={e.key}
                    type="linear"
                    stackId="studio"
                    stroke="var(--card)"
                    strokeWidth={0.5}
                    fill={`var(--color-${e.key})`}
                    fillOpacity={0.9}
                    isAnimationActive={false}
                  />
                ) : view === 'bars' ? (
                  <Bar
                    key={e.key}
                    dataKey={e.key}
                    stackId="studio"
                    fill={`var(--color-${e.key})`}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    key={e.key}
                    dataKey={e.key}
                    type="linear"
                    stroke={`var(--color-${e.key})`}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ),
              )}
              {dots.map((d) => (
                <ReferenceDot
                  key={d.key}
                  x={d.x}
                  y={0}
                  r={4}
                  fill={d.hollow ? 'var(--card)' : d.color}
                  stroke={d.color}
                  strokeWidth={d.hollow ? 2 : 1}
                  ifOverflow="visible"
                />
              ))}
            </ComposedChart>
          </ChartContainer>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
          <div role="group" aria-label={t('gamesLabel')} className="flex flex-wrap gap-2">
            {entries.map((e) => {
              const on = !hidden.has(e.key);
              return (
                <button
                  key={e.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(e)}
                  className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[0.8rem] transition-colors ${
                    on
                      ? 'border-border bg-surface-hi text-foreground'
                      : 'border-border-soft text-muted-foreground line-through'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: on ? e.color : 'var(--border)' }}
                  />
                  {e.name}
                </button>
              );
            })}
          </div>
          {!launch && (
            <div className="flex flex-wrap gap-4 font-mono text-[0.68rem] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full bg-muted-foreground" />
                {t('legendRelease')}
              </span>
              {dots.some((d) => d.hollow) && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-2 rounded-full border-[1.5px] border-muted-foreground" />
                  {t('legendTracking')}
                </span>
              )}
            </div>
          )}
        </div>
        <p className="font-mono text-[0.72rem] leading-relaxed text-muted-foreground">
          {t(`footnote.${family}`, { store: storeName })}
        </p>
      </section>

      <StudioTimelineTable kind={kind} games={games} totals={totals} colorOf={colorOf} />
    </>
  );
}

/**
 * One line of the panel above the chart: swatch, name cut to fit, value on
 * the right. Fixed-width cells keep the panel the same height while the
 * pointer moves over the chart.
 */
function ReadoutRow({
  color,
  name,
  value,
  muted = false,
  total = false,
}: {
  color?: string;
  name: string;
  value: string;
  muted?: boolean;
  total?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {color && (
        <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      )}
      <span
        title={name}
        className={`min-w-0 flex-1 truncate text-[0.82rem] ${total ? 'text-muted-foreground' : ''}`}
      >
        {name}
      </span>
      <span
        className={`shrink-0 font-mono text-[0.95rem] tabular-nums ${
          total ? 'font-bold text-primary' : muted ? 'font-semibold text-muted-foreground' : 'font-semibold'
        }`}
      >
        {value}
      </span>
    </span>
  );
}

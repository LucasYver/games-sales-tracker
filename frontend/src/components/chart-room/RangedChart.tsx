'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReviewPoint } from '@/lib/api';
import {
  SeriesChart,
  type SeriesKind,
} from '@/components/chart-room/SeriesChart';
import {
  CHART_RANGES,
  type ChartRangeKey,
  prepareRangePoints,
  rangeHasEnoughPoints,
} from '@/components/chart-room/chart-range';
import { useChartSearchParams } from '@/components/chart-room/useChartSearchParams';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

function lastValue(points: ReviewPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value > 0) return points[i].value;
  }
  return null;
}

function rangeDelta(points: ReviewPoint[]): number | null {
  const usable = points.filter((p) => p.value > 0);
  if (usable.length < 2) return null;
  const first = usable[0].value;
  const last = usable[usable.length - 1].value;
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

function rangeExtrema(points: ReviewPoint[]): { min: number; max: number } | null {
  const values = points.map((p) => p.value).filter((v) => v > 0);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** One chart with KPI strip always visible. */
export function RangedChart({
  points,
  label,
  description,
  ariaLabel,
  kind,
  currency,
  /** Cumulative series (reviews, ratings, followers): hide redundant min/max. */
  cumulative = false,
  /** Controlled period (e.g. from ?range=). Falls back to local / URL sync. */
  range: rangeProp,
  onRangeChange,
  /** When true and uncontrolled, read/write ?range= on the URL. */
  syncRangeUrl = false,
}: {
  points: ReviewPoint[];
  label: string;
  description?: string;
  ariaLabel: string;
  kind?: SeriesKind;
  currency?: string;
  cumulative?: boolean;
  range?: ChartRangeKey;
  onRangeChange?: (range: ChartRangeKey) => void;
  syncRangeUrl?: boolean;
}) {
  const t = useTranslations('gamePage');
  const format = useFormatter();
  const chartQuery = useChartSearchParams();
  const [localRange, setLocalRange] = useState<ChartRangeKey>('1y');

  const range =
    rangeProp ?? (syncRangeUrl ? chartQuery.range : localRange);
  const setRange = (next: ChartRangeKey) => {
    if (onRangeChange) onRangeChange(next);
    else if (syncRangeUrl) chartQuery.replaceParams({ range: next });
    else setLocalRange(next);
  };

  const days = CHART_RANGES.find((r) => r.key === range)?.days ?? null;
  const activeRange = rangeHasEnoughPoints(points, days)
    ? range
    : (CHART_RANGES.find((r) => rangeHasEnoughPoints(points, r.days))?.key ??
      'all');
  const active = prepareRangePoints(points, activeRange, { cumulative });

  const latest = lastValue(points);
  const delta = rangeDelta(active);
  const extrema = rangeExtrema(active);

  const formatValue = (n: number) =>
    kind === 'money'
      ? format.number(n / 100, {
          style: 'currency',
          currency: currency ?? 'USD',
          maximumFractionDigits: 0,
        })
      : format.number(n, { notation: 'compact', maximumFractionDigits: 1 });

  const pct = (n: number) =>
    format.number(n / 100, {
      style: 'percent',
      signDisplay: 'exceptZero',
      maximumFractionDigits: 1,
    });

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4 [.border-b]:pb-4">
        <div className="grid flex-1 gap-1">
          <CardTitle className="font-mono text-sm tracking-wider uppercase">
            {label}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <Select
          value={activeRange}
          onValueChange={(v) => setRange(v as ChartRangeKey)}
        >
          <SelectTrigger
            size="sm"
            className="font-mono text-xs uppercase"
            aria-label={t('chartsRange')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {CHART_RANGES.map((r) => {
              const enough = rangeHasEnoughPoints(points, r.days);
              return (
                <SelectItem
                  key={r.key}
                  value={r.key}
                  disabled={!enough}
                  className="font-mono text-xs uppercase"
                >
                  {t(`range_${r.key}`)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </CardHeader>

      <div
        className={cn(
          'grid gap-px border-b border-border bg-border',
          cumulative ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
        )}
      >
        <Kpi
          label={t('chartKpiLatest')}
          value={latest != null ? formatValue(latest) : '—'}
        />
        <Kpi
          label={t('chartKpiDelta')}
          value={delta != null ? pct(delta) : '—'}
          tone={
            delta == null ? 'muted' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'muted'
          }
        />
        {!cumulative && (
          <>
            <Kpi
              label={t('chartKpiMin')}
              value={extrema ? formatValue(extrema.min) : '—'}
            />
            <Kpi
              label={t('chartKpiMax')}
              value={extrema ? formatValue(extrema.max) : '—'}
            />
          </>
        )}
      </div>

      <CardContent className="px-2 pt-4 sm:px-4 sm:pt-6">
        {active.length > 1 ? (
          <SeriesChart
            series={[{ key: 'value', label, points: active }]}
            kind={kind}
            currency={currency}
            ariaLabel={ariaLabel}
            animationKey={`${activeRange}-${active.length}`}
          />
        ) : (
          <p className="text-muted-foreground px-2 py-10 text-center text-sm">
            {t('chartRangeEmpty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'up' | 'down';
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="font-mono text-[0.62rem] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-sm font-bold tabular-nums sm:text-base',
          tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'down' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

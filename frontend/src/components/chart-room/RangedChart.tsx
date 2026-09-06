'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReviewPoint } from '@/lib/api';
import {
  SeriesChart,
  type SeriesKind,
} from '@/components/chart-room/SeriesChart';

const RANGES = [
  { key: '1w', days: 7 },
  { key: '1m', days: 30 },
  { key: '3m', days: 90 },
  { key: '1y', days: 365 },
  { key: 'all', days: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window is measured back from the series' own last point, not from the
 * clock: the chart then shows the same thing whenever it is rendered, and a
 * game nobody polls any more still has a readable "last week" instead of an
 * empty one.
 */
function windowed(points: ReviewPoint[], days: number | null): ReviewPoint[] {
  if (!days || points.length === 0) return points;
  const last = new Date(points[points.length - 1].capturedAt).getTime();
  const cutoff = last - days * DAY_MS;
  return points.filter((p) => new Date(p.capturedAt).getTime() >= cutoff);
}

/** One chart with its own period filter. */
export function RangedChart({
  points,
  label,
  ariaLabel,
  kind,
  currency,
}: {
  points: ReviewPoint[];
  label: string;
  ariaLabel: string;
  kind?: SeriesKind;
  currency?: string;
}) {
  const t = useTranslations('gamePage');
  const [range, setRange] = useState<RangeKey>('all');

  // A period with a single observation cannot be drawn, so it is offered as
  // disabled rather than as a button that leads nowhere.
  const usable = new Map(
    RANGES.map((r) => [r.key, windowed(points, r.days)] as const),
  );
  const active = usable.get(range) ?? points;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <div
          role="group"
          aria-label={t('chartsRange')}
          className="flex gap-1 overflow-x-auto"
        >
          {RANGES.map((r) => {
            const enough = (usable.get(r.key) ?? []).length > 1;
            const on = r.key === range;
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                disabled={!enough}
                onClick={() => setRange(r.key)}
                className={`border px-1.5 py-0.5 font-mono text-[0.64rem] tracking-wide whitespace-nowrap uppercase disabled:cursor-not-allowed disabled:opacity-35 ${
                  on
                    ? 'border-primary/40 bg-accent text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`range_${r.key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {active.length > 1 ? (
        <SeriesChart
          points={active}
          kind={kind}
          currency={currency}
          ariaLabel={ariaLabel}
        />
      ) : (
        <p className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('chartRangeEmpty')}
        </p>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReviewPoint } from '@/lib/api';
import { RangedChart } from '@/components/chart-room/RangedChart';

export interface PlatformChartGroup {
  platform: string;
  label: string;
  /** Storefront the figures come from, named so the scope is never implied. */
  store: string;
  charts: { key: string; label: string; points: ReviewPoint[] }[];
}

/**
 * Every series here belongs to one storefront, and the numbers are not
 * comparable across them: a selector keeps one scope on screen at a time and
 * names the store it came from.
 */
export function PlatformCharts({ groups }: { groups: PlatformChartGroup[] }) {
  const t = useTranslations('gamePage');
  const [platform, setPlatform] = useState(groups[0]?.platform ?? '');

  const active = groups.find((g) => g.platform === platform) ?? groups[0];
  if (!active) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {groups.length > 1 ? (
          <div
            role="tablist"
            aria-label={t('platformSelectorLabel')}
            className="flex gap-1"
          >
            {groups.map((group) => {
              const on = group.platform === active.platform;
              return (
                <button
                  key={group.platform}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPlatform(group.platform)}
                  className={`border px-2 py-1 font-mono text-[0.7rem] tracking-wide whitespace-nowrap uppercase ${
                    on
                      ? 'border-primary/40 bg-accent text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="font-mono text-[0.8rem] font-bold tracking-wider uppercase">
            {active.label}
          </span>
        )}
        <span className="font-mono text-[0.68rem] text-muted-foreground">
          {t('chartsSource', { store: active.store })}
        </span>
      </div>

      <div className="flex flex-col gap-7">
        {active.charts.map((chart) => (
          <RangedChart
            key={`${active.platform}-${chart.key}`}
            points={chart.points}
            label={chart.label}
            ariaLabel={t('chartAlt', { series: chart.label })}
          />
        ))}
      </div>
    </div>
  );
}

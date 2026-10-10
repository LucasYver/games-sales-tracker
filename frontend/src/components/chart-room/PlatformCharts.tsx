'use client';

import { useTranslations } from 'next-intl';
import type { ReviewPoint } from '@/lib/api';
import { RangedChart } from '@/components/chart-room/RangedChart';
import { useChartSearchParams } from '@/components/chart-room/useChartSearchParams';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface PlatformChartGroup {
  platform: string;
  label: string;
  /** Storefront the figures come from, named so the scope is never implied. */
  store: string;
  charts: {
    key: string;
    label: string;
    points: ReviewPoint[];
    /** Hide min/max KPIs for monotonically growing series. */
    cumulative?: boolean;
  }[];
}

function hasChartData(group: PlatformChartGroup): boolean {
  return group.charts.some((c) => c.points.length > 1);
}

/**
 * Platform tabs on top (synced to ?platform=), then one ranged chart per
 * metric for the active storefront. Chart period is synced via ?range=.
 */
export function PlatformCharts({ groups }: { groups: PlatformChartGroup[] }) {
  const t = useTranslations('gamePage');
  const { platform: platformParam, range, replaceParams } =
    useChartSearchParams();

  const firstWithData = groups.find(hasChartData);
  const fromUrl = groups.find(
    (g) => g.platform === platformParam && hasChartData(g),
  );
  const active = fromUrl ?? firstWithData;

  if (!active) return null;

  const charts = active.charts.filter((c) => c.points.length > 1);

  return (
    <div className="flex flex-col gap-5">
      {groups.length > 1 && (
        <div
          role="tablist"
          aria-label={t('platformSelectorLabel')}
          className="flex flex-wrap gap-1"
        >
          {groups.map((group) => {
            const hasData = hasChartData(group);
            const on = group.platform === active.platform;

            const tab = (
              <button
                type="button"
                role="tab"
                aria-selected={on}
                aria-disabled={!hasData}
                tabIndex={hasData ? 0 : -1}
                onClick={() =>
                  hasData && replaceParams({ platform: group.platform })
                }
                className={cn(
                  'border px-3 py-1.5 font-mono text-[0.7rem] tracking-wide whitespace-nowrap uppercase',
                  on
                    ? 'border-primary/40 bg-accent text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                  !hasData && 'cursor-not-allowed opacity-45',
                )}
              >
                {group.label}
              </button>
            );

            if (hasData) {
              return <div key={group.platform}>{tab}</div>;
            }

            return (
              <Tooltip key={group.platform}>
                <TooltipTrigger asChild>
                  <div>{tab}</div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('platformChartEmpty', { platform: group.label })}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      <p className="font-mono text-[0.68rem] text-muted-foreground">
        {t('chartsSource', { store: active.store })}
      </p>

      <div className="flex flex-col gap-7">
        {charts.map((chart) => (
          <RangedChart
            key={`${active.platform}-${chart.key}`}
            points={chart.points}
            label={chart.label}
            cumulative={chart.cumulative}
            range={range}
            onRangeChange={(next) => replaceParams({ range: next })}
            ariaLabel={t('chartAlt', { series: chart.label })}
          />
        ))}
      </div>
    </div>
  );
}

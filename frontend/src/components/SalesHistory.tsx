import { useTranslations, useFormatter } from 'next-intl';
import type { SalesHistoryPoint } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Timeline of cumulative sales over time. Source provenance is intentionally
 * not displayed — only the date and the figure — to keep the data pipeline
 * opaque to end users.
 */
export function SalesHistory({
  history,
  todayEstimate,
}: {
  history: SalesHistoryPoint[];
  todayEstimate: { low: number; high: number } | null;
}) {
  const t = useTranslations('salesHistory');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  // Keep only dated, lifetime/global figures; undated or per-platform points
  // would expose the underlying pipeline.
  const datedHistory = history.filter((p) => p.reportedAt !== null);

  if (datedHistory.length === 0 && !todayEstimate) return null;

  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
  const range = (low: number, high: number) =>
    low === high ? compact(low) : `${compact(low)} – ${compact(high)}`;

  const formatPointDate = (iso: string): string =>
    format.dateTime(new Date(iso), { year: 'numeric', month: 'short' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          {t('title')}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {datedHistory.map((point, i) => (
            <li
              key={`${point.reportedAt}-${i}`}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className="bg-primary mt-1 size-2.5 shrink-0 rounded-full"
                />
                <span
                  aria-hidden
                  className="bg-border mt-1 w-px flex-1"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time
                    dateTime={point.reportedAt!}
                    className="text-muted-foreground text-xs font-medium tracking-wide uppercase tabular-nums"
                  >
                    {formatPointDate(point.reportedAt!)}
                  </time>
                  <span className="text-lg font-semibold tabular-nums">
                    {compact(point.units)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {tCommon('units')}
                  </span>
                </div>
              </div>
            </li>
          ))}

          {todayEstimate && (
            <li className="relative flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className="border-primary/60 mt-1 size-2.5 shrink-0 rounded-full border-2 border-dashed bg-transparent"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('today')}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {range(todayEstimate.low, todayEstimate.high)}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {t('estimated')}
                  </Badge>
                </div>
              </div>
            </li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}

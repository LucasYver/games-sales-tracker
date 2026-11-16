'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import type { HubKind } from '@/lib/api';
import { monthDate } from '@/lib/compare';
import {
  STORES,
  STORE_COLORS,
  recentTotal,
  releasedBefore2017,
  type StudioTotals,
  type Store,
  type TimelineGame,
} from '@/lib/studio-timeline';

type SortKey = 'game' | 'release' | Store | 'total' | 'share' | 'recent' | 'players' | 'lastPeak' | 'sales';
type SortDir = 'asc' | 'desc';
type Sort = { key: SortKey; dir: SortDir };

const DEFAULT_SORT: Sort = { key: 'total', dir: 'desc' };

/** The value a column sorts on; null (no figure) always goes to the bottom. */
function sortValue(g: TimelineGame, key: SortKey): number | string | null {
  switch (key) {
    case 'game':
      return g.name;
    case 'release':
      return g.releaseMonth;
    case 'total':
    case 'share':
      return g.total || null;
    case 'recent':
      return recentTotal(g) || null;
    case 'players':
      return g.playersPeak || null;
    case 'lastPeak':
      return g.lastMonthPeak || null;
    case 'sales':
      return g.units || null;
    default:
      return g.counts[key] || null;
  }
}

function sortGames(games: TimelineGame[], { key, dir }: Sort): TimelineGame[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...games].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else {
      const diff = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      if (diff !== 0) return sign * diff;
    }
    return b.total - a.total || a.name.localeCompare(b.name);
  });
}

/** A column header that sorts the table: first click on the column's natural order, next one reverses it. */
function SortTh({
  sortKey,
  sort,
  onSort,
  align,
  className,
  children,
}: {
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  align: 'left' | 'right';
  className: string;
  children: ReactNode;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`${className} ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-primary' : ''}`}
      >
        {children}
        <span
          aria-hidden
          className={`inline-block w-[1ch] text-[0.85em] ${active ? '' : 'opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50'}`}
        >
          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

/**
 * Every game of the studio with its count on each store, its share of the
 * studio's reviews and ratings, its last 30 days and its estimate. A game
 * without an estimate keeps its store figures; one with no figure anywhere
 * stays listed, greyed.
 */
export function StudioTimelineTable({
  kind,
  games,
  totals,
  colorOf,
}: {
  kind: HubKind;
  games: TimelineGame[];
  totals: StudioTotals;
  colorOf: Map<string, string>;
}) {
  const t = useTranslations('studioTimeline');
  const format = useFormatter();
  const n = (v: number) => format.number(v);
  const compact = (v: number) => format.number(v, { notation: 'compact', maximumFractionDigits: 1 });
  const pct = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 1 });
  const maxTotal = Math.max(1, ...games.map((g) => g.total));
  const num = 'px-3 py-2 text-right font-mono text-[0.78rem] tabular-nums whitespace-nowrap';
  const head =
    'px-3 py-2 font-mono text-[0.66rem] font-normal tracking-wider whitespace-nowrap text-muted-foreground uppercase';
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const rows = useMemo(() => sortGames(games, sort), [games, sort]);
  const onSort = (key: SortKey) => {
    const dir: SortDir =
      sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'game' ? 'asc' : 'desc';
    setSort({ key, dir });
    trackEvent('studio_timeline_option', { option: 'sort', value: `${key}_${dir}` });
  };
  const th = { sort, onSort, className: head };

  return (
    <section aria-labelledby="studio-table-title" className="border-b border-border px-4 py-5">
      <h2 id="studio-table-title" className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
        {t('tableTitle')}
      </h2>
      <div className="overflow-x-auto rounded-[3px] border border-border">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="bg-surface-hi">
            <tr>
              <SortTh {...th} sortKey="game" align="left">{t('col.game')}</SortTh>
              <SortTh {...th} sortKey="release" align="left">{t('col.release')}</SortTh>
              {STORES.map((s) => (
                <SortTh key={s} {...th} sortKey={s} align="right">{t(`store.${s}`)}</SortTh>
              ))}
              <SortTh {...th} sortKey="total" align="right">{t('col.total')}</SortTh>
              <SortTh {...th} sortKey="share" align="left">{t('col.share', { kind })}</SortTh>
              <SortTh {...th} sortKey="recent" align="right">{t('col.recent')}</SortTh>
              <SortTh {...th} sortKey="players" align="right">{t('col.players')}</SortTh>
              <SortTh {...th} sortKey="lastPeak" align="right">{t('col.lastPeak')}</SortTh>
              <SortTh {...th} sortKey="sales" align="right">{t('col.sales')}</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const none = g.total === 0;
              const recent = recentTotal(g);
              return (
                <tr
                  key={g.slug}
                  className={`border-t border-border-soft even:bg-surface-alt ${none ? 'text-muted-foreground' : ''}`}
                >
                  <th scope="row" className="max-w-64 px-3 py-2 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ background: colorOf.get(g.slug) ?? 'var(--border)' }}
                      />
                      <Link href={`/game/${g.slug}`} className="truncate font-semibold text-foreground hover:text-primary">
                        {g.name}
                      </Link>
                    </span>
                  </th>
                  <td className="px-3 py-2 font-mono text-[0.75rem] whitespace-nowrap text-muted-foreground">
                    {g.releaseMonth != null
                      ? format.dateTime(monthDate(g.releaseMonth), { month: 'short', year: 'numeric', timeZone: 'UTC' })
                      : '—'}
                  </td>
                  {STORES.map((s) => (
                    <td key={s} className={`${num} ${g.counts[s] ? '' : 'text-text-faint'}`}>
                      {g.counts[s] ? n(g.counts[s]) : '—'}
                    </td>
                  ))}
                  <td className={`${num} font-bold`}>{none ? t('noFigure') : n(g.total)}</td>
                  <td className="px-3 py-2">
                    {none ? (
                      <span className="font-mono text-[0.75rem]">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="flex h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-border-soft">
                          {STORES.map((s) => (
                            <span
                              key={s}
                              className="h-full"
                              style={{ width: `${(g.counts[s] / maxTotal) * 100}%`, background: STORE_COLORS[s] }}
                            />
                          ))}
                        </span>
                        <span className="w-12 text-right font-mono text-[0.72rem] text-muted-foreground tabular-nums">
                          {pct(g.total / totals.total)}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className={num}>{recent > 0 ? `+${n(recent)}` : '—'}</td>
                  <td className={`${num} ${g.playersPeak ? '' : 'text-text-faint'}`}>
                    {g.playersPeak ? n(g.playersPeak) : '—'}
                  </td>
                  <td className={`${num} ${g.lastMonthPeak ? '' : 'text-text-faint'}`}>
                    {g.lastMonthPeak ? n(g.lastMonthPeak) : '—'}
                  </td>
                  <td
                    className={`${num} ${g.units ? 'font-bold text-primary' : 'text-[0.72rem] text-muted-foreground'}`}
                  >
                    {g.units ? compact(g.units) : releasedBefore2017(g) ? t('before2017') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.68rem] text-muted-foreground">
        <span>{t('shareLegend')}</span>
        {STORES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-3.5 rounded-full" style={{ background: STORE_COLORS[s] }} />
            {t(`store.${s}`)}
          </span>
        ))}
      </div>
      <p className="mt-2 max-w-[110ch] font-mono text-[0.72rem] leading-relaxed text-muted-foreground">
        {t('tableNote')}
      </p>
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  maxUpTo,
  monthDate,
  valueAt,
  type CompareGame,
  type CompareSeries,
} from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Segmented } from './Segmented';
import { useAgeText } from './useAgeText';

type When = 'today' | 'sameAge';

interface Cell {
  /** Number used to rank the two games; null when there is nothing to rank. */
  value: number | null;
  text: string;
  sub?: string;
  muted?: boolean;
}

interface Row {
  label: string;
  sub?: string;
  cells: [Cell, Cell];
  /** Rank the two values (bar, bold leader, ratio). Off for prices and text. */
  rank?: boolean;
}

interface Group {
  label: string;
  note?: string;
  rows: Row[];
}

/** Value of a series at month `m` after launch, if tracking had started by then. */
function atAge(series: CompareSeries, m: number): number | null {
  const first = series.aligned[0]?.[0];
  if (first == null || first > m) return null;
  return valueAt(series.aligned, m);
}

/**
 * Side-by-side figures. "Today" compares the latest figures; "same age"
 * compares both games the same number of months after their launch, which
 * removes the head start of the older game.
 */
export function CompareTable({
  games,
  colors,
}: {
  games: readonly [CompareGame, CompareGame];
  colors: readonly [string, string];
}) {
  const t = useTranslations('compare');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const ageText = useAgeText();
  const [whenChoice, setWhen] = useState<When>('today');

  const [A, B] = games;
  const ages = games.map((g) => g.ageMonths);
  const same =
    ages[0] != null && ages[1] != null ? Math.min(ages[0], ages[1]) : null;
  const when: When = same != null && same > 0 ? whenChoice : 'today';

  const num = (v: number | null | undefined, sub?: string): Cell =>
    v != null && v > 0
      ? { value: v, text: format.number(v), sub }
      : { value: null, text: t('notAvailable'), muted: true };
  const text = (value: string | null | undefined, sub?: string): Cell =>
    value ? { value: null, text: value, sub } : { value: null, text: '—', muted: true };
  const noHistory: Cell = {
    value: null,
    text: t('notAvailable'),
    sub: t('noHistoryAtAge'),
    muted: true,
  };
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const month = (iso: string) =>
    format.dateTime(new Date(iso), { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const longDate = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const score = (s: number | null | undefined) =>
    s != null ? t('score', { score: format.number(s, { maximumFractionDigits: 2 }) }) : undefined;
  const onPlatform = (g: CompareGame, p: 'PLAYSTATION' | 'XBOX') => g.platforms.includes(p);
  const store = (g: CompareGame, p: 'PLAYSTATION' | 'XBOX'): Cell => {
    if (!onPlatform(g, p)) return { value: null, text: t('notOnPlatform'), muted: true };
    const r = p === 'PLAYSTATION' ? g.playstation : g.xbox;
    return num(r?.count, score(r?.score));
  };
  const price = (g: CompareGame): Cell => {
    if (g.isFree) return text(tCommon('freeToPlay'));
    if (!g.price) return text(null);
    return text(
      format.number(g.price.final / 100, { style: 'currency', currency: g.price.currency }),
    );
  };
  const pair = (f: (g: CompareGame) => Cell): [Cell, Cell] => [f(A), f(B)];

  let groups: Group[];
  let note: string;
  if (when === 'today') {
    const older = (A.ageMonths ?? -1) >= (B.ageMonths ?? -1) ? A : B;
    note =
      A.ageMonths != null && B.ageMonths != null && A.ageMonths !== B.ageMonths
        ? t('todayNote', {
            a: A.name,
            ageA: ageText(A.ageMonths),
            b: B.name,
            ageB: ageText(B.ageMonths),
            older: older.name,
          })
        : t('todayNoteEven');
    groups = [
      {
        label: t('groupSteam'),
        note: t('groupSteamNote'),
        rows: [
          { label: t('rowReviews'), sub: t('rowReviewsSub'), rank: true, cells: pair((g) => num(g.steamReviews)) },
          {
            label: t('rowPeak'),
            sub: t('rowPeakSub'),
            rank: true,
            cells: pair((g) => num(g.peakCcu?.value, g.peakCcu ? month(g.peakCcu.at) : undefined)),
          },
          {
            label: t('rowRecent'),
            sub: t('rowRecentSub'),
            rank: true,
            cells: pair((g) => num(g.recentCcu?.value, g.recentCcu ? day(g.recentCcu.at) : undefined)),
          },
          { label: t('rowFollowers'), rank: true, cells: pair((g) => num(g.followers)) },
          {
            label: t('rowPlaytime'),
            sub: t('rowPlaytimeSub'),
            rank: true,
            cells: pair((g) => {
              const hours = g.playtimeMinutes != null ? Math.round(g.playtimeMinutes / 60) : null;
              return hours ? { value: hours, text: t('hours', { n: hours }) } : num(null);
            }),
          },
        ],
      },
      {
        label: t('groupConsoles'),
        note: t('groupConsolesNote'),
        rows: [
          ...(games.some((g) => onPlatform(g, 'PLAYSTATION'))
            ? [{ label: t('rowPs'), rank: true, cells: pair((g) => store(g, 'PLAYSTATION')) }]
            : []),
          ...(games.some((g) => onPlatform(g, 'XBOX'))
            ? [{ label: t('rowXbox'), rank: true, cells: pair((g) => store(g, 'XBOX')) }]
            : []),
        ],
      },
      {
        label: t('groupSheet'),
        rows: [
          { label: t('rowPrice'), cells: pair(price) },
          {
            label: t('rowAge'),
            sub: t('rowAgeSub'),
            cells: pair((g) => text(g.ageMonths != null ? ageText(g.ageMonths) : tCommon('upcoming'))),
          },
          { label: t('rowRelease'), cells: pair((g) => text(g.releaseDate ? longDate(g.releaseDate) : null)) },
          { label: t('rowStudio'), cells: pair((g) => text(g.developer)) },
          { label: t('rowPublisher'), cells: pair((g) => text(g.publisher)) },
        ],
      },
    ];
  } else {
    const m = same as number;
    const momentOf = (g: CompareGame) =>
      g.releaseMonth != null
        ? format.dateTime(monthDate(g.releaseMonth + m), { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : '';
    const at = (g: CompareGame, key: keyof CompareGame['series']): Cell => {
      const v = atAge(g.series[key], m);
      return v != null ? num(v) : noHistory;
    };
    note = t('sameAgeNote', { n: m, a: A.name, dateA: momentOf(A), b: B.name, dateB: momentOf(B) });
    groups = [
      {
        label: t('groupSteam'),
        note: t('groupSteamNote'),
        rows: [
          {
            label: t('rowReviews'),
            sub: t('rowReviewsSubAge', { n: m }),
            rank: true,
            cells: pair((g) => at(g, 'reviews')),
          },
          {
            label: t('rowPeak'),
            sub: t('rowPeakSubAge', { n: m }),
            rank: true,
            cells: pair((g) => {
              const first = g.series.ccu.aligned[0]?.[0];
              return first != null && first <= m ? num(maxUpTo(g.series.ccu.aligned, m)) : noHistory;
            }),
          },
          {
            label: t('rowMonth', { n: m }),
            sub: t('rowMonthSub'),
            rank: true,
            cells: pair((g) => at(g, 'ccu')),
          },
          { label: t('rowFollowers'), rank: true, cells: pair((g) => at(g, 'followers')) },
        ],
      },
      {
        label: t('groupConsoles'),
        note: t('groupConsolesNote'),
        rows: [
          ...(games.some((g) => onPlatform(g, 'PLAYSTATION'))
            ? [{
                label: t('rowPs'),
                rank: true,
                cells: pair((g) =>
                  onPlatform(g, 'PLAYSTATION') ? at(g, 'psRatings') : store(g, 'PLAYSTATION'),
                ),
              }]
            : []),
          ...(games.some((g) => onPlatform(g, 'XBOX'))
            ? [{
                label: t('rowXbox'),
                rank: true,
                cells: pair((g) => (onPlatform(g, 'XBOX') ? at(g, 'xboxRatings') : store(g, 'XBOX'))),
              }]
            : []),
        ],
      },
      {
        label: t('groupSheet'),
        rows: [
          { label: t('rowMoment'), cells: pair((g) => text(momentOf(g))) },
          { label: t('rowRelease'), cells: pair((g) => text(g.releaseDate ? longDate(g.releaseDate) : null)) },
          { label: t('rowStudio'), cells: pair((g) => text(g.developer)) },
        ],
      },
    ];
  }

  // A row with nothing on either side says nothing: drop it, then empty groups.
  const shown = groups
    .map((g) => ({
      ...g,
      rows: g.rows.filter((r) => r.cells.some((c) => !c.muted || c.sub)),
    }))
    .filter((g) => g.rows.length > 0);

  const columns = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-4';

  return (
    <section
      aria-labelledby="compare-table-title"
      className="flex flex-col gap-3 border-b border-border px-4 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="compare-table-title"
          className="font-mono text-[0.8rem] font-bold tracking-wider uppercase"
        >
          {t('tableTitle')}
        </h2>
        {same != null && same > 0 && (
          <Segmented<When>
            label={t('whenLabel')}
            value={when}
            onChange={(v) => {
              setWhen(v);
              trackEvent('compare_option', { option: 'table', value: v });
            }}
            options={[
              { value: 'today', label: t('whenToday') },
              { value: 'sameAge', label: t('whenSameAge', { n: same }) },
            ]}
          />
        )}
      </div>
      <p className="text-[0.82rem] text-muted-foreground">{note}</p>

      <div className="overflow-hidden rounded-[3px] border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-[1_1_200px] font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
            {t('colMetric')}
          </div>
          <div className={`min-w-0 flex-[999_1_420px] ${columns}`}>
            {games.map((g, i) => (
              <div key={g.slug} className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: colors[i] }}
                />
                <span className="truncate text-[0.82rem] font-semibold">{g.name}</span>
              </div>
            ))}
            <div className="text-end font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
              {t('colGap')}
            </div>
          </div>
        </div>

        {shown.map((group) => (
          <div key={group.label}>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-border bg-surface-alt px-4 pt-3.5 pb-2">
              <span className="font-mono text-[0.68rem] font-semibold tracking-widest text-primary uppercase">
                {group.label}
              </span>
              {group.note && (
                <span className="text-xs text-muted-foreground">{group.note}</span>
              )}
            </div>
            {group.rows.map((row) => {
              const [a, b] = row.cells;
              const ranked = row.rank && a.value != null && b.value != null;
              const max = ranked ? Math.max(a.value!, b.value!) : 1;
              const lead = ranked ? (a.value! >= b.value! ? 0 : 1) : null;
              const ratio = ranked
                ? Math.max(a.value!, b.value!) / Math.min(a.value!, b.value!)
                : null;
              return (
                <div
                  key={row.label}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-soft px-4 py-3"
                >
                  <div className="min-w-0 flex-[1_1_200px]">
                    <p className="text-sm font-medium text-foreground">{row.label}</p>
                    {row.sub && <p className="text-xs text-muted-foreground">{row.sub}</p>}
                  </div>
                  <div className={`min-w-0 flex-[999_1_420px] ${columns}`}>
                    {row.cells.map((cell, i) => (
                      <div key={i} className="min-w-0">
                        <p
                          className={`font-mono text-[0.95rem] tabular-nums ${
                            cell.muted
                              ? 'text-muted-foreground'
                              : lead === i
                                ? 'font-bold text-foreground'
                                : 'font-medium text-foreground/85'
                          }`}
                        >
                          {cell.text}
                        </p>
                        {cell.sub && (
                          <p className="font-mono text-xs text-muted-foreground">{cell.sub}</p>
                        )}
                        {ranked && (
                          <div className="mt-1.5 h-1 rounded-full bg-border-soft">
                            <div
                              className="h-1 rounded-full"
                              style={{
                                width: `${((cell.value as number) / max) * 100}%`,
                                background: colors[i],
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <div
                      className="text-end font-mono text-[0.82rem] font-semibold tabular-nums"
                      style={{ color: lead != null ? colors[lead] : undefined }}
                    >
                      {ratio != null
                        ? `×${format.number(ratio, { maximumFractionDigits: ratio >= 10 ? 0 : 1 })}`
                        : <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

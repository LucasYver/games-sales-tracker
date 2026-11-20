'use client';

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { ChevronDown, Search, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { GenreOption, SortOption } from '@/lib/api';
import { Checkbox } from '@/components/ui/checkbox';
import {
  EMPTY_FILTERS,
  LISTING_FILTER_KEYS,
  LISTING_MODES,
  LISTING_PLATFORMS,
  LISTING_TABS,
  POPULARITY_LEVELS,
  countActiveFilters,
  listingQuery,
  type ListingFilters,
} from '@/lib/listing-filters';

const MIN_YEAR = 1990;

interface Props {
  filters: ListingFilters;
  genres: GenreOption[];
  total: number;
  /** The table and pagination, dimmed while a new page loads. */
  children: React.ReactNode;
}

/**
 * Tabs (the sort) and a row of filter pills above the home listing. Each
 * pill opens a panel whose choices apply when it closes, so several boxes
 * can be ticked in one go. Active pills carry a × to remove them in a click.
 */
export function ListingFilterBar({ filters, genres, total, children }: Props) {
  const t = useTranslations('filter');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(filters);

  const apply = (next: ListingFilters) => {
    const before = listingQuery(shown);
    const after = listingQuery(next);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [...keys].filter((k) => before[k] !== after[k]);
    if (changed.length === 0) return;
    for (const key of changed) {
      trackEvent('filter_change', {
        filter: key,
        value: after[key] ?? 'default',
      });
    }
    const params = new URLSearchParams(searchParams.toString());
    for (const key of LISTING_FILTER_KEYS) params.delete(key);
    params.delete('page');
    for (const [key, value] of Object.entries(after)) params.set(key, value);
    const qs = params.toString();
    startTransition(() => {
      setShown(next);
      router.push((qs ? `${pathname}?${qs}` : pathname) as never, {
        scroll: false,
      });
    });
  };

  const patch = (part: Partial<ListingFilters>) => apply({ ...shown, ...part });

  const activeCount = countActiveFilters(shown);

  const resetAll = () => {
    trackEvent('filter_reset');
    apply({ ...EMPTY_FILTERS, sort: shown.sort });
  };

  // A filter combination that returns nothing: what visitors look for and
  // do not find. Sent once per combination.
  const lastEmpty = useRef<string | null>(null);
  const emptyKey =
    total === 0 && countActiveFilters(filters) > 0
      ? new URLSearchParams(listingQuery(filters)).toString()
      : null;
  useEffect(() => {
    if (emptyKey && lastEmpty.current !== emptyKey) {
      lastEmpty.current = emptyKey;
      trackEvent('filter_no_result', { filters: emptyKey });
    }
  }, [emptyKey]);

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t('sortLabel')}
        className="-mx-4 flex gap-5 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] border-border px-4 sm:mx-0 sm:px-0"
      >
        {LISTING_TABS.map((sort) => (
          <SortTab
            key={sort}
            sort={sort}
            active={shown.sort === sort}
            onSelect={() => patch({ sort })}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          <PlatformFilter filters={shown} onApply={patch} />
          <GenreFilter filters={shown} genres={genres} onApply={patch} />
          <YearFilter filters={shown} onApply={patch} />
          <ModeFilter filters={shown} onApply={patch} />
          <MoreFilter filters={shown} onApply={patch} />
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span aria-live="polite" className="tabular-nums">
            {t('resultCount', { count: total })}
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="underline-offset-2 transition hover:text-foreground hover:underline"
            >
              {t('resetAll')}
            </button>
          )}
        </div>
      </div>

      <div
        aria-busy={isPending}
        className={cn(
          'transition-opacity',
          isPending && 'pointer-events-none opacity-50',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function SortTab({
  sort,
  active,
  onSelect,
}: {
  sort: SortOption;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('filter');
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        '-mb-px shrink-0 border-b-2 py-2 text-sm whitespace-nowrap transition',
        active
          ? 'border-foreground font-semibold text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {t(`tab_${sort}`)}
    </button>
  );
}

// Pills -----------------------------------------------------------------

function PlatformFilter({
  filters: f,
  onApply,
}: {
  filters: ListingFilters;
  onApply: (p: Partial<ListingFilters>) => void;
}) {
  const t = useTranslations('filter');
  const tPlatform = useTranslations('platform');
  const [draft, setDraft] = useState({
    platforms: f.platforms,
    exclusive: f.exclusive,
  });
  const summary = f.platforms.length
    ? `${f.platforms.map((p) => tPlatform(p)).join(', ')}${f.exclusive ? ` · ${t('exclusiveShort')}` : ''}`
    : null;
  return (
    <FilterPill
      label={t('platformLabel')}
      summary={summary}
      onOpen={() =>
        setDraft({ platforms: f.platforms, exclusive: f.exclusive })
      }
      onCommit={() =>
        onApply({
          platforms: draft.platforms,
          exclusive: draft.exclusive && draft.platforms.length > 0,
        })
      }
      onClear={() => onApply({ platforms: [], exclusive: false })}
    >
      <CheckList
        options={LISTING_PLATFORMS.map((p) => ({
          value: p,
          label: tPlatform(p),
        }))}
        selected={draft.platforms}
        onChange={(platforms) => setDraft((d) => ({ ...d, platforms }))}
      />
      {draft.platforms.length > 0 && (
        <label className="mt-1 flex cursor-pointer items-start gap-2.5 border-t border-border pt-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={draft.exclusive}
            onCheckedChange={(v) =>
              setDraft((d) => ({ ...d, exclusive: v === true }))
            }
          />
          <span>
            {t('exclusiveLabel')}
            <span className="block text-xs text-muted-foreground">
              {t('exclusiveHint')}
            </span>
          </span>
        </label>
      )}
    </FilterPill>
  );
}

function GenreFilter({
  filters: f,
  genres: options,
  onApply,
}: {
  filters: ListingFilters;
  genres: GenreOption[];
  onApply: (p: Partial<ListingFilters>) => void;
}) {
  const t = useTranslations('filter');
  const format = useFormatter();
  const [draft, setDraft] = useState(f.genres);
  const [query, setQuery] = useState('');
  if (options.length === 0) return null;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? options.filter((g) => g.name.toLowerCase().includes(needle))
    : options;
  const summary =
    f.genres.length === 0
      ? null
      : f.genres.length === 1
        ? f.genres[0]
        : t('genreCount', { count: f.genres.length });
  return (
    <FilterPill
      label={t('genreLabel')}
      summary={summary}
      onOpen={() => {
        setDraft(f.genres);
        setQuery('');
      }}
      onCommit={() => onApply({ genres: draft })}
      onClear={() => onApply({ genres: [] })}
    >
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('genreSearch')}
          aria-label={t('genreSearch')}
          className="h-8 w-full rounded-md border border-input bg-transparent ps-8 pe-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>
      <div className="-me-1 max-h-64 overflow-y-auto pe-1">
        {visible.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            {t('genreNoMatch')}
          </p>
        ) : (
          <CheckList
            options={visible.map((g) => ({
              value: g.name,
              label: g.name,
              count: format.number(g.count),
            }))}
            selected={draft}
            onChange={setDraft}
          />
        )}
      </div>
    </FilterPill>
  );
}

function YearFilter({
  filters: f,
  onApply,
}: {
  filters: ListingFilters;
  onApply: (p: Partial<ListingFilters>) => void;
}) {
  const t = useTranslations('filter');
  const [draft, setDraft] = useState({ min: f.yearMin, max: f.yearMax });
  const current = new Date().getFullYear();
  const presets = [current, current - 1, current - 2];
  const years = useMemo(
    () => Array.from({ length: current - MIN_YEAR + 1 }, (_, i) => current - i),
    [current],
  );
  const summary =
    f.yearMin == null && f.yearMax == null
      ? null
      : f.yearMin === f.yearMax
        ? String(f.yearMin)
        : f.yearMin == null
          ? t('yearUntil', { year: String(f.yearMax) })
          : f.yearMax == null
            ? t('yearSince', { year: String(f.yearMin) })
            : `${f.yearMin}–${f.yearMax}`;
  const selectClass =
    'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30';
  return (
    <FilterPill
      label={t('yearLabel')}
      summary={summary}
      onOpen={() => setDraft({ min: f.yearMin, max: f.yearMax })}
      onCommit={() => {
        let { min, max } = draft;
        if (min != null && max != null && min > max) [min, max] = [max, min];
        onApply({ yearMin: min, yearMax: max });
      }}
      onClear={() => onApply({ yearMin: null, yearMax: null })}
    >
      <div className="flex flex-wrap gap-1.5">
        {presets.map((y) => (
          <Chip
            key={y}
            active={draft.min === y && draft.max === y}
            onClick={() => setDraft({ min: y, max: y })}
          >
            {y}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('yearFrom')}
          <select
            className={selectClass}
            value={draft.min ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                min: e.target.value ? Number(e.target.value) : null,
              }))
            }
          >
            <option value="">{t('yearAny')}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('yearTo')}
          <select
            className={selectClass}
            value={draft.max ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                max: e.target.value ? Number(e.target.value) : null,
              }))
            }
          >
            <option value="">{t('yearAny')}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
    </FilterPill>
  );
}

function ModeFilter({
  filters: f,
  onApply,
}: {
  filters: ListingFilters;
  onApply: (p: Partial<ListingFilters>) => void;
}) {
  const t = useTranslations('filter');
  const tMode = useTranslations('gamePage.gameMode');
  const [draft, setDraft] = useState(f.modes);
  const summary = f.modes.length
    ? f.modes.map((m) => tMode(m)).join(', ')
    : null;
  return (
    <FilterPill
      label={t('modeLabel')}
      summary={summary}
      onOpen={() => setDraft(f.modes)}
      onCommit={() => onApply({ modes: draft })}
      onClear={() => onApply({ modes: [] })}
    >
      <CheckList
        options={LISTING_MODES.map((m) => ({ value: m, label: tMode(m) }))}
        selected={draft}
        onChange={setDraft}
      />
    </FilterPill>
  );
}

function MoreFilter({
  filters: f,
  onApply,
}: {
  filters: ListingFilters;
  onApply: (p: Partial<ListingFilters>) => void;
}) {
  const t = useTranslations('filter');
  const format = useFormatter();
  const [draft, setDraft] = useState({
    minReviews: f.minReviews,
    hideFree: f.hideFree,
  });
  const active = (f.minReviews > 0 ? 1 : 0) + (f.hideFree ? 1 : 0);
  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 0 });
  return (
    <FilterPill
      label={t('moreLabel')}
      summary={active ? `${t('moreLabel')} · ${active}` : null}
      onOpen={() =>
        setDraft({ minReviews: f.minReviews, hideFree: f.hideFree })
      }
      onCommit={() => onApply(draft)}
      onClear={() => onApply({ minReviews: 0, hideFree: false })}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs text-muted-foreground">
          {t('popularityLabel')}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={draft.minReviews === 0}
            onClick={() => setDraft((d) => ({ ...d, minReviews: 0 }))}
          >
            {t('popularityAny')}
          </Chip>
          {POPULARITY_LEVELS.map((n) => (
            <Chip
              key={n}
              active={draft.minReviews === n}
              onClick={() => setDraft((d) => ({ ...d, minReviews: n }))}
            >
              {t('popularityLevel', { count: compact(n) })}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('popularityHint')}</p>
      </fieldset>
      <label className="flex cursor-pointer items-center gap-2.5 border-t border-border pt-3 text-sm">
        <Checkbox
          checked={draft.hideFree}
          onCheckedChange={(v) =>
            setDraft((d) => ({ ...d, hideFree: v === true }))
          }
        />
        {t('hideFree')}
      </label>
    </FilterPill>
  );
}

// Building blocks ---------------------------------------------------------

function FilterPill({
  label,
  summary,
  onOpen,
  onCommit,
  onClear,
  children,
}: {
  label: string;
  /** What is picked; null when the filter is off. */
  summary: string | null;
  onOpen: () => void;
  onCommit: () => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('filter');
  const [open, setOpen] = useState(false);
  const active = summary != null;

  const onOpenChange = (next: boolean) => {
    if (next) {
      onOpen();
      setOpen(true);
    } else {
      setOpen(false);
      onCommit();
    }
  };

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border text-sm transition',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border text-foreground hover:bg-accent',
      )}
    >
      <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={active ? `${label} : ${summary}` : undefined}
            className={cn(
              'inline-flex h-8 max-w-56 items-center gap-1.5 rounded-full ps-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active ? 'pe-1.5' : 'pe-2.5',
            )}
          >
            <span className="truncate">{summary ?? label}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3.5 shrink-0 opacity-70 transition',
                open && 'rotate-180',
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in"
          >
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            {children}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t('clear')}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                {t('apply')}
              </button>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('removeFilter', { filter: label })}
          className="me-1 inline-flex size-6 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function CheckList({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string; count?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <ul className="flex flex-col">
      {options.map((o) => {
        const checked = selected.includes(o.value);
        return (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm hover:bg-accent">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) =>
                  onChange(
                    v === true
                      ? [...selected, o.value]
                      : selected.filter((s) => s !== o.value),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.count && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {o.count}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-7 rounded-full border px-3 text-xs transition',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

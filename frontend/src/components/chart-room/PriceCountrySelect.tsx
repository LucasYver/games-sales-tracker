'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { PriceStore, RegionalPrice } from '@/lib/api';
import { trackEvent } from '@/lib/analytics';
import { flagEmoji } from '@/lib/flag';

const STORAGE_KEY = 'steam-price-country';


export function PriceCountrySelect({
  countries,
  value,
}: {
  countries: RegionalPrice[];
  value: string;
}) {
  const t = useTranslations('gamePage');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');

  const names = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region' }),
    [locale],
  );

  const labelFor = (country: string) =>
    names.of(country.toUpperCase()) ?? country.toUpperCase();

  useEffect(() => {
    if (searchParams.get('cc')) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY)?.toLowerCase();
      if (!stored || stored === value) return;
      if (!countries.some((c) => c.country === stored)) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('cc', stored);
      router.replace(`${pathname}?${params.toString()}` as never, {
        scroll: false,
      });
    } catch {
      /* private mode */
    }
  }, [countries, pathname, router, searchParams, value]);

  const options = useMemo(() => {
    if (countries.some((row) => row.country === value)) return countries;
    return [
      {
        country: value,
        currency: '',
        initial: 0,
        final: 0,
        discountPercent: 0,
      },
      ...countries,
    ];
  }, [countries, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = [...options].sort((a, b) =>
      labelFor(a.country).localeCompare(labelFor(b.country), locale),
    );
    if (!q) return rows;
    return rows.filter((row) => {
      const name = labelFor(row.country).toLowerCase();
      return (
        row.country.includes(q) ||
        row.currency.toLowerCase().includes(q) ||
        name.includes(q)
      );
    });
  }, [locale, names, options, query]);

  if (countries.length === 0) return null;

  const selected =
    options.find((c) => c.country === value) ?? options[0];

  const apply = (country: string) => {
    trackEvent('price_country_change', { country });
    try {
      localStorage.setItem(STORAGE_KEY, country);
    } catch {
      /* private mode */
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('cc', country);
    router.replace(`${pathname}?${params.toString()}` as never, {
      scroll: false,
    });
  };

  return (
    <Select value={value} onValueChange={apply}>
      <SelectTrigger
        size="sm"
        aria-label={t('priceCountry')}
        className="min-w-44 font-mono text-xs"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden>{flagEmoji(selected.country)}</span>
          <span>{labelFor(selected.country)}</span>
          {selected.currency ? (
            <span className="text-muted-foreground">{selected.currency}</span>
          ) : null}
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="min-w-64">
        <div className="sticky top-0 z-10 bg-popover p-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t('priceCountrySearch')}
            className="h-7 text-xs"
          />
        </div>
        {filtered.map((row) => (
          <SelectItem key={row.country} value={row.country}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden>{flagEmoji(row.country)}</span>
              <span className="truncate">{labelFor(row.country)}</span>
              {row.currency ? (
                <span className="text-muted-foreground">{row.currency}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PriceStoreSelect({
  stores,
  value,
}: {
  /** Price already formatted by the server, so hydration sees the same text. */
  stores: Array<{ store: PriceStore; price: string | null }>;
  value: PriceStore;
}) {
  const t = useTranslations('gamePage');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (stores.length === 0) return null;

  const apply = (store: PriceStore) => {
    if (store !== value) trackEvent('price_store_change', { store });
    const params = new URLSearchParams(searchParams.toString());
    params.set('store', store);
    router.replace(`${pathname}?${params.toString()}` as never, {
      scroll: false,
    });
  };

  return (
    <div
      role="group"
      aria-label={t('priceStore')}
      className="flex flex-wrap gap-1 font-mono text-[0.7rem] tracking-wide"
    >
      {stores.map(({ store, price }) => {
        const on = store === value;
        return (
          <button
            key={store}
            type="button"
            onClick={() => apply(store)}
            aria-pressed={on}
            title={price ? undefined : t('priceStoreNotSold')}
            className={`flex items-baseline gap-1.5 border px-2 py-1.5 ${
              on
                ? 'border-border text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="uppercase">
              {store === 'xbox'
                ? t('xboxLabel')
                : store === 'playstation'
                  ? t('playstationLabel')
                  : t('steamLabel')}
            </span>
            <span className="tabular-nums">{price ?? '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Native <details> that reports its first opening: tells whether visitors
 * read the price log and the full country list at all.
 */
export function PriceDetails({
  section,
  summary,
  children,
}: {
  section: 'log' | 'regions';
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const [reported, setReported] = useState(false);
  return (
    <details
      className="group"
      onToggle={(e) => {
        if (!e.currentTarget.open || reported) return;
        setReported(true);
        trackEvent('price_section_open', { section });
      }}
    >
      <summary className="cursor-pointer list-none font-mono text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90">
          ›
        </span>{' '}
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

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

const STORAGE_KEY = 'steam-price-country';

export function flagEmoji(country: string): string {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(
    ...[...code].map((c) => 127397 + c.charCodeAt(0)),
  );
}

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
      router.replace(`${pathname}?${params.toString()}` as never);
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
    try {
      localStorage.setItem(STORAGE_KEY, country);
    } catch {
      /* private mode */
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('cc', country);
    router.replace(`${pathname}?${params.toString()}` as never);
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
  stores: PriceStore[];
  value: PriceStore;
}) {
  const t = useTranslations('gamePage');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (stores.length < 2) return null;

  const apply = (store: PriceStore) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('store', store);
    router.replace(`${pathname}?${params.toString()}` as never);
  };

  return (
    <div
      role="group"
      aria-label={t('priceStore')}
      className="flex gap-1 font-mono text-[0.7rem] tracking-wide uppercase"
    >
      {stores.map((store) => {
        const on = store === value;
        return (
          <button
            key={store}
            type="button"
            onClick={() => apply(store)}
            aria-pressed={on}
            className={`border px-2 py-1.5 ${
              on
                ? 'border-primary/40 bg-accent text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {store === 'xbox'
              ? t('xboxLabel')
              : store === 'playstation'
                ? t('playstationLabel')
                : t('steamLabel')}
          </button>
        );
      })}
    </div>
  );
}

export function RegionalPricesTable({
  countries,
}: {
  countries: RegionalPrice[];
}) {
  const t = useTranslations('gamePage');
  const locale = useLocale();
  const names = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region' }),
    [locale],
  );

  const money = (row: RegionalPrice, cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: row.currency,
    }).format(cents / 100);

  const rows = [...countries].sort((a, b) => {
    const left = names.of(a.country.toUpperCase()) ?? a.country;
    const right = names.of(b.country.toUpperCase()) ?? b.country;
    return left.localeCompare(right, locale);
  });

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-2 py-2 text-left font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('priceCountryColumn')}
            </th>
            <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('pricePaid')}
            </th>
            <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('priceDiscount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.country}
              className="border-b border-border-soft last:border-b-0"
            >
              <td className="px-2 py-2">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden>{flagEmoji(row.country)}</span>
                  {names.of(row.country.toUpperCase()) ??
                    row.country.toUpperCase()}
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.currency}
                  </span>
                </span>
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {money(row, row.final)}
                {row.discountPercent > 0 && (
                  <span className="ml-2 text-muted-foreground line-through">
                    {money(row, row.initial)}
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {row.discountPercent > 0 ? (
                  <span className="text-source-official">
                    −{row.discountPercent}%
                  </span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

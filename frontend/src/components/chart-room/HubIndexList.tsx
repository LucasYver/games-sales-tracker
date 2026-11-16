'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import type { HubIndexItem } from '@/lib/api';

/** A filter that settles on nothing is reported once, after this pause. */
const NO_RESULT_DELAY_MS = 1500;

/** Lower case, no accents, no punctuation: "Éditions" and "editions" match. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Every studio, publisher or franchise with a page, with a box that narrows
 * the list as the visitor types. All names are already on the page, so the
 * filter runs in the browser: no request, and the full list stays in the
 * HTML for search engines.
 */
export function HubIndexList({
  items,
  basePath,
}: {
  items: HubIndexItem[];
  basePath: string;
}) {
  const t = useTranslations('hubs');
  const [query, setQuery] = useState('');
  const reported = useRef(new Set<string>());
  const folded = fold(query);
  const shown = folded
    ? items.filter((item) => fold(item.name).includes(folded) || item.slug.includes(folded.replace(/ /g, '-')))
    : items;
  const hub = basePath.replace('/', '');

  // A name nobody finds may be a hub we lack: report each one once.
  useEffect(() => {
    if (folded.length < 2 || shown.length > 0 || reported.current.has(folded)) return;
    const timer = setTimeout(() => {
      reported.current.add(folded);
      trackEvent('hub_search_no_result', { hub, query: folded.slice(0, 50) });
    }, NO_RESULT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [folded, shown.length, hub]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="sr-only" htmlFor="hub-filter">
          {t('filterLabel')}
        </label>
        <input
          id="hub-filter"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('filterPlaceholder')}
          autoComplete="off"
          className="h-10 w-full max-w-sm rounded-[3px] border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <span aria-live="polite" className="font-mono text-[0.72rem] text-muted-foreground">
          {folded ? t('filterCount', { count: shown.length, total: items.length }) : ''}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('filterEmpty', { query: query.trim() })}</p>
      ) : (
        <ul className="gap-x-6 sm:columns-2 lg:columns-3">
          {shown.map((item) => (
            <li
              key={item.slug}
              className="flex break-inside-avoid justify-between gap-3 border-b border-border-soft py-2 text-sm"
            >
              <Link
                href={`${basePath}/${item.slug}`}
                className="min-w-0 font-semibold text-foreground hover:text-primary"
              >
                {item.name}
              </Link>
              <span className="shrink-0 font-mono text-[0.75rem] text-muted-foreground tabular-nums">
                {item.games}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

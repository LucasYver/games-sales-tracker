'use client';

import { useSyncExternalStore } from 'react';

/**
 * A chart or table option kept in the query string (`?metric=followers`), so
 * a shared comparison opens on the same view. Written with replaceState: no
 * navigation, no server request, no history entry per click.
 *
 * Read through useSyncExternalStore rather than `useSearchParams`, which
 * would make Next render the comparison only in the browser on this cached
 * page. The server and the first render use the defaults; the URL's choice
 * applies right after hydration.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

const currentSearch = () => window.location.search;
const serverSearch = () => '';

export function useUrlOption<V extends string>(
  key: string,
  fallback: V,
  allowed: readonly V[],
): [V, (value: V) => void] {
  const search = useSyncExternalStore(subscribe, currentSearch, serverSearch);
  const raw = new URLSearchParams(search).get(key);
  const value = raw != null && (allowed as readonly string[]).includes(raw) ? (raw as V) : fallback;

  const set = (next: V) => {
    const url = new URL(window.location.href);
    // Defaults stay out of the URL, so the plain link stays the plain link.
    if (next === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, next);
    window.history.replaceState(window.history.state, '', url);
    listeners.forEach((notify) => notify());
  };

  return [value, set];
}

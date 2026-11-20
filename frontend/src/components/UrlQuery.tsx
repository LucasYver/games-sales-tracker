'use client';

import { createContext, Suspense, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

const EMPTY = new URLSearchParams();
const UrlQueryContext = createContext<URLSearchParams>(EMPTY);

function LiveQuery({ children }: { children: ReactNode }) {
  const query = useSearchParams();
  return (
    <UrlQueryContext.Provider value={query}>{children}</UrlQueryContext.Provider>
  );
}

/**
 * Gives `useUrlQuery` the page's query string. A cached page is built without
 * a request, so Next renders anything that calls `useSearchParams` in the
 * browser only and leaves it out of the HTML (charts, price pickers). The
 * fallback renders the same children with an empty query instead: the HTML
 * holds the default view, the one a URL without a query shows, and the
 * browser then renders the real one.
 */
export function UrlQuery({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <UrlQueryContext.Provider value={EMPTY}>
          {children}
        </UrlQueryContext.Provider>
      }
    >
      <LiveQuery>{children}</LiveQuery>
    </Suspense>
  );
}

/** The page's query string, read through `UrlQuery`; empty in cached HTML. */
export function useUrlQuery(): URLSearchParams {
  return useContext(UrlQueryContext);
}

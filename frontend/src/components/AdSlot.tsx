'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * One AdSense unit. The height is reserved so the page does not jump when the
 * ad loads, and the whole block hides itself when Google has no ad to show.
 * Give it a `key` per page: a unit only requests an ad once.
 */
export function AdSlot({
  client,
  slot,
  label,
}: {
  client: string;
  slot: string;
  label: string;
}) {
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // A blocked or failed ad must never break the page.
    }
  }, []);

  return (
    <aside className="border-t border-border-soft px-4 py-3 has-[ins[data-ad-status=unfilled]]:hidden">
      <p className="mb-1 font-mono text-[0.6rem] tracking-wider text-text-faint uppercase">
        {label}
      </p>
      <div className="min-h-[100px]">
        <ins
          className="adsbygoogle block"
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="horizontal"
          data-full-width-responsive="true"
        />
      </div>
    </aside>
  );
}

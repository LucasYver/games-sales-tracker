'use client';

import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';

/**
 * An internal link to a page we push (a home banner, a tracker link on a game
 * page) that sends `promo_click`, so we know whether the push brings visitors.
 */
export function PromoLink({
  from,
  target,
  onClick,
  ...rest
}: ComponentProps<typeof Link> & {
  /** Where the click happened: "home" or a game slug. */
  from: string;
  /** The promoted page, e.g. "gta-6-sales". */
  target: string;
}) {
  return (
    <Link
      onClick={(event) => {
        trackEvent('promo_click', { from, target });
        onClick?.(event);
      }}
      {...rest}
    />
  );
}

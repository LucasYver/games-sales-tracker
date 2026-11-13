'use client';

import type { AnchorHTMLAttributes } from 'react';
import { linkDomain, trackEvent } from '@/lib/analytics';

/**
 * A link to another site that sends `outbound_click` to Vercel Analytics,
 * with the page it was clicked from and the target domain. Server pages can
 * render it in place of a plain <a>.
 */
export function OutboundLink({
  from,
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Where the click happened: a game slug, "gta-6-sales", "blog/<slug>"… */
  from: string;
  href: string;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        trackEvent('outbound_click', { from, domain: linkDomain(href) });
        onClick?.(event);
      }}
      {...rest}
    />
  );
}

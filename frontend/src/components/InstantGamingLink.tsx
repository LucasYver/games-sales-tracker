'use client';

import { useId } from 'react';
import { track } from '@vercel/analytics';

type Placement = 'price' | 'links';

/** Instant Gaming's mark, from the logo kit it gives affiliates. */
function InstantGamingMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 324 352"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={`${id}a`}
          x1="-.005"
          y1="347.983"
          x2="319.1"
          y2="166.653"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ff8a15" />
          <stop offset="1" stopColor="#ff3131" />
        </linearGradient>
        <linearGradient
          id={`${id}b`}
          x1="10.889"
          y1="218.57"
          x2="97.001"
          y2="72.088"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ff771b" />
          <stop offset="1" stopColor="#ff452b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform="matrix(1.014282 0 0 1.014282 .002703 -4.859013)">
        <path
          fill={`url(#${id}a)`}
          d="M50.082 4.795a16.72 16.72 0 0 0-7.939 2.242L8.391 26.51C.368 31.137-2.383 41.393 2.248 49.414c3.108 5.379 8.748 8.385 14.547 8.385a16.72 16.72 0 0 0 8.375-2.248l33.752-19.472c8.023-4.627 10.774-14.884 6.143-22.904-3.186-5.513-9.032-8.533-14.982-8.379zm84.151 48.289c-2.896 0-5.793.749-8.389 2.246L8.389 123.092c-8.025 4.63-10.774 14.884-6.141 22.904 3.108 5.379 8.748 8.385 14.547 8.385a16.72 16.72 0 0 0 8.373-2.248l109.063-62.922 134.232 77.443L33.556 302.176v-58.082l1.859-1.073-24.527-24.581-2.5 1.454c-5.192 2.995-8.389 8.531-8.389 14.521v96.801c0 5.991 3.197 11.526 8.389 14.521 2.596 1.498 5.493 2.246 8.391 2.246a16.770 16.770 0 0 0 8.389-2.246L310.41 181.172a16.770 16.770 0 0 0 8.391-14.520c.002-5.992-3.199-11.525-8.391-14.520l-83.609-48.236c-.179-.108-.36-.212-.543-.312L142.621 55.33a16.780 16.780 0 0 0-8.389-2.246z"
        />
        <path
          fill={`url(#${id}b)`}
          d="M184.481 118.255L15.633 215.661l-6.096 3.57 24.019 24.863 184.483-106.478z"
        />
      </g>
    </svg>
  );
}

/**
 * Affiliate link to the game's Instant Gaming page. A click is sent to Vercel
 * Analytics as the custom event `instant_gaming_click`, with the game and
 * where on the page the link was.
 */
export function InstantGamingLink({
  href,
  game,
  placement,
  label,
  note,
}: {
  href: string;
  /** Game slug, sent with the click event. */
  game: string;
  placement: Placement;
  label: string;
  /** Affiliate disclosure shown under the button. */
  note?: string;
}) {
  const onClick = () => track('instant_gaming_click', { game, placement });

  if (placement === 'links') {
    return (
      <a
        href={href}
        rel="sponsored nofollow noopener"
        target="_blank"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-[#ff5a1f] hover:underline"
      >
        <InstantGamingMark className="size-3" />
        {label}
      </a>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1 sm:ml-auto sm:items-end">
      <a
        href={href}
        rel="sponsored nofollow noopener"
        target="_blank"
        onClick={onClick}
        className="inline-flex items-center gap-2 border border-[#ff5a1f] px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-[#ff5a1f]/10"
      >
        <InstantGamingMark className="size-4" />
        {label}
        <span aria-hidden="true" className="text-muted-foreground">
          ↗
        </span>
      </a>
      {note && (
        <span className="font-mono text-[0.64rem] text-muted-foreground">
          {note}
        </span>
      )}
    </span>
  );
}

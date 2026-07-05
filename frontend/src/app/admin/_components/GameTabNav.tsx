'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'estimates', label: 'Estimates' },
  { key: 'charts', label: 'Charts' },
  { key: 'matcher', label: 'Matcher' },
  { key: 'milestones', label: 'Milestones' },
] as const;

export function GameTabNav({
  counts = {},
}: {
  counts?: Partial<Record<(typeof TABS)[number]['key'], number>>;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('tab') ?? 'overview';

  return (
    <nav className="border-border flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const on = active === t.key;
        const count = counts[t.key];
        return (
          <Link
            key={t.key}
            href={`${pathname}?tab=${t.key}`}
            scroll={false}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition-colors',
              on
                ? 'border-primary text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t.label}
            {count != null && count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] tabular-nums',
                  on
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

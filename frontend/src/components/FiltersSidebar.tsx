'use client';

import { useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GamesFilter, countActiveFilters } from '@/components/GamesFilter';
import type { GenreOption } from '@/lib/api';

interface Props {
  sort: string;
  platform: string;
  genre: string;
  status: string;
  yearMin: string;
  yearMax: string;
  minReviews: string;
  genres: GenreOption[];
}

export function FiltersSidebar(props: Props) {
  const t = useTranslations('filter');
  const [open, setOpen] = useState(false);

  const activeCount = countActiveFilters(props);

  return (
    <>
      {/* Desktop: sticky right rail */}
      <aside
        aria-label={t('title')}
        className="border-border/60 bg-card/60 sticky top-6 hidden h-fit max-h-[calc(100vh-3rem)] w-72 shrink-0 overflow-y-auto rounded-xl border p-5 shadow-sm backdrop-blur lg:block"
      >
        <GamesFilter {...props} />
      </aside>

      {/* Mobile: floating trigger + drawer */}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90 ring-primary/20 focus-visible:ring-ring fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg ring-4 transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none lg:hidden"
            aria-label={t('openFilters')}
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            <span>{t('openFilters')}</span>
            {activeCount > 0 && (
              <span className="bg-primary-foreground/90 text-primary inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
                {activeCount}
              </span>
            )}
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-4 border-l border-border p-5 shadow-2xl"
            aria-describedby={undefined}
          >
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
                {t('title')}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label={t('closeFilters')}
                className="text-muted-foreground hover:text-foreground rounded-md p-1 transition"
              >
                <X aria-hidden className="size-5" />
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">
              <GamesFilter {...props} onApply={() => setOpen(false)} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

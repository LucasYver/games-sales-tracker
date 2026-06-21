'use client';

import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  page: number;
  pageCount: number;
}

export function Pagination({ page, pageCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('pagination');

  const goTo = useCallback(
    (target: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (target <= 1) {
        params.delete('page');
      } else {
        params.set('page', String(target));
      }
      router.push(`${pathname}?${params.toString()}` as never);
    },
    [router, pathname, searchParams],
  );

  if (pageCount <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pageCount, start + 4);
  for (let i = Math.max(1, end - 4); i <= end; i++) pages.push(i);

  return (
    <nav
      className="flex items-center justify-center gap-1.5 pt-4"
      aria-label={t('nav')}
    >
      <Button
        variant="outline"
        size="icon"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
        aria-label={t('previous')}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>

      {pages[0] > 1 && (
        <>
          <Button variant="outline" size="sm" onClick={() => goTo(1)}>
            1
          </Button>
          {pages[0] > 2 && (
            <span className="text-muted-foreground px-1" aria-hidden>
              …
            </span>
          )}
        </>
      )}

      {pages.map((p) => (
        <Button
          key={p}
          variant={p === page ? 'default' : 'outline'}
          size="sm"
          onClick={() => goTo(p)}
          aria-current={p === page ? 'page' : undefined}
          aria-label={`Page ${p}`}
        >
          {p}
        </Button>
      ))}

      {pages[pages.length - 1] < pageCount && (
        <>
          {pages[pages.length - 1] < pageCount - 1 && (
            <span className="text-muted-foreground px-1" aria-hidden>
              …
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => goTo(pageCount)}>
            {pageCount}
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="icon"
        onClick={() => goTo(page + 1)}
        disabled={page >= pageCount}
        aria-label={t('next')}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Button>
    </nav>
  );
}

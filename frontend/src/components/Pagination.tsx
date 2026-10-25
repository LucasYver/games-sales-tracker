'use client';

import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  page: number;
  pageCount: number;
}

export function Pagination({ page, pageCount }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('pagination');

  function hrefFor(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(target));
    }
    const query = Object.fromEntries(params.entries());
    return { pathname, query };
  }

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
      {page <= 1 ? (
        <Button
          variant="outline"
          size="icon"
          disabled
          aria-label={t('previous')}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
      ) : (
        <Button asChild variant="outline" size="icon">
          <Link href={hrefFor(page - 1)} aria-label={t('previous')}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      )}

      {pages[0] > 1 && (
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(1)}>1</Link>
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
          asChild
          variant={p === page ? 'default' : 'outline'}
          size="sm"
        >
          <Link
            href={hrefFor(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </Link>
        </Button>
      ))}

      {pages[pages.length - 1] < pageCount && (
        <>
          {pages[pages.length - 1] < pageCount - 1 && (
            <span className="text-muted-foreground px-1" aria-hidden>
              …
            </span>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(pageCount)}>{pageCount}</Link>
          </Button>
        </>
      )}

      {page >= pageCount ? (
        <Button variant="outline" size="icon" disabled aria-label={t('next')}>
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      ) : (
        <Button asChild variant="outline" size="icon">
          <Link href={hrefFor(page + 1)} aria-label={t('next')}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      )}
    </nav>
  );
}

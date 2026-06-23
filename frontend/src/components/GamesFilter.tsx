'use client';

import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  sort: string;
  platform: string;
  genre: string;
  status: string;
  yearMin: string;
  yearMax: string;
  minReviews: string;
  genres: { name: string; count: number }[];
  onApply?: () => void;
}

const PLATFORM_ALL = '__all__';
const GENRE_ALL = '__all__';
const STATUS_ALL = '__all__';
const YEAR_ANY = '__any__';
const REVIEWS_ANY = '__any__';

const MIN_YEAR = 1990;
const YEAR_HORIZON = 3;
const REVIEW_THRESHOLDS = [100, 500, 1000, 5000, 10000, 50000, 100000];

export function GamesFilter({
  sort,
  platform,
  genre,
  status,
  yearMin,
  yearMax,
  minReviews,
  genres,
  onApply,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('filter');

  const update = useCallback(
    (entries: Array<[string, string]>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of entries) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}` as never);
      onApply?.();
    },
    [router, pathname, searchParams, onApply],
  );

  const years = useMemo(() => {
    const max = new Date().getFullYear() + YEAR_HORIZON;
    return Array.from({ length: max - MIN_YEAR + 1 }, (_, i) => max - i);
  }, []);

  const hasActiveFilter = Boolean(
    (sort && sort !== 'popular') ||
      platform ||
      genre ||
      status ||
      yearMin ||
      yearMax ||
      minReviews,
  );

  const handleReset = () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of [
      'sort',
      'platform',
      'genre',
      'status',
      'yearMin',
      'yearMax',
      'minReviews',
      'page',
    ]) {
      params.delete(key);
    }
    router.push(
      params.toString() ? `${pathname}?${params}` : (pathname as never),
    );
    onApply?.();
  };

  const reviewsFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { notation: 'compact' }),
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-semibold tracking-tight">
          {t('title')}
        </h3>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 transition hover:underline"
          >
            <RotateCcw aria-hidden className="size-3" />
            {t('reset')}
          </button>
        )}
      </div>

      <Field id="sort-select" label={t('sortLabel')}>
        <Select
          value={sort}
          onValueChange={(v) =>
            update([['sort', v === 'popular' ? '' : v]])
          }
        >
          <SelectTrigger id="sort-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">{t('sortPopular')}</SelectItem>
            <SelectItem value="recent">{t('sortRecent')}</SelectItem>
            <SelectItem value="oldest">{t('sortOldest')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field id="platform-select" label={t('platformLabel')}>
        <Select
          value={platform || PLATFORM_ALL}
          onValueChange={(v) =>
            update([['platform', v === PLATFORM_ALL ? '' : v]])
          }
        >
          <SelectTrigger id="platform-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PLATFORM_ALL}>{t('platformAll')}</SelectItem>
            <SelectItem value="PC">PC</SelectItem>
            <SelectItem value="PLAYSTATION">PlayStation</SelectItem>
            <SelectItem value="XBOX">Xbox</SelectItem>
            <SelectItem value="SWITCH">Switch</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {genres.length > 0 && (
        <Field id="genre-select" label={t('genreLabel')}>
          <Select
            value={genre || GENRE_ALL}
            onValueChange={(v) =>
              update([['genre', v === GENRE_ALL ? '' : v]])
            }
          >
            <SelectTrigger id="genre-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={GENRE_ALL}>{t('genreAll')}</SelectItem>
              {genres.map((g) => (
                <SelectItem key={g.name} value={g.name}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field id="status-select" label={t('statusLabel')}>
        <Select
          value={status || STATUS_ALL}
          onValueChange={(v) =>
            update([['status', v === STATUS_ALL ? '' : v]])
          }
        >
          <SelectTrigger id="status-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>{t('statusAll')}</SelectItem>
            <SelectItem value="released">{t('statusReleased')}</SelectItem>
            <SelectItem value="new">{t('statusNew')}</SelectItem>
            <SelectItem value="upcoming">{t('statusUpcoming')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t('yearLabel')}</span>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={yearMin || YEAR_ANY}
            onValueChange={(v) =>
              update([['yearMin', v === YEAR_ANY ? '' : v]])
            }
          >
            <SelectTrigger
              id="year-min-select"
              className="w-full"
              aria-label={t('yearFrom')}
            >
              <SelectValue placeholder={t('yearFrom')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={YEAR_ANY}>{t('yearFrom')}</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={yearMax || YEAR_ANY}
            onValueChange={(v) =>
              update([['yearMax', v === YEAR_ANY ? '' : v]])
            }
          >
            <SelectTrigger
              id="year-max-select"
              className="w-full"
              aria-label={t('yearTo')}
            >
              <SelectValue placeholder={t('yearTo')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={YEAR_ANY}>{t('yearTo')}</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Field id="reviews-select" label={t('minReviewsLabel')}>
        <Select
          value={minReviews || REVIEWS_ANY}
          onValueChange={(v) =>
            update([['minReviews', v === REVIEWS_ANY ? '' : v]])
          }
        >
          <SelectTrigger id="reviews-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={REVIEWS_ANY}>{t('minReviewsAny')}</SelectItem>
            {REVIEW_THRESHOLDS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t('minReviewsCount', { count: reviewsFormatter.format(n) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function countActiveFilters(values: {
  platform?: string;
  genre?: string;
  status?: string;
  yearMin?: string;
  yearMax?: string;
  minReviews?: string;
}) {
  let n = 0;
  if (values.platform) n++;
  if (values.genre) n++;
  if (values.status) n++;
  if (values.yearMin) n++;
  if (values.yearMax) n++;
  if (values.minReviews) n++;
  return n;
}

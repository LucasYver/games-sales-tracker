import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import {
  getGenres,
  getPopularGames,
  searchGames,
  type GenreOption,
  type SortOption,
  type StatusOption,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { GamesTable } from '@/components/chart-room/GamesTable';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { FiltersSidebar } from '@/components/FiltersSidebar';
import { Pagination } from '@/components/Pagination';

const PAGE_SIZE = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'homeMeta' });

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', fr: '/fr' },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      locale,
      url: `/${locale}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
  };
}

const SORTS: SortOption[] = ['popular', 'recent', 'oldest'];

function SortNav({
  sort,
  params,
}: {
  sort: SortOption;
  params: Record<string, string>;
}) {
  const t = useTranslations('filter');
  const labels: Record<SortOption, string> = {
    popular: t('sortPopular'),
    recent: t('sortRecent'),
    oldest: t('sortOldest'),
  };

  return (
    <nav
      aria-label={t('sortLabel')}
      className="flex gap-1 overflow-x-auto border-b border-border bg-surface-alt px-4 py-2"
    >
      {SORTS.map((option) => {
        const query = { ...params, sort: option };
        delete (query as Record<string, string | undefined>).page;
        const active = option === sort;
        return (
          <Link
            key={option}
            href={{ pathname: '/', query }}
            aria-current={active ? 'page' : undefined}
            className={`border px-2 py-1.5 font-mono text-[0.7rem] tracking-wide whitespace-nowrap uppercase ${
              active
                ? 'border-primary/40 bg-accent text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {labels[option]}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function SearchResults({
  query,
  results,
}: {
  query: string;
  results: Awaited<ReturnType<typeof searchGames>>;
}) {
  const t = useTranslations('home');

  return (
    <section className="flex flex-col gap-4" aria-labelledby="search-heading">
      <h1
        id="search-heading"
        className="font-mono text-sm font-bold tracking-wider uppercase"
      >
        {t('searchHeading', { query })}
      </h1>
      {results.length === 0 ? (
        <EmptyState>{t('searchEmpty')}</EmptyState>
      ) : (
        <GamesTable games={results} offset={0} />
      )}
    </section>
  );
}

function ListingJsonLd({
  locale,
  items,
}: {
  locale: string;
  items: Awaited<ReturnType<typeof getPopularGames>>['items'];
}) {
  if (items.length === 0) return null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((game, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: `/${locale}/game/${game.slug}`,
      name: game.name,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function Listing({
  popular,
  page,
  pageCount,
  offset,
}: {
  popular: Awaited<ReturnType<typeof getPopularGames>>;
  page: number;
  pageCount: number;
  offset: number;
}) {
  const t = useTranslations('home');

  if (popular.items.length === 0) {
    return <EmptyState>{t('listingEmpty')}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-baseline gap-2 font-mono text-sm font-bold tracking-wider uppercase">
        {t('title')}
        <span className="text-xs font-medium tracking-normal text-muted-foreground normal-case">
          {t('gamesCount', { count: popular.total })}
        </span>
      </h1>
      <GamesTable games={popular.items} offset={offset} />
      <Suspense>
        <Pagination page={page} pageCount={pageCount} />
      </Suspense>
    </div>
  );
}

export default async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    sort?: string;
    platform?: string;
    genre?: string;
    status?: string;
    yearMin?: string;
    yearMax?: string;
    minReviews?: string;
    page?: string;
  }>;
}) {
  const { locale } = await params;
  const {
    q,
    sort: sortParam,
    platform: platformParam,
    genre: genreParam,
    status: statusParam,
    yearMin: yearMinParam,
    yearMax: yearMaxParam,
    minReviews: minReviewsParam,
    page: pageParam,
  } = await searchParams;
  const query = q?.trim() ?? '';
  const sort: SortOption =
    sortParam === 'recent' || sortParam === 'oldest' ? sortParam : 'popular';
  const platform = platformParam ?? '';
  const genre = (genreParam ?? '').trim();
  const status: StatusOption | '' =
    statusParam === 'released' ||
    statusParam === 'new' ||
    statusParam === 'upcoming'
      ? statusParam
      : '';
  const yearMin = sanitizeYear(yearMinParam);
  const yearMax = sanitizeYear(yearMaxParam);
  const minReviewsNum = Number(minReviewsParam);
  const minReviews =
    Number.isFinite(minReviewsNum) && minReviewsNum > 0 ? minReviewsNum : 0;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [results, popular, genres] = await Promise.all([
    query ? searchGames(query) : Promise.resolve([]),
    query
      ? Promise.resolve({ items: [], total: 0 })
      : getPopularGames({
          limit: PAGE_SIZE,
          sort,
          platform: platform || undefined,
          offset,
          genre: genre || undefined,
          status: status || undefined,
          yearMin: yearMin ?? undefined,
          yearMax: yearMax ?? undefined,
          minReviews: minReviews || undefined,
        }),
    query ? Promise.resolve<GenreOption[]>([]) : getGenres(),
  ]);

  const pageCount = Math.ceil(popular.total / PAGE_SIZE);
  const activeParams: Record<string, string> = {};
  if (platform) activeParams.platform = platform;
  if (genre) activeParams.genre = genre;
  if (status) activeParams.status = status;
  if (yearMin != null) activeParams.yearMin = String(yearMin);
  if (yearMax != null) activeParams.yearMax = String(yearMax);
  if (minReviews) activeParams.minReviews = String(minReviews);

  return (
    <main className="flex flex-col">
      {!query && <ListingJsonLd locale={locale} items={popular.items} />}
      <SiteHeader />
      {!query && <SortNav sort={sort} params={activeParams} />}

      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        {query ? (
          <SearchResults query={query} results={results} />
        ) : (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-6">
            <div className="min-w-0 flex-1">
              <Listing
                popular={popular}
                page={page}
                pageCount={pageCount}
                offset={offset}
              />
            </div>
            <Suspense>
              <FiltersSidebar
                sort={sort}
                platform={platform}
                genre={genre}
                status={status}
                yearMin={yearMin != null ? String(yearMin) : ''}
                yearMax={yearMax != null ? String(yearMax) : ''}
                minReviews={minReviews ? String(minReviews) : ''}
                genres={genres}
              />
            </Suspense>
          </div>
        )}
      </div>
    </main>
  );
}

function sanitizeYear(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const max = new Date().getFullYear() + 5;
  if (n < 1900 || n > max) return null;
  return Math.trunc(n);
}

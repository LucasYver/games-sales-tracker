import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import {
  getGenres,
  getPopularGames,
  searchGames,
  type GenreOption,
  type SortOption,
  type StatusOption,
} from '@/lib/api';
import { GamesTable } from '@/components/chart-room/GamesTable';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { FiltersSidebar } from '@/components/FiltersSidebar';
import { Pagination } from '@/components/Pagination';

const PAGE_SIZE = 50;

type HomeSearchParams = {
  q?: string;
  sort?: string;
  platform?: string;
  genre?: string;
  status?: string;
  yearMin?: string;
  yearMax?: string;
  minReviews?: string;
  page?: string;
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<HomeSearchParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'homeMeta' });
  const page = Math.max(1, Number(sp.page) || 1);
  const filtered = hasListingFilters(sp);
  const paginated = !filtered && page >= 2;
  const title = paginated ? t('titlePage', { page }) : t('title');
  const description = t('description');
  const canonical = paginated ? `/${locale}?page=${page}` : `/${locale}`;
  const languages = paginated
    ? {
        en: `/en?page=${page}`,
        fr: `/fr?page=${page}`,
        'x-default': `/${routing.defaultLocale}?page=${page}`,
      }
    : {
        en: '/en',
        fr: '/fr',
        'x-default': `/${routing.defaultLocale}`,
      };

  return {
    title,
    description,
    robots: { index: !filtered, follow: true },
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      locale,
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
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
      url: `${SITE_URL}/${locale}/game/${game.slug}`,
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
  sort,
  params,
}: {
  popular: Awaited<ReturnType<typeof getPopularGames>>;
  page: number;
  pageCount: number;
  offset: number;
  sort: SortOption;
  params: Record<string, string>;
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
      <GamesTable
        games={popular.items}
        offset={offset}
        sort={sort}
        params={params}
      />
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
  searchParams: Promise<HomeSearchParams>;
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
    sortParam === 'recent' ||
    sortParam === 'oldest' ||
    sortParam === 'sales'
      ? sortParam
      : 'popular';
  const platform = platformParam ?? '';
  const genre = (genreParam ?? '').trim();
  // Public home never lists unreleased titles. "new" stays available as a
  // narrower released-window filter; "upcoming" and bare "all" are ignored.
  const status: StatusOption = statusParam === 'new' ? 'new' : 'released';
  const yearMin = sanitizeYear(yearMinParam);
  const yearMax = sanitizeYear(yearMaxParam);
  const minReviewsNum = Number(minReviewsParam);
  const minReviews =
    Number.isFinite(minReviewsNum) && minReviewsNum > 0 ? minReviewsNum : 0;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rawResults, popular, genres] = await Promise.all([
    query ? searchGames(query) : Promise.resolve([]),
    query
      ? Promise.resolve({ items: [], total: 0 })
      : getPopularGames({
          limit: PAGE_SIZE,
          sort,
          platform: platform || undefined,
          offset,
          genre: genre || undefined,
          status,
          yearMin: yearMin ?? undefined,
          yearMax: yearMax ?? undefined,
          minReviews: minReviews || undefined,
        }),
    query ? Promise.resolve<GenreOption[]>([]) : getGenres(),
  ]);
  const now = Date.now();
  const results = rawResults.filter((game) => {
    if (!game.releaseDate) return false;
    return new Date(game.releaseDate).getTime() <= now;
  });

  const pageCount = Math.ceil(popular.total / PAGE_SIZE);
  const listParams: Record<string, string> = {};
  if (sort !== 'popular') listParams.sort = sort;
  if (platform) listParams.platform = platform;
  if (genre) listParams.genre = genre;
  if (status === 'new') listParams.status = status;
  if (yearMin != null) listParams.yearMin = String(yearMin);
  if (yearMax != null) listParams.yearMax = String(yearMax);
  if (minReviews) listParams.minReviews = String(minReviews);

  return (
    <main className="flex flex-col">
      {!query && <ListingJsonLd locale={locale} items={popular.items} />}
      <SiteHeader />

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
                sort={sort}
                params={listParams}
              />
            </div>
            <Suspense>
              <FiltersSidebar
                sort={sort}
                platform={platform}
                genre={genre}
                status={status === 'released' ? '' : status}
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

function hasListingFilters(sp: HomeSearchParams): boolean {
  if (sp.q?.trim()) return true;
  if (sp.sort === 'recent' || sp.sort === 'oldest' || sp.sort === 'sales') {
    return true;
  }
  if (sp.platform) return true;
  if ((sp.genre ?? '').trim()) return true;
  // Home already forces released; only a non-default status is a filter.
  if (sp.status && sp.status !== 'released') return true;
  if (sanitizeYear(sp.yearMin) != null) return true;
  if (sanitizeYear(sp.yearMax) != null) return true;
  const minReviewsNum = Number(sp.minReviews);
  return Number.isFinite(minReviewsNum) && minReviewsNum > 0;
}

function sanitizeYear(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const max = new Date().getFullYear() + 5;
  if (n < 1900 || n > max) return null;
  return Math.trunc(n);
}

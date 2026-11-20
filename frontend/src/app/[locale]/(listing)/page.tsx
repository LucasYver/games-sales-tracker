import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { localeLanguages } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import {
  getGenres,
  getPopularGames,
  searchGames,
  type GenreOption,
} from '@/lib/api';
import { GamesTable } from '@/components/chart-room/GamesTable';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { ListingFilterBar } from '@/components/ListingFilterBar';
import {
  countActiveFilters,
  listingQuery,
  parseListingFilters,
  DEFAULT_SORT,
  type ListingFilters,
  type ListingSearchParams,
} from '@/lib/listing-filters';
import { Pagination } from '@/components/Pagination';
import { defaultOgImages } from '@/lib/og-meta';
import { Gta6HomeBanner } from '@/components/Gta6HomeBanner';

const PAGE_SIZE = 50;

type HomeSearchParams = ListingSearchParams & {
  q?: string;
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
  const languages = localeLanguages(paginated ? `?page=${page}` : '');

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
      images: defaultOgImages(locale),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: defaultOgImages(locale),
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
  filters,
  genres,
}: {
  popular: Awaited<ReturnType<typeof getPopularGames>>;
  page: number;
  pageCount: number;
  offset: number;
  filters: ListingFilters;
  genres: GenreOption[];
}) {
  const t = useTranslations('home');

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-mono text-sm font-bold tracking-wider uppercase">
        {t('title')}
      </h1>
      <Suspense>
        <ListingFilterBar
          filters={filters}
          genres={genres}
          total={popular.total}
        >
          {popular.items.length === 0 ? (
            <EmptyState>{t('listingEmpty')}</EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              <GamesTable
                games={popular.items}
                offset={offset}
                sort={filters.sort}
                params={listingQuery(filters)}
              />
              <Suspense>
                <Pagination page={page} pageCount={pageCount} />
              </Suspense>
            </div>
          )}
        </ListingFilterBar>
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
  const sp = await searchParams;
  const query = sp.q?.trim() ?? '';
  const filters = parseListingFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rawResults, popular, genres] = await Promise.all([
    query ? searchGames(query) : Promise.resolve([]),
    query
      ? Promise.resolve({ items: [], total: 0 })
      : getPopularGames({
          limit: PAGE_SIZE,
          sort: filters.sort,
          platform: filters.platforms.join(',') || undefined,
          offset,
          genre: filters.genres.join(',') || undefined,
          // The public home never lists unreleased titles.
          status: 'released',
          yearMin: filters.yearMin ?? undefined,
          yearMax: filters.yearMax ?? undefined,
          minReviews: filters.minReviews || undefined,
          modes: filters.modes,
          hideFree: filters.hideFree,
          exclusive: filters.exclusive,
        }),
    query ? Promise.resolve<GenreOption[]>([]) : getGenres(),
  ]);
  const now = Date.now();
  const results = rawResults.filter((game) => {
    if (!game.releaseDate) return false;
    return new Date(game.releaseDate).getTime() <= now;
  });

  const pageCount = Math.ceil(popular.total / PAGE_SIZE);

  return (
    <main className="flex flex-col">
      {!query && <ListingJsonLd locale={locale} items={popular.items} />}
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        {!query && page === 1 && <Gta6HomeBanner locale={locale} />}
        {query ? (
          <SearchResults query={query} results={results} />
        ) : (
          <Listing
            popular={popular}
            page={page}
            pageCount={pageCount}
            offset={offset}
            filters={filters}
            genres={genres}
          />
        )}
      </div>
    </main>
  );
}

function hasListingFilters(sp: HomeSearchParams): boolean {
  if (sp.q?.trim()) return true;
  const filters = parseListingFilters(sp);
  return filters.sort !== DEFAULT_SORT || countActiveFilters(filters) > 0;
}

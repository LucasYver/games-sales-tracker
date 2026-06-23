import { Suspense } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import Image from 'next/image';
import { ImageOff, SearchX, Inbox } from 'lucide-react';
import {
  getGenres,
  getPopularGames,
  searchGames,
  type GenreOption,
  type SortOption,
  type StatusOption,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { SearchBar } from '@/components/SearchBar';
import { GameCard } from '@/components/GameCard';
import { FiltersSidebar } from '@/components/FiltersSidebar';
import { Pagination } from '@/components/Pagination';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const PAGE_SIZE = 30;

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

function HeroSection() {
  const t = useTranslations('home');
  return (
    <section className="relative isolate overflow-hidden border-b border-border bg-gradient-to-b from-accent/40 to-background">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-72 w-[60rem] -translate-x-1/2 rounded-full bg-primary/15 opacity-70 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-24 -z-10 h-56 w-56 rounded-full bg-accent/40 opacity-60 blur-3xl"
      />

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-10 pb-14">
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-primary text-xs"
          >
            {t('badge')}
          </Badge>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold tracking-tight text-balance drop-shadow-sm sm:text-5xl lg:text-6xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            {t('subtitle')}
          </p>
        </div>
        <div className="w-full max-w-xl">
          <Suspense fallback={<div className="h-11" />}>
            <SearchBar />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

function EmptyState({
  icon: Icon,
  children,
}: {
  icon: typeof Inbox;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border/60 bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <Icon
        aria-hidden
        className="text-muted-foreground/70 size-8"
      />
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
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
  const tCommon = useTranslations('common');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-5" aria-labelledby="search-heading">
      <h2 id="search-heading" className="text-xl font-semibold tracking-tight">
        {t('searchHeading', { query })}
      </h2>
      {results.length === 0 ? (
        <EmptyState icon={SearchX}>{t('searchEmpty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((game) => (
            <li key={game.id}>
              <Link
                href={`/game/${game.slug}`}
                className="group focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="ring-foreground/10 flex-row items-center gap-4 p-3 ring-1 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-foreground/20">
                  <div className="bg-muted relative size-14 shrink-0 overflow-hidden rounded-md">
                    {game.coverUrl ? (
                      <Image
                        src={game.coverUrl}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="text-muted-foreground/60 flex h-full w-full items-center justify-center">
                        <ImageOff aria-hidden className="size-4" />
                        <span className="sr-only">{tCommon('noImage')}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{game.name}</span>
                    {game.releaseDate && (
                      <span className="text-muted-foreground truncate text-xs">
                        {t('releasedOn', {
                          date: format.dateTime(new Date(game.releaseDate), {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          }),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                    {game.platforms.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="text-muted-foreground border-border/70 px-1.5 py-0 text-[10px] font-medium"
                      >
                        {tPlatform(p)}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GameListing({
  sort,
  platform,
  genre,
  popular,
  page,
  pageCount,
}: {
  sort: SortOption;
  platform: string;
  genre: string;
  popular: Awaited<ReturnType<typeof getPopularGames>>;
  page: number;
  pageCount: number;
}) {
  const t = useTranslations('home');
  const tPlatform = useTranslations('platform');
  const headingKey =
    sort === 'recent'
      ? 'listingRecent'
      : sort === 'oldest'
        ? 'listingOldest'
        : 'listingPopular';

  const headingSuffix = [
    platform ? tPlatform(platform as never) : null,
    genre || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="flex flex-col gap-6" aria-labelledby="listing-heading">
      <div className="flex flex-col gap-1.5">
        <h2 id="listing-heading" className="text-2xl font-bold tracking-tight">
          {t(headingKey)}
          {headingSuffix ? ` · ${headingSuffix}` : ''}
        </h2>
        {popular.total > 0 && (
          <p className="text-muted-foreground text-sm">
            {t('gamesCount', { count: popular.total })}
          </p>
        )}
      </div>
      {popular.items.length === 0 ? (
        <EmptyState icon={Inbox}>{t('listingEmpty')}</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {popular.items.map((game, idx) => (
              <GameCard key={game.id} game={game} priority={idx < 6} />
            ))}
          </div>
          <Suspense>
            <Pagination page={page} pageCount={pageCount} />
          </Suspense>
        </>
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

  const [results, popular, genres] = await Promise.all([
    query ? searchGames(query) : Promise.resolve([]),
    query
      ? Promise.resolve({ items: [], total: 0 })
      : getPopularGames({
          limit: PAGE_SIZE,
          sort,
          platform: platform || undefined,
          offset: (page - 1) * PAGE_SIZE,
          genre: genre || undefined,
          status: status || undefined,
          yearMin: yearMin ?? undefined,
          yearMax: yearMax ?? undefined,
          minReviews: minReviews || undefined,
        }),
    query ? Promise.resolve<GenreOption[]>([]) : getGenres(),
  ]);

  const pageCount = Math.ceil(popular.total / PAGE_SIZE);

  return (
    <main className="flex flex-col">
      {!query && <ListingJsonLd locale={locale} items={popular.items} />}
      <HeroSection />
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        {query ? (
          <SearchResults query={query} results={results} />
        ) : (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-8">
            <div className="min-w-0 flex-1">
              <GameListing
                sort={sort}
                platform={platform}
                genre={genre}
                popular={popular}
                page={page}
                pageCount={pageCount}
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

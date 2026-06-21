import { Suspense } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import {
  getPopularGames,
  searchGames,
  type SortOption,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { SearchBar } from '@/components/SearchBar';
import { GameCard } from '@/components/GameCard';
import { GamesFilter } from '@/components/GamesFilter';
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
    <section className="border-border from-accent/40 to-background relative border-b bg-gradient-to-b">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-10 pb-12">
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
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base text-pretty sm:text-lg">
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

function SearchResults({
  query,
  results,
}: {
  query: string;
  results: Awaited<ReturnType<typeof searchGames>>;
}) {
  const t = useTranslations('home');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  return (
    <section className="flex flex-col gap-4" aria-labelledby="search-heading">
      <h2 id="search-heading" className="text-lg font-semibold">
        {t('searchHeading', { query })}
      </h2>
      {results.length === 0 ? (
        <p className="text-muted-foreground">{t('searchEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((game) => (
            <li key={game.id}>
              <Link
                href={`/game/${game.slug}`}
                className="focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="px-5 py-4 transition-shadow hover:shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{game.name}</span>
                      <span className="text-muted-foreground text-sm">
                        {game.releaseDate
                          ? t('releasedOn', {
                              date: format.dateTime(
                                new Date(game.releaseDate),
                                {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                },
                              ),
                            })
                          : null}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {game.platforms.map((p) => (
                        <Badge key={p} variant="secondary">
                          {tPlatform(p)}
                        </Badge>
                      ))}
                    </div>
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
  popular,
  page,
  pageCount,
}: {
  sort: SortOption;
  platform: string;
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

  return (
    <section className="flex flex-col gap-6" aria-labelledby="listing-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="listing-heading" className="text-xl font-semibold">
            {t(headingKey)}
            {platform ? ` · ${tPlatform(platform as never)}` : ''}
          </h2>
          {popular.total > 0 && (
            <p className="text-muted-foreground text-sm">
              {t('gamesCount', { count: popular.total })}
            </p>
          )}
        </div>
        <Suspense>
          <GamesFilter sort={sort} platform={platform} />
        </Suspense>
      </div>
      {popular.items.length === 0 ? (
        <p className="text-muted-foreground">{t('listingEmpty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {popular.items.map((game) => (
              <GameCard key={game.id} game={game} />
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    platform?: string;
    page?: string;
  }>;
}) {
  const {
    q,
    sort: sortParam,
    platform: platformParam,
    page: pageParam,
  } = await searchParams;
  const query = q?.trim() ?? '';
  const sort: SortOption =
    sortParam === 'recent' || sortParam === 'oldest' ? sortParam : 'popular';
  const platform = platformParam ?? '';
  const page = Math.max(1, Number(pageParam) || 1);

  const [results, popular] = await Promise.all([
    query ? searchGames(query) : Promise.resolve([]),
    query
      ? Promise.resolve({ items: [], total: 0 })
      : getPopularGames(
          PAGE_SIZE,
          sort,
          platform || undefined,
          (page - 1) * PAGE_SIZE,
        ),
  ]);

  const pageCount = Math.ceil(popular.total / PAGE_SIZE);

  return (
    <main className="flex flex-col">
      <HeroSection />
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {query ? (
          <SearchResults query={query} results={results} />
        ) : (
          <GameListing
            sort={sort}
            platform={platform}
            popular={popular}
            page={page}
            pageCount={pageCount}
          />
        )}
      </div>
    </main>
  );
}

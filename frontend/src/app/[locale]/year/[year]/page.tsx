import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { localeLanguages } from '@/i18n/routing';
import { getPopularGames } from '@/lib/api';
import { hubYears } from '@/lib/hub-years';
import { GamesTable } from '@/components/chart-room/GamesTable';
import { HubBreadcrumb, HubJsonLd } from '@/components/chart-room/HubPage';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { Pagination } from '@/components/Pagination';

const PAGE_SIZE = 50;

type Params = Promise<{ locale: string; year: string }>;
type SearchParams = Promise<{ page?: string }>;

function parseYear(value: string): number | null {
  const year = Number(value);
  return hubYears().includes(year) ? year : null;
}

function parsePage(value: string | undefined): number {
  return Math.max(1, Math.trunc(Number(value)) || 1);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const [{ locale, year: yearParam }, { page: pageParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  const year = parseYear(yearParam);
  if (!year) return { title: 'Not found' };

  const t = await getTranslations({ locale, namespace: 'hubs' });
  const page = parsePage(pageParam);
  const title =
    page >= 2
      ? t('yearTitlePage', { year: String(year), page })
      : t('yearTitle', { year: String(year) });
  const description = t('yearDescription', { year: String(year) });
  const query = page >= 2 ? `?page=${page}` : '';
  const path = `/year/${year}${query}`;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: localeLanguages(path),
    },
    openGraph: { title, description, url: `/${locale}${path}`, locale },
  };
}

function OtherYears({ year }: { year: number }) {
  const t = useTranslations('hubs');
  return (
    <section className="mt-6 border-t border-border pt-4">
      <h2 className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
        {t('otherYears')}
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {hubYears()
          .filter((other) => other !== year)
          .map((other) => (
            <Link
              key={other}
              href={`/year/${other}`}
              className="border border-border px-2 py-1 font-mono text-[0.72rem] hover:text-primary"
            >
              {other}
            </Link>
          ))}
      </div>
    </section>
  );
}

export default async function YearPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ locale, year: yearParam }, { page: pageParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  const year = parseYear(yearParam);
  if (!year) notFound();

  const page = parsePage(pageParam);
  const offset = (page - 1) * PAGE_SIZE;
  const [games, t] = await Promise.all([
    getPopularGames({
      limit: PAGE_SIZE,
      offset,
      sort: 'sales',
      status: 'released',
      yearMin: year,
      yearMax: year,
    }),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  if (games.items.length === 0) notFound();

  const title = t('yearTitle', { year: String(year) });

  return (
    <main className="flex min-h-screen flex-col">
      <HubJsonLd
        locale={locale}
        path={`/year/${year}`}
        title={title}
        homeLabel={t('home')}
        games={games.items}
        offset={offset}
      />
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl">
        <HubBreadcrumb current={String(year)} />

        <div className="px-4 py-5">
          <h1 className="font-mono text-sm font-bold tracking-wider uppercase">
            {title}
          </h1>
          <p className="mt-2 mb-4 max-w-[75ch] text-[0.82rem] leading-relaxed text-muted-foreground">
            {t('yearIntro', { count: games.total, year: String(year) })}
          </p>

          <GamesTable games={games.items} offset={offset} />
          <Suspense>
            <Pagination
              page={page}
              pageCount={Math.ceil(games.total / PAGE_SIZE)}
            />
          </Suspense>
          <OtherYears year={year} />
        </div>
      </div>
    </main>
  );
}

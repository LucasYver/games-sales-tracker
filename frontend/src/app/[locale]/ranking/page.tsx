import { Suspense } from 'react';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { getRankedGames, listingUnits, type RankSort } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { Pagination } from '@/components/Pagination';

const PAGE_SIZE = 50;
const SORTS: RankSort[] = ['top', 'peak', 'weeks'];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ranking' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: `/${locale}/ranking`,
      languages: { en: '/en/ranking', fr: '/fr/ranking' },
    },
  };
}

function SortNav({ sort }: { sort: RankSort }) {
  const t = useTranslations('ranking');
  const labels: Record<RankSort, string> = {
    top: t('sortTop'),
    peak: t('sortPeak'),
    weeks: t('sortWeeks'),
  };

  return (
    <nav
      aria-label={t('sortLabel')}
      className="flex gap-1 overflow-x-auto border-b border-border bg-surface-alt px-4 py-2"
    >
      {SORTS.map((option) => {
        const active = option === sort;
        return (
          <Link
            key={option}
            href={{ pathname: '/ranking', query: { sort: option } }}
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

function RankTable({
  games,
  offset,
}: {
  games: Awaited<ReturnType<typeof getRankedGames>>['items'];
  offset: number;
}) {
  const t = useTranslations('ranking');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 1 });

  const th =
    'border-b border-border px-2 py-2 font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase';

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th scope="col" className={`${th} w-9 text-center`}>
            #
          </th>
          <th scope="col" className={`${th} w-11`}>
            <span className="sr-only">{tCommon('noImage')}</span>
          </th>
          <th scope="col" className={`${th} text-left`}>
            {t('game')}
          </th>
          <th scope="col" className={`${th} hidden text-right sm:table-cell`}>
            {t('topDecile')}
          </th>
          <th scope="col" className={`${th} hidden text-right md:table-cell`}>
            {t('weeks')}
          </th>
          <th scope="col" className={`${th} hidden text-right md:table-cell`}>
            {t('peak')}
          </th>
          <th scope="col" className={`${th} text-right`}>
            {t('sales')}
          </th>
        </tr>
      </thead>
      <tbody>
        {games.map((game, idx) => {
          const sold = listingUnits(game);
          return (
            <tr
              key={game.id}
              className="border-b border-border-soft odd:bg-surface-alt hover:bg-accent"
            >
              <td className="px-2 py-2 text-center font-mono text-muted-foreground tabular-nums">
                {offset + idx + 1}
              </td>
              <td className="px-2 py-2">
                <div className="relative size-8 overflow-hidden rounded-[2px] bg-muted">
                  {game.coverUrl && (
                    <Image
                      src={game.coverUrl}
                      alt=""
                      fill
                      sizes="32px"
                      className="object-cover"
                    />
                  )}
                </div>
              </td>
              <td className="min-w-0 px-2 py-2">
                <Link
                  href={`/game/${game.slug}`}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  {game.name}
                </Link>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground sm:hidden">
                  {t('topDecileShort', { count: game.weeksTopDecile })} ·{' '}
                  {t('peakShort', { rank: game.peakRank })}
                </div>
              </td>
              <td className="hidden px-2 py-2 text-right font-mono tabular-nums sm:table-cell">
                {game.weeksTopDecile}
              </td>
              <td className="hidden px-2 py-2 text-right font-mono text-muted-foreground tabular-nums md:table-cell">
                {game.weeksCharted}
              </td>
              <td className="hidden px-2 py-2 text-right font-mono text-muted-foreground tabular-nums md:table-cell">
                #{game.peakRank}
              </td>
              <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">
                {game.isFree ? (
                  <span className="text-source-official">
                    {tCommon('freeToPlay')}
                  </span>
                ) : sold ? (
                  compact(sold)
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function RankingPage({
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}) {
  const { sort: sortParam, page: pageParam } = await searchParams;
  const sort: RankSort =
    sortParam === 'peak' || sortParam === 'weeks' ? sortParam : 'top';
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const ranked = await getRankedGames({ limit: PAGE_SIZE, offset, sort });
  const pageCount = Math.ceil(ranked.total / PAGE_SIZE);

  return <RankingContent {...{ ranked, sort, page, pageCount, offset }} />;
}

function RankingContent({
  ranked,
  sort,
  page,
  pageCount,
  offset,
}: {
  ranked: Awaited<ReturnType<typeof getRankedGames>>;
  sort: RankSort;
  page: number;
  pageCount: number;
  offset: number;
}) {
  const t = useTranslations('ranking');

  return (
    <main className="flex flex-col">
      <SiteHeader />
      <SortNav sort={sort} />

      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        <h1 className="font-mono text-sm font-bold tracking-wider uppercase">
          {t('title')}
        </h1>
        <p className="mt-2 mb-4 max-w-[75ch] text-xs leading-relaxed text-muted-foreground">
          {t('explainer')}
        </p>

        {ranked.items.length === 0 ? (
          <p className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <RankTable games={ranked.items} offset={offset} />
            <Suspense>
              <Pagination page={page} pageCount={pageCount} />
            </Suspense>
          </div>
        )}
      </div>
    </main>
  );
}

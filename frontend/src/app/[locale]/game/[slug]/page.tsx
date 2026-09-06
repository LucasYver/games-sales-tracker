import { useTranslations, useFormatter } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import {
  getGame,
  headlineUnits,
  type GameDetail,
  type Platform,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { RangedChart } from '@/components/chart-room/RangedChart';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const [game, t] = await Promise.all([
    getGame(slug),
    getTranslations({ locale, namespace: 'gamePageMeta' }),
  ]);

  if (!game) return { title: 'Game not found' };

  const year = game.releaseDate
    ? new Date(game.releaseDate).getFullYear()
    : null;
  const title = year
    ? t('title', { name: game.name, year })
    : t('titleNoYear', { name: game.name });
  const description = t('description', { name: game.name });
  const url = `/${locale}/game/${game.slug}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        en: `/en/game/${game.slug}`,
        fr: `/fr/game/${game.slug}`,
      },
    },
    openGraph: {
      title,
      description,
      type: 'article',
      locale,
      url,
      images: game.coverUrl ? [{ url: game.coverUrl, alt: game.name }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: game.coverUrl ? [game.coverUrl] : [],
    },
  };
}

/**
 * The date that actually qualifies the headline: when a source published the
 * figure if it is a published one, otherwise when we last recomputed ours.
 */
function asOfDate(game: GameDetail): string | null {
  if (game.headline?.basis === 'reported') {
    return game.totalSales?.reportedAt ?? null;
  }
  return game.estimateSnapshots.at(-1)?.computedAt ?? null;
}

/** Single figure per platform, from the same midpoint rule as the headline. */
function platformUnits(low: number, high: number): number {
  const mid = (low + high) / 2;
  const step = mid >= 1_000_000 ? 100_000 : 10_000;
  return Math.max(step, Math.round(mid / step) * step);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
      {children}
    </h2>
  );
}

function GameHeader({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();

  return (
    <header className="flex items-start gap-4 border-b border-border px-4 py-4">
      {game.coverUrl && (
        <div className="relative size-14 shrink-0 overflow-hidden rounded-[3px] bg-muted sm:size-16">
          <Image
            src={game.coverUrl}
            alt={game.name}
            fill
            sizes="64px"
            priority
            className="object-cover"
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl leading-tight font-bold tracking-tight">
          {game.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[
            game.developer,
            game.releaseDate
              ? t('releasedOn', {
                  date: format.dateTime(new Date(game.releaseDate), {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {game.platforms.map((p) => (
            <span
              key={p}
              className="border border-primary/40 bg-accent px-1.5 py-0.5 font-mono text-[0.68rem] text-primary"
            >
              {tPlatform(p)}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

/** The answer the visitor came for, before anything else on the page. */
function SalesHeadline({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const units = game.isFree ? null : headlineUnits(game);
  const asOf = asOfDate(game);
  const asOfLabel = asOf
    ? format.dateTime(new Date(asOf), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <section className="border-b border-border px-4 py-5">
      <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {t('salesTitle')}
      </p>
      {game.isFree ? (
        <>
          <p className="mt-1 font-mono text-3xl font-bold text-source-official">
            {tCommon('freeToPlay')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('freeToPlayNote')}
          </p>
        </>
      ) : units ? (
        <>
          <p className="mt-1 font-mono text-4xl leading-none font-bold text-primary tabular-nums sm:text-5xl">
            {format.number(units)}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {t('allPlatforms')}
            {asOfLabel ? ` · ${t('asOf', { date: asOfLabel })}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{t('noData')}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border-soft pt-3">
        <PriceBlock game={game} />
        {game.peakCcu && (
          <span className="font-mono text-xs text-muted-foreground">
            {t('peakCcu', {
              value: format.number(game.peakCcu.value),
              date: format.dateTime(new Date(game.peakCcu.capturedAt), {
                year: 'numeric',
                month: 'short',
              }),
            })}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Current price, and the discount louder than the price itself when one is
 * running — that is the thing a visitor scanning the page wants to catch.
 */
function PriceBlock({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  const current = game.currentPrice;
  if (!current) return null;

  const money = (cents: number) =>
    format.number(cents / 100, {
      style: 'currency',
      currency: current.currency,
    });
  const onSale = current.discountPercent > 0;
  const lowest = game.lowestPrice;
  const atLowest = lowest != null && current.final <= lowest.final;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {onSale && (
        <span className="bg-source-official px-2 py-1 font-mono text-lg leading-none font-bold text-background">
          −{current.discountPercent}%
        </span>
      )}
      <span
        className={`font-mono leading-none font-bold tabular-nums ${
          onSale ? 'text-2xl text-source-official' : 'text-xl text-foreground'
        }`}
      >
        {money(current.final)}
      </span>
      {onSale && (
        <span className="font-mono text-sm text-muted-foreground line-through tabular-nums">
          {money(current.initial)}
        </span>
      )}
      <span className="font-mono text-[0.7rem] text-muted-foreground">
        {atLowest
          ? t('priceAtLowest')
          : lowest
            ? t('priceLowest', { price: money(lowest.final) })
            : ''}
      </span>
    </div>
  );
}

function PlatformBreakdown({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();

  const rows = game.salesBreakdown
    .filter((row) => row.platform !== 'GLOBAL' && row.high > 0)
    .map((row) => ({
      platform: row.platform as Platform,
      units: platformUnits(row.low, row.high),
    }))
    .sort((a, b) => b.units - a.units);

  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => sum + row.units, 0);
  const shade = [
    'var(--primary)',
    'var(--source-media)',
    'var(--source-official)',
    'var(--source-estimate)',
  ];

  return (
    <section className="border-b border-border px-4 py-5">
      <SectionTitle>{t('platformsTitle')}</SectionTitle>
      <div className="mb-3 flex h-2 overflow-hidden border border-border">
        {rows.map((row, idx) => (
          <span
            key={row.platform}
            style={{
              width: `${(row.units / total) * 100}%`,
              backgroundColor: shade[idx % shade.length],
            }}
          />
        ))}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-2 py-2 text-left font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('platformColumn')}
            </th>
            <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('salesColumn')}
            </th>
            <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t('shareColumn')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.platform}
              className="border-b border-border-soft last:border-b-0"
            >
              <td className="flex items-center gap-2 px-2 py-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0"
                  style={{ backgroundColor: shade[idx % shade.length] }}
                />
                {tPlatform(row.platform)}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">
                {format.number(row.units, {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                })}
              </td>
              <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums">
                {format.number(row.units / total, {
                  style: 'percent',
                  maximumFractionDigits: 0,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Everything about the price, on its own tab: the curve then the raw log. */
function PriceTab({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  if (game.priceHistory.length === 0) {
    return (
      <section className="border-b border-border px-4 py-5">
        <SectionTitle>{t('priceTitle')}</SectionTitle>
        <p className="text-sm text-muted-foreground">{t('priceNoHistory')}</p>
      </section>
    );
  }

  const currency = game.currentPrice?.currency ?? 'USD';
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency });
  const rows = [...game.priceHistory].reverse();

  return (
    <section className="border-b border-border px-4 py-5">
      <SectionTitle>{t('priceTitle')}</SectionTitle>
      <div className="flex flex-col gap-5">
        {game.priceHistory.length > 1 && (
          <RangedChart
            points={game.priceHistory.map((p) => ({
              capturedAt: p.capturedAt,
              value: p.final,
            }))}
            kind="money"
            currency={currency}
            label={t('priceLabel')}
            ariaLabel={t('chartAlt', { series: t('priceLabel') })}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border px-2 py-2 text-left font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t('priceDate')}
                </th>
                <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t('priceList')}
                </th>
                <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t('pricePaid')}
                </th>
                <th className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t('priceDiscount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.capturedAt}
                  className="border-b border-border-soft last:border-b-0"
                >
                  <td className="px-2 py-2 font-mono whitespace-nowrap tabular-nums">
                    {format.dateTime(new Date(p.capturedAt), {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums">
                    {money(p.initial)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">
                    {money(p.final)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {p.discountPercent > 0 ? (
                      <span className="text-source-official">
                        −{p.discountPercent}%
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TechSheet({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  const { steam, playstation } = game.storeRatings;

  const rows: [string, string][] = [];
  if (game.developer) rows.push([t('developer'), game.developer]);
  if (game.publisher) rows.push([t('publisher'), game.publisher]);
  if (game.releaseDate)
    rows.push([
      t('release'),
      format.dateTime(new Date(game.releaseDate), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    ]);
  if (game.platforms.length > 0)
    rows.push([
      t('platformColumn'),
      game.platforms.map((p) => tPlatform(p)).join(', '),
    ]);
  if (game.genres.length > 0) rows.push([t('genres'), game.genres.join(', ')]);
  if (steam)
    rows.push([
      t('steamLabel'),
      t('storeRatings', {
        count: format.number(steam.reviews, { notation: 'compact' }),
      }),
    ]);
  if (playstation)
    rows.push([
      t('playstationLabel'),
      playstation.score != null
        ? t('storeScoreWithCount', {
            score: playstation.score.toFixed(1),
            count: format.number(playstation.reviews, { notation: 'compact' }),
          })
        : t('storeRatings', {
            count: format.number(playstation.reviews, { notation: 'compact' }),
          }),
    ]);

  // Fixed order and real names — a row of raw enum values reads like a debug
  // dump. Anything unmapped still shows, after the known stores.
  const LINK_LABELS: Record<string, string> = {
    STEAM: 'Steam',
    IGDB: 'IGDB',
    PS_STORE: 'PlayStation Store',
    XBOX_STORE: 'Xbox Store',
    NINTENDO_ESHOP: 'Nintendo eShop',
    TWITCH: 'Twitch',
    WIKIPEDIA: 'Wikipedia',
  };
  const LINK_ORDER = Object.keys(LINK_LABELS);
  const links = game.sources
    .filter((s) => s.url)
    .sort((a, b) => {
      const ia = LINK_ORDER.indexOf(a.source);
      const ib = LINK_ORDER.indexOf(b.source);
      return (
        (ia === -1 ? LINK_ORDER.length : ia) -
        (ib === -1 ? LINK_ORDER.length : ib)
      );
    });

  return (
    <aside className="border-b border-border px-4 py-5 lg:col-start-1 lg:row-start-1 lg:border-r lg:border-b-0">
      <SectionTitle>{t('techTitle')}</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-mono text-[0.64rem] tracking-wider text-muted-foreground uppercase">
              {label}
            </dt>
            <dd className="m-0 text-[0.82rem] break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-soft pt-3 font-mono text-[0.7rem]">
          {links.map((s) => (
            <a
              key={s.id}
              href={s.url ?? '#'}
              rel="nofollow noopener"
              target="_blank"
              className="text-source-media hover:underline"
            >
              {LINK_LABELS[s.source] ?? s.source}
            </a>
          ))}
        </div>
      )}

      {game.summary && (
        <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-muted-foreground">
          {game.summary}
        </p>
      )}
    </aside>
  );
}

type TabKey = 'overview' | 'price';

/**
 * Page tabs as plain links: the server renders the selected one, so the page
 * needs no client JS and every tab has its own shareable URL.
 */
function TabNav({ slug, active }: { slug: string; active: TabKey }) {
  const t = useTranslations('gamePage');
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('tabOverview') },
    { key: 'price', label: t('tabPrice') },
  ];

  return (
    <nav
      aria-label={t('tabsLabel')}
      className="flex gap-1 overflow-x-auto border-b border-border bg-surface-alt px-4 py-2"
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={
              tab.key === 'overview'
                ? `/game/${slug}`
                : `/game/${slug}?tab=${tab.key}`
            }
            aria-current={on ? 'page' : undefined}
            className={`border px-2 py-1.5 font-mono text-[0.7rem] tracking-wide whitespace-nowrap uppercase ${
              on
                ? 'border-primary/40 bg-accent text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function GamePageContent({ game, tab }: { game: GameDetail; tab: TabKey }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  const asOf = asOfDate(game);

  // Xbox review counts are omitted on purpose: the Xbox store only exposes
  // ratings from its US storefront, so the number is not comparable with the
  // worldwide Steam and PlayStation counts sitting next to it.
  const charts = [
    { key: 'steam', label: t('reviewsSteam'), points: game.reviewHistory },
    {
      key: 'playstation',
      label: t('reviewsPlaystation'),
      points: game.psRatingsHistory,
    },
    {
      key: 'switch',
      label: t('reviewsSwitch'),
      points: game.switchRatingsHistory,
    },
    { key: 'ccu', label: t('ccuLabel'), points: game.ccuHistory },
    {
      key: 'followers',
      label: t('followersSeries'),
      points: game.followersHistory,
    },
  ].filter((c) => c.points.length > 1);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    image: game.coverUrl ?? undefined,
    description: game.summary ?? undefined,
    datePublished: game.releaseDate ?? undefined,
    gamePlatform: game.platforms,
  };

  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl">
        <nav className="border-b border-border-soft px-4 py-2 font-mono text-[0.72rem] text-text-faint">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            {t('back')}
          </Link>
          <span className="mx-2">/</span>
          {game.name}
        </nav>

        <GameHeader game={game} />
        <SalesHeadline game={game} />
        <TabNav slug={game.slug} active={tab} />

        {/* Details sit top-left on wide screens; on a phone the figures come
            first and the sheet follows, so the order of importance holds. */}
        <div className="grid lg:grid-cols-[264px_minmax(0,1fr)]">
          <div className="lg:col-start-2 lg:row-start-1">
            {tab === 'price' ? (
              <PriceTab game={game} />
            ) : (
              <>
                <PlatformBreakdown game={game} />

                {charts.length > 0 && (
                  <section className="flex flex-col gap-7 border-b border-border px-4 py-5">
                    {charts.map((chart) => (
                      <RangedChart
                        key={chart.key}
                        points={chart.points}
                        label={chart.label}
                        ariaLabel={t('chartAlt', { series: chart.label })}
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </div>

          <TechSheet game={game} />
        </div>

        <footer className="px-4 py-5 text-xs leading-relaxed text-text-faint">
          {asOf
            ? t('updatedAt', {
                date: format.dateTime(new Date(asOf), {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })
            : t('updatedUnknown')}
        </footer>
      </div>
    </main>
  );
}

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ slug }, { tab }] = await Promise.all([params, searchParams]);
  const game = await getGame(slug);

  if (!game) notFound();

  return (
    <GamePageContent game={game} tab={tab === 'price' ? 'price' : 'overview'} />
  );
}

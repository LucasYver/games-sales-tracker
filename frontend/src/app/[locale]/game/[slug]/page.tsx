import { useTranslations, useFormatter, useLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import { ChartLine } from 'lucide-react';
import {
  getGame,
  getGameRedirect,
  getRelatedGames,
  daysUntilRelease,
  ESTIMATE_PENDING_DAYS,
  headlineUnits,
  isUpcoming,
  listingUnits,
  type GameDetail,
  type Platform,
  type RelatedGame,
  type RelatedGames,
} from '@/lib/api';
import { localeLanguages } from '@/i18n/routing';
import { hubYearOf } from '@/lib/hub-years';
import { ADSENSE_CLIENT, ADSENSE_GAME_SLOT } from '@/lib/ads';
import { SITE_URL } from '@/lib/site-url';
import { Link } from '@/i18n/navigation';
import { AdSlot } from '@/components/AdSlot';
import { InstantGamingLink } from '@/components/InstantGamingLink';
import { instantGamingUrl } from '@/lib/affiliate';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { RangedChart } from '@/components/chart-room/RangedChart';
import { defaultRangeForRelease } from '@/components/chart-room/chart-range';
import {
  PlatformCharts,
  type PlatformChartGroup,
} from '@/components/chart-room/PlatformCharts';
import {
  PriceCountrySelect,
  PriceStoreSelect,
  RegionalPricesTable,
} from '@/components/chart-room/PriceCountrySelect';
import { Suspense } from 'react';
import { GTA6_PATH, GTA6_SLUG } from '@/lib/gta6';
import { MW4_PATH, MW4_SLUG } from '@/lib/mw4';

function compactUnits(units: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(units);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<{ cc?: string; store?: string }>;
}): Promise<Metadata> {
  const [{ slug, locale }, { cc, store }] = await Promise.all([
    params,
    searchParams,
  ]);
  // Same arguments as the page, so both share one fetch instead of calling
  // the API twice per render.
  const [game, t, tPlatform, format] = await Promise.all([
    getGame(slug, cc?.trim() || defaultPriceCountry(locale), store),
    getTranslations({ locale, namespace: 'gamePageMeta' }),
    getTranslations({ locale, namespace: 'platform' }),
    getFormatter({ locale }),
  ]);

  if (!game) return { title: 'Game not found' };

  const year = game.releaseDate
    ? new Date(game.releaseDate).getFullYear()
    : null;
  const units = game.isFree ? null : headlineUnits(game);
  const unitsLabel = units ? compactUnits(units, locale) : null;
  const platforms =
    game.platforms.map((p) => tPlatform(p)).join(', ') || '—';
  const asOf = asOfDate(game);
  const asOfLabel = asOf
    ? format.dateTime(new Date(asOf), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  let title: string;
  let description: string;
  if (game.isFree) {
    title = t('titleFree', { name: game.name });
    description = t('descriptionFree', { name: game.name });
  } else if (unitsLabel) {
    title = t('titleUnits', { name: game.name, units: unitsLabel });
    description = asOfLabel
      ? t('descriptionUnits', {
          name: game.name,
          units: unitsLabel,
          platforms,
          date: asOfLabel,
        })
      : t('descriptionUnitsNoDate', {
          name: game.name,
          units: unitsLabel,
          platforms,
        });
  } else {
    title = year
      ? t('title', { name: game.name, year })
      : t('titleNoYear', { name: game.name });
    description =
      isUpcoming(game.releaseDate) && game.releaseDate
        ? t('descriptionUpcoming', {
            name: game.name,
            date: format.dateTime(new Date(game.releaseDate), {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          })
        : t('description', { name: game.name });
  }
  const url = `/${locale}/game/${game.slug}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: localeLanguages(`/game/${game.slug}`),
    },
    openGraph: {
      title,
      description,
      type: 'article',
      locale,
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

/** The date that qualifies the headline: when we last recomputed the estimate. */
function asOfDate(game: GameDetail): string | null {
  return game.estimateSnapshots.at(-1)?.computedAt ?? null;
}

/** Single figure per platform, from the same midpoint rule as the headline. */
function platformUnits(low: number, high: number): number {
  const mid = (low + high) / 2;
  const step = mid >= 1_000_000 ? 100_000 : 10_000;
  return Math.max(step, Math.round(mid / step) * step);
}

function gamePageHref(
  slug: string,
  opts: { tab?: string; cc?: string; store?: string },
): string {
  const params = new URLSearchParams();
  if (opts.tab) params.set('tab', opts.tab);
  if (opts.cc) params.set('cc', opts.cc);
  if (opts.store && opts.store !== 'steam') params.set('store', opts.store);
  const qs = params.toString();
  return qs ? `/game/${slug}?${qs}` : `/game/${slug}`;
}

function defaultPriceCountry(locale: string): string {
  return locale === 'en' ? 'us' : locale;
}

/** GTA 6 and MW4 get a dedicated tracker; their game page points there. */
const TRACKERS: Record<string, { path: string; ns: 'gta6Sales' | 'mw4Sales' }> =
  {
    [GTA6_SLUG]: { path: GTA6_PATH, ns: 'gta6Sales' },
    [MW4_SLUG]: { path: MW4_PATH, ns: 'mw4Sales' },
  };

function TrackerLink({ slug }: { slug: string }) {
  const tracker = TRACKERS[slug];
  const t = useTranslations(tracker?.ns ?? 'gta6Sales');
  if (!tracker) return null;
  return (
    <Link
      href={tracker.path}
      className="mx-4 mt-3 flex items-center gap-2 rounded-[3px] border border-primary/40 bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:underline"
    >
      <ChartLine className="size-4 shrink-0" aria-hidden />
      {t('gamePageLink')}
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
      {children}
    </h2>
  );
}

function GameHeader({
  game,
  studioHub,
}: {
  game: GameDetail;
  studioHub: RelatedGames['studioHub'];
}) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  const locale = useLocale();
  const units = game.isFree ? null : headlineUnits(game);
  const unitsLabel = units ? compactUnits(units, locale) : null;

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
          {game.isFree
            ? t('headingFree', { name: game.name })
            : t('heading', { name: game.name })}
          {unitsLabel && (
            <span className="mt-1 block font-mono text-base font-semibold text-muted-foreground">
              {t('headingUnits', { units: unitsLabel })}
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {studioHub ? (
            <Link
              href={`/studio/${studioHub.slug}`}
              className="text-primary hover:underline"
            >
              {game.developer}
            </Link>
          ) : (
            game.developer
          )}
          {game.developer && game.releaseDate && ' · '}
          {game.releaseDate &&
            t(isUpcoming(game.releaseDate) ? 'releasesOn' : 'releasedOn', {
              date: format.dateTime(new Date(game.releaseDate), {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }),
            })}
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
        {game.summary && (
          <p className="mt-3 max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
            {game.summary}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * Steam only sees the players of a game started from Steam. Call of Duty and
 * a few others are played in a publisher launcher: the Steam app collects
 * thousands of reviews while Steam reports 0-2 concurrent players. A CCU that
 * low next to that many reviews is the launcher, not the audience, so it is
 * not shown.
 */
const LAUNCHER_MIN_REVIEWS = 1000;
const LAUNCHER_MAX_PEAK_CCU = 50;

function steamCcuIsMeaningful(game: GameDetail): boolean {
  const reviews = game.reviewHistory.at(-1)?.value ?? 0;
  const peak = game.peakCcu?.value ?? 0;
  return !(reviews >= LAUNCHER_MIN_REVIEWS && peak < LAUNCHER_MAX_PEAK_CCU);
}

/** The answer the visitor came for, before anything else on the page. */
function SalesHeadline({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();

  const units = game.isFree ? null : headlineUnits(game);
  const asOf = asOfDate(game);
  const asOfLabel = asOf
    ? format.dateTime(new Date(asOf), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const peakDate = game.peakCcu
    ? format.dateTime(new Date(game.peakCcu.capturedAt), {
        year: 'numeric',
        month: 'short',
      })
    : null;
  const upcoming = isUpcoming(game.releaseDate);
  const releaseLabel = game.releaseDate
    ? format.dateTime(new Date(game.releaseDate), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const daysToRelease = game.releaseDate
    ? daysUntilRelease(game.releaseDate)
    : null;
  // Out a few days, no estimate yet: the next rebuild on post-launch signals
  // publishes the first one.
  const estimatePending =
    !upcoming &&
    !game.isFree &&
    !game.estimateOutOfScope &&
    !game.estimateUnavailable &&
    !units &&
    daysToRelease != null &&
    -daysToRelease <= ESTIMATE_PENDING_DAYS;
  const showCcu = !upcoming && steamCcuIsMeaningful(game);
  const recentCcu = showCcu ? (game.ccuHistory.at(-1) ?? null) : null;
  const recentCcuDate = recentCcu
    ? format.dateTime(new Date(recentCcu.capturedAt), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const showPrice = !game.isFree && game.currentPrice != null;
  const instantGaming = instantGamingUrl(game, locale);
  const hasCcuHeadline = recentCcu != null || (showCcu && game.peakCcu != null);

  return (
    <section className="border-b border-border px-4 py-5">
      <div
        className={
          hasCcuHeadline
            ? 'grid gap-6 sm:grid-cols-3 sm:items-end'
            : undefined
        }
      >
        <div>
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
              <Link
                href="/methodology"
                className="mt-1 inline-block font-mono text-xs text-primary hover:underline"
              >
                {t('methodologyLink')}
              </Link>
            </>
          ) : upcoming && releaseLabel ? (
            <>
              <p className="mt-1 font-mono text-xl font-bold text-muted-foreground">
                {t('upcomingTitle')}
                {daysToRelease != null && daysToRelease > 0 && (
                  <span className="ml-2 text-base text-primary">
                    · {t('upcomingCountdown', { days: daysToRelease })}
                  </span>
                )}
              </p>
              <p className="mt-1 max-w-[46ch] text-sm text-muted-foreground">
                {t('upcomingNote', { date: releaseLabel })}
              </p>
              <Link
                href="/methodology"
                className="mt-1 inline-block font-mono text-xs text-primary hover:underline"
              >
                {t('methodologyLink')}
              </Link>
            </>
          ) : estimatePending ? (
            <>
              <p className="mt-1 font-mono text-xl font-bold text-muted-foreground">
                {t('estimatePendingTitle')}
              </p>
              <p className="mt-1 max-w-[46ch] text-sm text-muted-foreground">
                {t('estimatePendingNote', { date: releaseLabel ?? '' })}
              </p>
            </>
          ) : game.estimateOutOfScope || game.estimateUnavailable ? (
            <>
              <p className="mt-1 font-mono text-xl font-bold text-muted-foreground">
                {t('outOfScopeTitle')}
              </p>
              <p className="mt-1 max-w-[42ch] text-sm text-muted-foreground">
                {t(
                  game.estimateHidden
                    ? 'hiddenEstimateNote'
                    : game.estimateUnavailable
                      ? 'unavailableEstimateNote'
                      : 'outOfScopeNote',
                )}
              </p>
              <Link
                href="/methodology"
                className="mt-1 inline-block font-mono text-xs text-primary hover:underline"
              >
                {t('methodologyLink')}
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('noData')}</p>
          )}
        </div>
        {recentCcu && recentCcuDate && (
          <div>
            <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
              {t('recentCcuLabel')}
            </p>
            <p className="mt-1 font-mono text-3xl leading-none font-bold tabular-nums sm:text-4xl">
              {format.number(recentCcu.value)}
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {t('recentCcuHint', { date: recentCcuDate })}
            </p>
          </div>
        )}
        {showCcu && game.peakCcu && peakDate && (
          <div>
            <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
              {t('peakCcuLabel')}
            </p>
            <p className="mt-1 font-mono text-3xl leading-none font-bold tabular-nums sm:text-4xl">
              {format.number(game.peakCcu.value)}
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {t('peakCcuHint', { date: peakDate })}
            </p>
          </div>
        )}
      </div>
      {(showPrice || instantGaming) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border-soft pt-3">
          {showPrice && <PriceBlock game={game} preorder={upcoming} />}
          {instantGaming && (
            <InstantGamingLink
              href={instantGaming}
              game={game.slug}
              placement="price"
              label={t(
                upcoming ? 'instantGamingPreorder' : 'instantGamingBuy',
              )}
              note={t('affiliateLink')}
            />
          )}
        </div>
      )}
    </section>
  );
}

function OfficialSalesRecap({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const locale = useLocale();
  const slug = game.blog?.slugByLocale?.[locale];
  if (!slug) return null;
  return (
    <aside className="border-b border-border px-4 py-3">
      <p className="font-mono text-[0.68rem] tracking-wide text-text-faint uppercase">
        {t('officialRecapLead')}
      </p>
      <Link
        href={`/blog/${slug}`}
        className="mt-1 inline-block text-sm text-primary hover:underline"
      >
        {t('officialRecap', { name: game.name })}
      </Link>
    </aside>
  );
}

/**
 * Current price, and the discount louder than the price itself when one is
 * running — that is the thing a visitor scanning the page wants to catch.
 */
function PriceBlock({
  game,
  preorder = false,
}: {
  game: GameDetail;
  /** Not out yet: the price is a pre-order, its history means little. */
  preorder?: boolean;
}) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  if (game.isFree) return null;

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
        {preorder
          ? t('pricePreorder')
          : atLowest
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

  if (game.isFree || isUpcoming(game.releaseDate)) return null;

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

/**
 * Stands in for the charts before launch, so the column says when they start
 * instead of sitting empty next to the tech sheet.
 */
function UpcomingCharts({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();
  if (!game.releaseDate) return null;

  return (
    <section className="border-b border-border px-4 py-5">
      <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-muted-foreground/40 px-6 py-8 text-center">
        <ChartLine aria-hidden className="size-5 text-text-faint" />
        <p className="mt-2 font-mono text-sm font-semibold">
          {t('upcomingChartsTitle', {
            date: format.dateTime(new Date(game.releaseDate), {
              month: 'long',
              day: 'numeric',
            }),
          })}
        </p>
        <p className="mt-1 max-w-[40ch] text-xs leading-relaxed text-muted-foreground">
          {t('upcomingChartsNote')}
        </p>
      </div>
    </section>
  );
}

/** Everything about the price, on its own tab: the curve then the raw log. */
function PriceTab({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  const currency = game.currentPrice?.currency ?? 'USD';
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency });
  const rows = [...game.priceHistory].reverse();

  return (
    <section className="border-b border-border px-4 py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[0.8rem] font-bold tracking-wider uppercase">
          {t('priceTitle')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense>
            <PriceStoreSelect
              stores={game.availablePriceStores}
              value={game.priceStore}
            />
          </Suspense>
          <Suspense>
            <PriceCountrySelect
              countries={game.regionalPrices}
              value={game.priceCountry}
            />
          </Suspense>
        </div>
      </div>
      <div className="flex flex-col gap-5">
        {game.priceHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('priceNoHistory')}</p>
        ) : (
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
        )}

        {game.regionalPrices.length > 0 && (
          <div>
            <h3 className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
              {t('priceRegionsTitle')}
            </h3>
            <RegionalPricesTable countries={game.regionalPrices} />
          </div>
        )}
      </div>
    </section>
  );
}

// Steam language codes to BCP 47, so the browser's Intl names them in the
// visitor's language. Anything unmapped falls into "other".
const STEAM_LANGUAGES: Record<string, string> = {
  arabic: 'ar',
  brazilian: 'pt-BR',
  bulgarian: 'bg',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hungarian: 'hu',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  koreana: 'ko',
  latam: 'es-419',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt-PT',
  romanian: 'ro',
  russian: 'ru',
  schinese: 'zh-Hans',
  spanish: 'es-ES',
  swedish: 'sv',
  tchinese: 'zh-Hant',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
};
// Under this, a share moves too much from one review to the next to be shown.
const MIN_REVIEW_LANGUAGE_SAMPLE = 100;
const REVIEW_LANGUAGES_SHOWN = 5;

function ReviewLanguages({ counts }: { counts: Record<string, number> }) {
  const t = useTranslations('gamePage');
  const locale = useLocale();
  const format = useFormatter();

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total < MIN_REVIEW_LANGUAGE_SAMPLE) return null;

  const names = new Intl.DisplayNames(locale, { type: 'language' });
  const known = Object.entries(counts)
    .filter(([code]) => STEAM_LANGUAGES[code])
    .sort(([, a], [, b]) => b - a)
    .slice(0, REVIEW_LANGUAGES_SHOWN);
  const shown = known.reduce((sum, [, n]) => sum + n, 0);
  const rows: [string, number][] = known.map(([code, n]) => [
    names.of(STEAM_LANGUAGES[code]) ?? code,
    n / total,
  ]);
  if (total > shown)
    rows.push([t('reviewLanguagesOther'), (total - shown) / total]);

  return (
    <div className="mt-4 border-t border-border-soft pt-3">
      <h3 className="mb-2 font-mono text-[0.64rem] tracking-wider text-muted-foreground uppercase">
        {t('reviewLanguagesTitle')}
      </h3>
      <ul className="m-0 list-none space-y-1.5 p-0 text-[0.82rem]">
        {rows.map(([label, share]) => (
          <li key={label}>
            <div className="flex justify-between gap-3">
              <span className="first-letter:uppercase">{label}</span>
              <span className="font-mono text-[0.75rem] text-muted-foreground">
                {format.number(share, { style: 'percent' })}
              </span>
            </div>
            <div className="mt-0.5 h-1 bg-muted" aria-hidden="true">
              <div
                className="h-full bg-primary"
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 mb-0 text-[0.7rem] leading-snug text-muted-foreground">
        {t('reviewLanguagesNote', { count: format.number(total) })}
      </p>
    </div>
  );
}

function TechSheet({
  game,
  related,
}: {
  game: GameDetail;
  related: RelatedGames;
}) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  const locale = useLocale();
  // Before launch, store ratings and review languages are teasers, not sales
  // signals: they come back with the rest of the data on release day.
  const upcoming = isUpcoming(game.releaseDate);
  const { steam, playstation, xbox } = upcoming
    ? { steam: null, playstation: null, xbox: null }
    : game.storeRatings;

  const hubLink = (href: string, label: React.ReactNode) => (
    <Link href={href} className="text-primary hover:underline">
      {label}
    </Link>
  );
  const studioHref = related.studioHub && `/studio/${related.studioHub.slug}`;
  const releaseYear = hubYearOf(game.releaseDate);

  const rows: [string, React.ReactNode][] = [];
  if (game.developer)
    rows.push([
      t('developer'),
      studioHref ? hubLink(studioHref, game.developer) : game.developer,
    ]);
  if (game.publisher)
    rows.push([
      t('publisher'),
      related.publisherHub
        ? hubLink(`/publisher/${related.publisherHub.slug}`, game.publisher)
        : game.publisher,
    ]);
  if (related.franchiseHub)
    rows.push([
      t('franchise'),
      hubLink(
        `/franchise/${related.franchiseHub.slug}`,
        related.franchiseHub.name,
      ),
    ]);
  if (game.releaseDate) {
    const released = format.dateTime(new Date(game.releaseDate), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    rows.push([
      t('release'),
      releaseYear ? hubLink(`/year/${releaseYear}`, released) : released,
    ]);
  }
  if (game.platforms.length > 0)
    rows.push([
      t('platformColumn'),
      game.platforms.map((p) => tPlatform(p)).join(', '),
    ]);
  if (game.genres.length > 0) rows.push([t('genres'), game.genres.join(', ')]);

  // IGDB facts (backend `games/igdb-facts.ts`). A main game needs no type row.
  const { gameType, parentGame, derivedGames, gameModes } = game.igdbFacts;
  if (gameType && gameType !== 'MAIN_GAME') {
    const typeLabel = t(`gameType.${gameType}`);
    rows.push([
      t('gameTypeLabel'),
      parentGame
        ? t.rich('derivedFrom', {
            type: typeLabel,
            name: parentGame.name,
            game: (chunks) =>
              parentGame.slug
                ? hubLink(`/game/${parentGame.slug}`, chunks)
                : chunks,
          })
        : typeLabel,
    ]);
  }
  if (derivedGames.length > 0)
    rows.push([
      t('derivedGamesLabel'),
      derivedGames.map((derived, i) => (
        <span key={derived.slug}>
          {i > 0 && ', '}
          {hubLink(`/game/${derived.slug}`, derived.name)}
          {derived.gameType && derived.gameType !== 'MAIN_GAME' && (
            <span className="text-muted-foreground">
              {' '}
              ({t(`gameType.${derived.gameType}`)})
            </span>
          )}
        </span>
      )),
    ]);
  // Commercial editions (backend `GameEdition`): the sales above cover them.
  if (game.editions.length > 0)
    rows.push([
      t('editionsLabel'),
      <>
        {game.editions.map((edition) => (
          <span key={edition.name} className="block">
            {edition.versionTitle ?? edition.name}
          </span>
        ))}
        <span className="block text-[0.7rem] text-muted-foreground">
          {t('editionsNote')}
        </span>
      </>,
    ]);
  if (gameModes.length > 0)
    rows.push([
      t('gameModesLabel'),
      gameModes.map((mode) => t(`gameMode.${mode}`)).join(', '),
    ]);

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
  if (xbox)
    rows.push([
      t('xboxLabel'),
      xbox.score != null
        ? t('storeScoreWithCount', {
            score: xbox.score.toFixed(1),
            count: format.number(xbox.reviews, { notation: 'compact' }),
          })
        : t('storeRatings', {
            count: format.number(xbox.reviews, { notation: 'compact' }),
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
  const links: { key: string; url: string; label: string }[] = game.sources
    // The affiliate link has its own markup, appended after the store links.
    .filter((s) => s.url && s.source !== 'INSTANT_GAMING')
    .sort((a, b) => {
      const ia = LINK_ORDER.indexOf(a.source);
      const ib = LINK_ORDER.indexOf(b.source);
      return (
        (ia === -1 ? LINK_ORDER.length : ia) -
        (ib === -1 ? LINK_ORDER.length : ib)
      );
    })
    .map((s) => ({
      key: s.id,
      url: s.url as string,
      label: LINK_LABELS[s.source] ?? s.source,
    }));
  const instantGaming = instantGamingUrl(game, locale);
  // Store pages IGDB links that we do not track ourselves.
  if (game.otherStores.epicUrl)
    links.push({
      key: 'epic',
      url: game.otherStores.epicUrl,
      label: 'Epic Games Store',
    });
  if (game.otherStores.gogUrl)
    links.push({ key: 'gog', url: game.otherStores.gogUrl, label: 'GOG' });

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

      {!upcoming && game.reviewLanguages && (
        <ReviewLanguages counts={game.reviewLanguages} />
      )}

      {(links.length > 0 || instantGaming) && (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-soft pt-3 font-mono text-[0.7rem]">
          {links.map((link) => (
            <a
              key={link.key}
              href={link.url}
              rel="nofollow noopener"
              target="_blank"
              className="text-source-media hover:underline"
            >
              {link.label}
            </a>
          ))}
          {instantGaming && (
            <InstantGamingLink
              href={instantGaming}
              game={game.slug}
              placement="links"
              label="Instant Gaming"
            />
          )}
        </div>
      )}
    </aside>
  );
}

type TabKey = 'overview' | 'price';

/**
 * Page tabs as plain links: the server renders the selected one, so the page
 * needs no client JS and every tab has its own shareable URL.
 */
function TabNav({
  slug,
  active,
  showPrice,
  cc,
  store,
}: {
  slug: string;
  active: TabKey;
  showPrice: boolean;
  cc?: string;
  store?: string;
}) {
  const t = useTranslations('gamePage');
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('tabOverview') },
    ...(showPrice ? [{ key: 'price' as const, label: t('tabPrice') }] : []),
  ];

  if (tabs.length < 2) return null;

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
            href={gamePageHref(slug, {
              tab: tab.key === 'price' ? 'price' : undefined,
              cc,
              store,
            })}
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

function RelatedList({
  title,
  games,
  more,
}: {
  title: string;
  games: RelatedGame[];
  /** Link to the hub page, when the franchise or studio has one. */
  more: { href: string; label: string } | null;
}) {
  const tCommon = useTranslations('common');
  const locale = useLocale();

  return (
    <div className="min-w-0 border-b border-border px-4 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <SectionTitle>{title}</SectionTitle>
        {more && (
          <Link
            href={more.href}
            className="mb-3 text-[0.8rem] text-primary hover:underline"
          >
            {more.label}
          </Link>
        )}
      </div>
      <ul>
        {games.map((game) => {
          const sold = listingUnits(game);
          const meta = [game.genres[0], game.releaseDate?.slice(0, 4)]
            .filter(Boolean)
            .join(' · ');

          return (
            <li
              key={game.id}
              className="flex items-center gap-2.5 border-b border-border-soft p-2 odd:bg-surface-alt hover:bg-accent"
            >
              <div className="relative size-8 shrink-0 overflow-hidden rounded-[2px] bg-muted">
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
              <div className="min-w-0 flex-1">
                <Link
                  href={`/game/${game.slug}`}
                  className="font-semibold text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {game.name}
                </Link>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {meta}
                </div>
              </div>
              <div className="shrink-0 font-mono font-semibold tabular-nums">
                {game.isFree ? (
                  <span className="text-source-official">
                    {tCommon('freeToPlay')}
                  </span>
                ) : sold ? (
                  compactUnits(sold, locale)
                ) : isUpcoming(game.releaseDate) ? (
                  <span className="text-muted-foreground">
                    {tCommon('upcoming')}
                  </span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GamePageContent({
  game,
  tab,
  related,
  requestedCountry,
}: {
  game: GameDetail;
  tab: TabKey;
  related: RelatedGames;
  /** `cc` from the URL only: the default country stays out of the tab links. */
  requestedCountry?: string;
}) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  const locale = useLocale();

  const activeTab: TabKey = game.isFree ? 'overview' : tab;

  const asOf = asOfDate(game);

  // Platform tabs on top; only storefronts the game ships on.
  const onPlatform = new Set(game.platforms);
  const platformGroups: PlatformChartGroup[] = [
    onPlatform.has('PC') && {
      platform: 'PC',
      label: tPlatform('PC'),
      store: 'Steam',
      charts: [
        ...(steamCcuIsMeaningful(game)
          ? [{ key: 'ccu', label: t('ccuLabel'), points: game.ccuHistory }]
          : []),
        {
          key: 'reviews',
          label: t('reviewsTitle'),
          points: game.reviewHistory,
          cumulative: true,
        },
        {
          key: 'followers',
          label: t('followersLabel'),
          points: game.followersHistory,
          cumulative: true,
        },
      ],
    },
    onPlatform.has('PLAYSTATION') && {
      platform: 'PLAYSTATION',
      label: tPlatform('PLAYSTATION'),
      store: 'PlayStation Store',
      charts: [
        {
          key: 'ratings',
          label: t('ratingsLabel'),
          points: game.psRatingsHistory,
          cumulative: true,
        },
      ],
    },
    onPlatform.has('XBOX') && {
      platform: 'XBOX',
      label: tPlatform('XBOX'),
      store: 'Xbox Store',
      charts: [
        {
          key: 'ratings',
          label: t('ratingsLabel'),
          points: game.xboxRatingsHistory,
          cumulative: true,
        },
      ],
    },
    onPlatform.has('SWITCH') && {
      platform: 'SWITCH',
      label: tPlatform('SWITCH'),
      store: 'Nintendo eShop',
      charts: [
        {
          key: 'ratings',
          label: t('ratingsLabel'),
          points: game.switchRatingsHistory,
          cumulative: true,
        },
      ],
    },
  ].filter((group): group is PlatformChartGroup => Boolean(group));
  // No data shown before launch: the page says when it arrives instead.
  const upcoming = isUpcoming(game.releaseDate);
  // Charts open on the smallest period covering the game's life since launch.
  const chartDefaultRange = defaultRangeForRelease(game.releaseDate);
  const hasPlatformCharts =
    !upcoming &&
    platformGroups.some((group) =>
    group.charts.some((chart) => chart.points.length > 1),
  );

  // Twitch is cross-platform — outside the storefront tabs.
  const twitchChart =
    !upcoming && game.twitchViewersHistory.length > 1
      ? game.twitchViewersHistory
      : null;

  const gameUrl = `${SITE_URL}/${locale}/game/${game.slug}`;
  // The studio when it has a page, else the franchise, else the publisher.
  const parentCrumb = related.studioHub
    ? {
        href: `/studio/${related.studioHub.slug}`,
        name: related.studioHub.name,
      }
    : related.franchiseHub
      ? {
          href: `/franchise/${related.franchiseHub.slug}`,
          name: related.franchiseHub.name,
        }
      : related.publisherHub
        ? {
            href: `/publisher/${related.publisherHub.slug}`,
            name: related.publisherHub.name,
          }
        : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        name: game.name,
        url: gameUrl,
        image: game.coverUrl ?? undefined,
        description: game.summary ?? undefined,
        datePublished: game.releaseDate ?? undefined,
        gamePlatform: game.platforms.map((p) => tPlatform(p)),
        author: game.developer
          ? { '@type': 'Organization', name: game.developer }
          : undefined,
        publisher: game.publisher
          ? { '@type': 'Organization', name: game.publisher }
          : undefined,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: t('back'),
            item: `${SITE_URL}/${locale}`,
          },
          ...(parentCrumb
            ? [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: parentCrumb.name,
                  item: `${SITE_URL}/${locale}${parentCrumb.href}`,
                },
              ]
            : []),
          {
            '@type': 'ListItem',
            position: parentCrumb ? 3 : 2,
            name: game.name,
            item: gameUrl,
          },
        ],
      },
    ],
  };

  const relatedLists = [
    {
      title: t('relatedFranchise'),
      games: related.franchise,
      more: related.franchiseHub && {
        href: `/franchise/${related.franchiseHub.slug}`,
        label: t('relatedAllFranchise', { name: related.franchiseHub.name }),
      },
    },
    {
      title: t('relatedStudio'),
      games: related.studio,
      more: related.studioHub && {
        href: `/studio/${related.studioHub.slug}`,
        label: t('relatedAllStudio', { name: related.studioHub.name }),
      },
    },
  ].filter((list) => list.games.length > 0);

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
          {parentCrumb && (
            <>
              <Link
                href={parentCrumb.href}
                className="text-muted-foreground hover:text-primary"
              >
                {parentCrumb.name}
              </Link>
              <span className="mx-2">/</span>
            </>
          )}
          {game.name}
        </nav>

        <GameHeader game={game} studioHub={related.studioHub} />
        <TrackerLink slug={game.slug} />
        <SalesHeadline game={game} />
        <OfficialSalesRecap game={game} />
        <TabNav
          slug={game.slug}
          active={activeTab}
          showPrice={!game.isFree}
          cc={requestedCountry}
          store={game.priceStore}
        />

        {/* Details sit top-left on wide screens; on a phone the figures come
            first and the sheet follows, so the order of importance holds. */}
        <div className="grid lg:grid-cols-[264px_minmax(0,1fr)]">
          <div className="lg:col-start-2 lg:row-start-1">
            {activeTab === 'price' ? (
              <PriceTab game={game} />
            ) : (
              <>
                <PlatformBreakdown game={game} />

                {upcoming && <UpcomingCharts game={game} />}

                {hasPlatformCharts && (
                  <section className="border-b border-border px-4 py-5">
                    <Suspense>
                      <PlatformCharts
                        groups={platformGroups}
                        defaultRange={chartDefaultRange}
                      />
                    </Suspense>
                  </section>
                )}

                {twitchChart && (
                  <section className="border-b border-border px-4 py-5">
                    <Suspense>
                      <RangedChart
                        points={twitchChart}
                        label={t('twitchViewersSeries')}
                        description={t('chartsSource', { store: 'Twitch' })}
                        syncRangeUrl
                        defaultRange={chartDefaultRange}
                        ariaLabel={t('chartAlt', {
                          series: t('twitchViewersSeries'),
                        })}
                      />
                    </Suspense>
                  </section>
                )}
              </>
            )}
          </div>

          <TechSheet game={game} related={related} />
        </div>

        {relatedLists.length > 0 && (
          <section
            aria-label={t('relatedLabel')}
            className={`grid border-t border-border ${
              relatedLists.length > 1 ? 'md:grid-cols-2' : ''
            }`}
          >
            {relatedLists.map((list) => (
              <RelatedList
                key={list.title}
                title={list.title}
                games={list.games}
                more={list.more}
              />
            ))}
          </section>
        )}

        {ADSENSE_CLIENT && ADSENSE_GAME_SLOT && (
          <AdSlot
            key={game.slug}
            client={ADSENSE_CLIENT}
            slot={ADSENSE_GAME_SLOT}
            label={t('adLabel')}
          />
        )}

        <footer className="px-4 py-5 text-xs leading-relaxed text-text-faint">
          {upcoming
            ? t('updatedUpcoming')
            : asOf
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
  searchParams: Promise<{ tab?: string; cc?: string; store?: string }>;
}) {
  const [{ slug, locale }, { tab, cc, store }] = await Promise.all([
    params,
    searchParams,
  ]);
  const country = cc?.trim() || defaultPriceCountry(locale);
  const [game, related] = await Promise.all([
    getGame(slug, country, store),
    getRelatedGames(slug),
  ]);

  if (!game) {
    // An edition game merged into its base keeps its old URL alive.
    const target = await getGameRedirect(slug);
    if (target) permanentRedirect(`/${locale}/game/${target}`);
    notFound();
  }

  return (
    <GamePageContent
      game={game}
      tab={tab === 'price' ? 'price' : 'overview'}
      related={related}
      requestedCountry={cc?.trim() || undefined}
    />
  );
}

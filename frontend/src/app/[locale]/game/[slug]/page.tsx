import { useTranslations, useFormatter } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import {
  getGame,
  type ConfidenceLevel,
  type GameDetail,
  type Platform,
  type StoreRatings,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { SalesHistoryChart } from '@/components/SalesHistoryChart';
import { MethodologyCard } from '@/components/MethodologyCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function compact(
  n: number,
  format: ReturnType<typeof useFormatter>,
): string {
  return format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
}

function range(
  low: number,
  high: number,
  format: ReturnType<typeof useFormatter>,
): string {
  return low === high
    ? compact(low, format)
    : `${compact(low, format)} – ${compact(high, format)}`;
}

function headlineConfidence(total: GameDetail['totalSales']): ConfidenceLevel {
  if (total?.confidence) return total.confidence;
  if (total?.basis === 'reported') return 'MEDIUM';
  return 'LOW';
}

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

function GameInfoCard({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');

  const hasInfo =
    game.developer || game.publisher || game.genres.length > 0;
  const hasRatings =
    game.storeRatings.steam ||
    game.storeRatings.playstation ||
    game.storeRatings.xbox;

  if (!hasInfo && !hasRatings) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {hasInfo && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t('infoTitle')}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {game.developer && (
                <>
                  <dt className="text-muted-foreground font-medium">
                    {t('developer')}
                  </dt>
                  <dd>{game.developer}</dd>
                </>
              )}
              {game.publisher && (
                <>
                  <dt className="text-muted-foreground font-medium">
                    {t('publisher')}
                  </dt>
                  <dd>{game.publisher}</dd>
                </>
              )}
              {game.genres.length > 0 && (
                <>
                  <dt className="text-muted-foreground font-medium">
                    {t('genres')}
                  </dt>
                  <dd>{game.genres.join(', ')}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
      {hasRatings && (
        <StoreRatingsCard ratings={game.storeRatings} />
      )}
    </div>
  );
}

function StoreRatingsCard({ ratings }: { ratings: StoreRatings }) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  const rows: {
    label: string;
    reviews: number;
    score: number | null;
    medianPlaytimeMinutes: number | null;
  }[] = [];
  if (ratings.steam) {
    rows.push({
      label: 'Steam',
      reviews: ratings.steam.reviews,
      score: null,
      medianPlaytimeMinutes: ratings.steam.reviewerMedianPlaytimeMinutes,
    });
  }
  if (ratings.playstation) {
    rows.push({
      label: 'PlayStation',
      reviews: ratings.playstation.reviews,
      score: ratings.playstation.score,
      medianPlaytimeMinutes: null,
    });
  }
  if (ratings.xbox) {
    rows.push({
      label: 'Xbox',
      reviews: ratings.xbox.reviews,
      score: ratings.xbox.score,
      medianPlaytimeMinutes: null,
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {t('ratingsTitle')}
        </h2>
        <ul className="flex flex-col gap-2">
          {rows.map(({ label, reviews, score, medianPlaytimeMinutes }) => (
            <li
              key={label}
              className="flex items-start justify-between text-sm"
            >
              <span className="text-muted-foreground font-medium">{label}</span>
              <span className="flex flex-col items-end text-right">
                <span>
                  {score !== null && (
                    <span className="mr-1 font-semibold">
                      ★ {t('storeScore', { score: score.toFixed(1) })}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {label === 'Steam'
                      ? t('steamReviews', {
                          count: format.number(reviews, {
                            notation: 'compact',
                          }),
                        })
                      : t('storeRatings', {
                          count: format.number(reviews, {
                            notation: 'compact',
                          }),
                        })}
                  </span>
                </span>
                {medianPlaytimeMinutes !== null && (
                  <span className="text-muted-foreground text-xs">
                    {t('reviewerMedianPlaytime', {
                      hours: format.number(medianPlaytimeMinutes / 60, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function GameHero({
  game,
  platformLabel,
}: {
  game: GameDetail;
  platformLabel: (p: Platform) => string;
}) {
  const t = useTranslations('gamePage');
  const format = useFormatter();

  return (
    <section
      aria-label={game.name}
      className="relative isolate overflow-hidden border-b border-border/60"
    >
      {game.coverUrl && (
        <div aria-hidden className="absolute inset-0 -z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={game.coverUrl}
            alt=""
            className="h-full w-full scale-110 object-cover blur-2xl brightness-75 saturate-150"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-6 pb-10 sm:pt-8 sm:pb-14">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/">
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t('back')}
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          {game.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.coverUrl}
              alt={`${game.name} cover`}
              className="ring-foreground/10 h-auto w-40 shrink-0 rounded-2xl object-cover shadow-2xl ring-1 sm:w-56 lg:w-64"
            />
          )}
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-bold tracking-tight drop-shadow-sm sm:text-5xl">
              {game.name}
            </h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {game.releaseDate && (
                <time dateTime={game.releaseDate}>
                  {t('releasedOn', {
                    date: format.dateTime(new Date(game.releaseDate), {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    }),
                  })}
                </time>
              )}
              {game.developer && (
                <>
                  <span aria-hidden>·</span>
                  <span>{game.developer}</span>
                </>
              )}
            </div>
            {game.platforms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {game.platforms.map((p) => (
                  <Badge key={p} variant="secondary">
                    {platformLabel(p)}
                  </Badge>
                ))}
              </div>
            )}
            {game.summary && (
              <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
                {game.summary}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function GamePageContent({ game }: { game: GameDetail }) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const { totalSales, estimateSnapshots } = game;
  const todayEstimate = game.estimatedToday;
  const confidence = headlineConfidence(totalSales);
  const platformLabel = (p: Platform) => tPlatform(p);

  // JSON-LD VideoGame schema for SEO. We expose the public-facing fields
  // (name, cover, platforms, release date) — never the internal source
  // pipeline.
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

      <GameHero game={game} platformLabel={platformLabel} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-10">
        {todayEstimate ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
                  {t('estimateTitle')}
                </h2>
                <ConfidenceBadge level={confidence} />
              </div>

              <p className="text-primary text-5xl font-bold tracking-tight tabular-nums">
                {range(todayEstimate.low, todayEstimate.high, format)}
              </p>
              <p className="text-muted-foreground text-sm">
                {tCommon('units')} · {t('asOfNow')}
              </p>
            </CardContent>
          </Card>
        ) : game.isFree ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-lg font-semibold text-emerald-600">
                {tCommon('freeToPlay')}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('freeToPlayNote')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground">{t('noData')}</p>
            </CardContent>
          </Card>
        )}

        <GameInfoCard game={game} />

        <SalesHistoryChart snapshots={estimateSnapshots} />

        <MethodologyCard />
      </div>
    </main>
  );
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug } = await params;
  const game = await getGame(slug);

  if (!game) notFound();

  return <GamePageContent game={game} />;
}

import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  listingUnits,
  type GameHub,
  type HubIndexItem,
  type PopularGame,
} from '@/lib/api';
import { SITE_URL } from '@/lib/site-url';
import { GamesTable } from '@/components/chart-room/GamesTable';
import { SiteHeader } from '@/components/chart-room/SiteHeader';

/** BreadcrumbList and ItemList shared by the studio, franchise and year pages. */
export function HubJsonLd({
  locale,
  path,
  title,
  homeLabel,
  parent,
  games,
  offset = 0,
}: {
  locale: string;
  path: string;
  title: string;
  homeLabel: string;
  /** Index page between the home page and this one. */
  parent?: { path: string; label: string };
  games: PopularGame[];
  offset?: number;
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: homeLabel,
            item: `${SITE_URL}/${locale}`,
          },
          ...(parent
            ? [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: parent.label,
                  item: `${SITE_URL}/${locale}${parent.path}`,
                },
              ]
            : []),
          {
            '@type': 'ListItem',
            position: parent ? 3 : 2,
            name: title,
            item: `${SITE_URL}/${locale}${path}`,
          },
        ],
      },
      ...(games.length > 0
        ? [
            {
              '@type': 'ItemList',
              itemListElement: games.map((game, index) => ({
                '@type': 'ListItem',
                position: offset + index + 1,
                url: `${SITE_URL}/${locale}/game/${game.slug}`,
                name: game.name,
              })),
            },
          ]
        : []),
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export function HubBreadcrumb({
  current,
  parent,
}: {
  current: string;
  parent?: { path: string; label: string };
}) {
  const t = useTranslations('hubs');
  return (
    <nav className="border-b border-border-soft px-4 py-2 font-mono text-[0.72rem] text-text-faint">
      <Link href="/" className="text-muted-foreground hover:text-primary">
        {t('home')}
      </Link>
      <span className="mx-2">/</span>
      {parent && (
        <>
          <Link
            href={parent.path}
            className="text-muted-foreground hover:text-primary"
          >
            {parent.label}
          </Link>
          <span className="mx-2">/</span>
        </>
      )}
      {current}
    </nav>
  );
}

function Stat({
  label,
  value,
  note,
  loud = false,
}: {
  label: string;
  value: string;
  note: React.ReactNode;
  loud?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[0.68rem] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={
          loud
            ? 'font-mono text-4xl leading-tight font-bold text-primary'
            : 'font-mono text-3xl leading-tight font-bold'
        }
      >
        {value}
      </div>
      <div className="font-mono text-[0.72rem] text-muted-foreground">
        {note}
      </div>
    </div>
  );
}

/** Body of a studio or franchise page: every game fits on one page. */
export function GameHubPage({
  locale,
  path,
  title,
  hub,
  kind,
}: {
  locale: string;
  path: string;
  title: string;
  hub: GameHub;
  kind: 'studio' | 'franchise';
}) {
  const t = useTranslations('hubs');
  const tNav = useTranslations('nav');
  const parent =
    kind === 'studio'
      ? { path: '/studios', label: tNav('studios') }
      : { path: '/franchises', label: tNav('franchises') };
  const format = useFormatter();
  const compact = (units: number) =>
    format.number(units, { notation: 'compact', maximumFractionDigits: 1 });

  const withFigure = hub.games.flatMap((game) => {
    const units = listingUnits(game);
    return units ? [{ game, units }] : [];
  });
  const total = withFigure.reduce((sum, { units }) => sum + units, 0);
  const best = withFigure[0] ?? null;
  const latest = hub.games
    .filter((game) => game.releaseDate)
    .reduce<PopularGame | null>(
      (newest, game) =>
        !newest || (game.releaseDate ?? '') > (newest.releaseDate ?? '')
          ? game
          : newest,
      null,
    );
  const gameLink = 'text-primary hover:underline';

  return (
    <main className="flex min-h-screen flex-col">
      <HubJsonLd
        locale={locale}
        path={path}
        title={title}
        homeLabel={t('home')}
        parent={parent}
        games={hub.games}
      />
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl">
        <HubBreadcrumb current={hub.name} parent={parent} />

        <header className="border-b border-border px-4 py-4">
          <h1 className="text-2xl leading-tight font-bold tracking-tight">
            {title}
          </h1>
          <p className="mt-1.5 max-w-[75ch] text-sm text-muted-foreground">
            {t('gamesTracked', { count: hub.games.length })}
            {best &&
              ` ${t('bestLine', { game: best.game.name, units: compact(best.units) })}`}
          </p>
        </header>

        {best && (
          <section className="grid gap-5 border-b border-border px-4 py-5 sm:grid-cols-3">
            <Stat
              loud
              label={t('totalSales')}
              value={compact(total)}
              note={t('totalNote', { count: withFigure.length })}
            />
            <Stat
              label={t('bestSeller')}
              value={compact(best.units)}
              note={
                <Link href={`/game/${best.game.slug}`} className={gameLink}>
                  {best.game.name}
                </Link>
              }
            />
            {latest?.releaseDate && (
              <Stat
                label={t('latestRelease')}
                value={latest.releaseDate.slice(0, 4)}
                note={
                  <Link href={`/game/${latest.slug}`} className={gameLink}>
                    {latest.name}
                  </Link>
                }
              />
            )}
          </section>
        )}

        <section className="px-4 py-5">
          <h2 className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase">
            {t('allGames')}
          </h2>
          <GamesTable games={hub.games} offset={0} />
        </section>
      </div>
    </main>
  );
}

/** Index of the studios or franchises that have a page. */
export function HubIndexPage({
  locale,
  path,
  title,
  intro,
  basePath,
  items,
}: {
  locale: string;
  path: string;
  title: string;
  intro: string;
  basePath: string;
  items: HubIndexItem[];
}) {
  const t = useTranslations('hubs');
  return (
    <main className="flex min-h-screen flex-col">
      <HubJsonLd
        locale={locale}
        path={path}
        title={title}
        homeLabel={t('home')}
        games={[]}
      />
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl">
        <HubBreadcrumb current={title} />

        <div className="px-4 py-5">
          <h1 className="font-mono text-sm font-bold tracking-wider uppercase">
            {title}
          </h1>
          <p className="mt-2 mb-5 max-w-[75ch] text-[0.82rem] leading-relaxed text-muted-foreground">
            {intro}
          </p>
          <ul className="gap-x-6 sm:columns-2 lg:columns-3">
            {items.map((item) => (
              <li
                key={item.slug}
                className="flex break-inside-avoid justify-between gap-3 border-b border-border-soft py-2 text-sm"
              >
                <Link
                  href={`${basePath}/${item.slug}`}
                  className="min-w-0 font-semibold text-foreground hover:text-primary"
                >
                  {item.name}
                </Link>
                <span className="shrink-0 font-mono text-[0.75rem] text-muted-foreground tabular-nums">
                  {item.games}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

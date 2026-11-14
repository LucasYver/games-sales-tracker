import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  defaultPriceCountry,
  getGame,
  getGameRedirect,
  getRelatedGames,
  type GameDetail,
  type RelatedGames,
} from '@/lib/api';
import {
  MAX_COMPARED,
  compareCardUrl,
  compareHref,
  compareSlugs,
  pickerSuggestions,
  toCompareGame,
} from '@/lib/compare';
import { localeLanguages } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { CompareView } from '@/components/compare/CompareView';

type Params = Promise<{ locale: string; slugs: string[] }>;

/** Chips under the page: about four other comparisons in all. */
const OTHER_COMPARISONS = 4;
const SUGGESTIONS = 6;

/**
 * The games and their related lists. Same arguments as the game page, so a
 * visitor coming from a game page hits the fetch cache it already filled.
 */
async function loadGames(locale: string, slugs: string[]) {
  const country = defaultPriceCountry(locale);
  const [games, related] = await Promise.all([
    Promise.all(slugs.map((slug) => getGame(slug, country))),
    Promise.all(slugs.map((slug) => getRelatedGames(slug))),
  ]);
  return { games, related };
}

function allFound(games: (GameDetail | null)[]): games is GameDetail[] {
  return games.every((g) => g != null);
}

function isRelated(related: RelatedGames, slug: string): boolean {
  return [...related.franchise, ...related.studio].some((g) => g.slug === slug);
}

/** The related lists of every game on the page, merged: franchise first. */
function mergedRelated(related: RelatedGames[]): RelatedGames {
  return {
    franchise: related.flatMap((r) => r.franchise),
    studio: related.flatMap((r) => r.studio),
    franchiseHub: null,
    studioHub: null,
    publisherHub: null,
  };
}

/** A two-game message (`metaTitle`) or its three-game twin (`metaTitle3`). */
function forGames(
  t: (key: string, values: Record<string, string>) => string,
  key: 'metaTitle' | 'metaDescription',
  names: string[],
): string {
  const [a, b, c] = names;
  return names.length === 3 ? t(`${key}3`, { a, b, c }) : t(key, { a, b });
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, slugs } = await params;
  if (slugs.length < 2 || slugs.length > MAX_COMPARED) return {};
  const [{ games, related }, t] = await Promise.all([
    loadGames(locale, slugs),
    getTranslations({ locale, namespace: 'compare' }),
  ]);
  if (!allFound(games)) return { title: 'Game not found' };

  const names = games.map((g) => g.name);
  const title = forGames(t, 'metaTitle', names);
  const description = forGames(t, 'metaDescription', names);
  const path = compareHref(...games.map((g) => g.slug));
  const image = {
    url: compareCardUrl(locale, games.map((g) => g.slug)),
    width: 1200,
    height: 630,
    alt: title,
  };
  // Only pairs a reader would look for (same franchise or studio) are
  // indexed. Other pairs and every three-game page still work but stay out
  // of search results, so crawlers do not walk millions of combinations.
  const indexable =
    games.length === 2 &&
    (isRelated(related[0], games[1].slug) || isRelated(related[1], games[0].slug));

  return {
    title,
    description,
    robots: indexable ? undefined : { index: false, follow: true },
    alternates: {
      canonical: `/${locale}${path}`,
      languages: localeLanguages(path),
    },
    openGraph: {
      title,
      description,
      type: 'article',
      locale,
      url: `/${locale}${path}`,
      images: [{ ...image, type: 'image/png' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** Ages are counted from the time of the request (same pattern as the game page). */
function requestTime(): number {
  return Date.now();
}

export default async function ComparePage({ params }: { params: Params }) {
  const { locale, slugs } = await params;
  const unique = compareSlugs(slugs);
  if (unique.length === 1) permanentRedirect(`/${locale}/game/${unique[0]}`);
  if (unique.length > MAX_COMPARED) notFound();
  if (unique.join('/') !== slugs.join('/')) {
    permanentRedirect(`/${locale}${compareHref(...unique)}`);
  }

  const { games, related } = await loadGames(locale, unique);
  if (!allFound(games)) {
    // An edition merged into its base game keeps old comparison links alive.
    const targets = await Promise.all(
      unique.map((slug, i) => (games[i] ? slug : getGameRedirect(slug))),
    );
    if (targets.every((s): s is string => Boolean(s))) {
      const next = compareSlugs(targets);
      if (next.length >= 2 && next.join('/') !== unique.join('/')) {
        permanentRedirect(`/${locale}${compareHref(...next)}`);
      }
    }
    notFound();
  }

  const [t, tGame] = await Promise.all([
    getTranslations({ locale, namespace: 'compare' }),
    getTranslations({ locale, namespace: 'gamePage' }),
  ]);
  const now = requestTime();
  const shown = games.map((g) => toCompareGame(g, now));
  const current = games.map((g) => g.slug);

  // One list for the picker: games related to any game on the page, minus
  // the ones already compared (the picker also hides the games it keeps).
  const suggestions = pickerSuggestions(mergedRelated(related), current, SUGGESTIONS);

  const perGame = Math.max(1, Math.floor(OTHER_COMPARISONS / games.length));
  const otherPairs = games.flatMap((game, i) =>
    pickerSuggestions(related[i], current, perGame).map((g) => ({
      href: compareHref(game.slug, g.slug),
      a: game.name,
      b: g.name,
    })),
  );

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl">
        <nav className="border-b border-border-soft px-4 py-2 font-mono text-[0.72rem] text-text-faint">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            {tGame('back')}
          </Link>
          <span className="mx-2">/</span>
          {t('breadcrumb')}
        </nav>

        <CompareView games={shown} suggestions={suggestions} />

        {otherPairs.length > 0 && (
          <section aria-labelledby="other-pairs" className="px-4 py-6">
            <h2
              id="other-pairs"
              className="mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase"
            >
              {t('otherComparisons')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {otherPairs.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="inline-flex min-h-10 items-center rounded-[3px] border border-border bg-card px-3.5 text-sm hover:border-primary/60 hover:text-primary"
                  >
                    {t('heading', { a: p.a, b: p.b })}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

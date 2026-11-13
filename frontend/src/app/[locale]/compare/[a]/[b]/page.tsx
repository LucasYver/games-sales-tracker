import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  defaultPriceCountry,
  getGame,
  getGameRedirect,
  getRelatedGames,
  type RelatedGames,
} from '@/lib/api';
import {
  comparePair,
  compareHref,
  pickerSuggestions,
  toCompareGame,
} from '@/lib/compare';
import { localeLanguages } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { CompareView } from '@/components/compare/CompareView';

type Params = Promise<{ locale: string; a: string; b: string }>;

const OTHER_PAIRS_PER_GAME = 2;

/**
 * Both games and their related lists. Same arguments as the game page, so a
 * visitor coming from a game page hits the fetch cache it already filled.
 */
async function loadPair(locale: string, a: string, b: string) {
  const country = defaultPriceCountry(locale);
  const [gameA, gameB, relatedA, relatedB] = await Promise.all([
    getGame(a, country),
    getGame(b, country),
    getRelatedGames(a),
    getRelatedGames(b),
  ]);
  return { gameA, gameB, relatedA, relatedB };
}

function isRelated(related: RelatedGames, slug: string): boolean {
  return [...related.franchise, ...related.studio].some((g) => g.slug === slug);
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, a, b } = await params;
  const [{ gameA, gameB, relatedA, relatedB }, t] = await Promise.all([
    loadPair(locale, a, b),
    getTranslations({ locale, namespace: 'compare' }),
  ]);
  if (!gameA || !gameB) return { title: 'Game not found' };

  const title = t('metaTitle', { a: gameA.name, b: gameB.name });
  const description = t('metaDescription', { a: gameA.name, b: gameB.name });
  const path = compareHref(gameA.slug, gameB.slug);
  // Only pairs a reader would look for (same franchise or studio) are
  // indexed; any other pair still works but stays out of search results, so
  // crawlers do not walk millions of combinations.
  const indexable = isRelated(relatedA, gameB.slug) || isRelated(relatedB, gameA.slug);

  return {
    title,
    description,
    robots: indexable ? undefined : { index: false, follow: true },
    alternates: {
      canonical: `/${locale}${path}`,
      languages: localeLanguages(path),
    },
    openGraph: { title, description, type: 'article', locale, url: `/${locale}${path}` },
    twitter: { card: 'summary', title, description },
  };
}

/** Ages are counted from the time of the request (same pattern as the game page). */
function requestTime(): number {
  return Date.now();
}

export default async function ComparePage({ params }: { params: Params }) {
  const { locale, a, b } = await params;
  if (a === b) permanentRedirect(`/${locale}/game/${a}`);
  const [first] = comparePair(a, b);
  if (first !== a) permanentRedirect(`/${locale}${compareHref(a, b)}`);

  const { gameA, gameB, relatedA, relatedB } = await loadPair(locale, a, b);
  if (!gameA || !gameB) {
    // An edition merged into its base game keeps old comparison links alive.
    const [targetA, targetB] = await Promise.all([
      gameA ? null : getGameRedirect(a),
      gameB ? null : getGameRedirect(b),
    ]);
    if ((gameA || targetA) && (gameB || targetB)) {
      const nextA = targetA ?? a;
      const nextB = targetB ?? b;
      if (nextA !== nextB) permanentRedirect(`/${locale}${compareHref(nextA, nextB)}`);
    }
    notFound();
  }

  const [t, tGame] = await Promise.all([
    getTranslations({ locale, namespace: 'compare' }),
    getTranslations({ locale, namespace: 'gamePage' }),
  ]);
  const now = requestTime();
  const pair = [toCompareGame(gameA, now), toCompareGame(gameB, now)] as const;

  // Replacing one game keeps the other: suggest games related to the kept one.
  const suggestions = {
    [gameA.slug]: pickerSuggestions(relatedB, [gameA.slug, gameB.slug]),
    [gameB.slug]: pickerSuggestions(relatedA, [gameA.slug, gameB.slug]),
  };

  const otherPairs = [
    ...pickerSuggestions(relatedA, [gameA.slug, gameB.slug])
      .slice(0, OTHER_PAIRS_PER_GAME)
      .map((g) => ({ href: compareHref(gameA.slug, g.slug), a: gameA.name, b: g.name })),
    ...pickerSuggestions(relatedB, [gameA.slug, gameB.slug])
      .slice(0, OTHER_PAIRS_PER_GAME)
      .map((g) => ({ href: compareHref(gameB.slug, g.slug), a: gameB.name, b: g.name })),
  ];

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

        <CompareView games={pair} suggestions={suggestions} />

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

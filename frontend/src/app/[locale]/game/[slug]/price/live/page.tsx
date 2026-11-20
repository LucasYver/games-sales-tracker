import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { gameMetadata, renderGamePage } from '../../game-view';

// Price tab with a price country or store picked in the URL (`cc`, `store`).
// next.config.ts rewrites /:locale/game/:slug/price?cc=… here, so the plain
// price page stays cached; this one reads the query and renders per request.

type Params = Promise<{ slug: string; locale: string }>;
type Query = Promise<{ cc?: string; store?: string }>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}): Promise<Metadata> {
  const [{ slug, locale }, { cc, store }] = await Promise.all([
    params,
    searchParams,
  ]);
  return gameMetadata({ slug, locale, tab: 'price', cc, store });
}

export default async function GamePriceLivePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const [{ slug, locale }, { cc, store }] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  return renderGamePage({ slug, locale, tab: 'price', cc, store });
}

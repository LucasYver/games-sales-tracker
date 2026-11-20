import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { gameMetadata, renderGamePage } from '../game-view';

// The price tab, cached like the overview: the same for every visitor and
// rebuilt at most every 15 minutes (GAME_TTL in lib/api.ts). A `cc` or
// `store` query is rewritten to ./live (next.config.ts), which renders per
// request. Old `?tab=price` links are redirected here by the middleware.
export const revalidate = 900;

// No game is built at deploy time; each one is rendered on its first visit.
export function generateStaticParams() {
  return [];
}

type Params = Promise<{ slug: string; locale: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  return gameMetadata({ slug, locale, tab: 'price' });
}

export default async function GamePricePage({ params }: { params: Params }) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  return renderGamePage({ slug, locale, tab: 'price' });
}

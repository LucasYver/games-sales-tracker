import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { gameMetadata, renderGamePage } from './game-view';

// A cached page, the same for every visitor and rebuilt at most every
// 15 minutes (GAME_TTL in lib/api.ts): crawlers and visitors are served by
// the CDN instead of a function. A `cc` or `store` query is rewritten to
// ./live (next.config.ts), which renders per request.
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
  return gameMetadata({ slug, locale, tab: 'overview' });
}

export default async function GamePage({ params }: { params: Params }) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  return renderGamePage({ slug, locale, tab: 'overview' });
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { localeLanguages } from '@/i18n/routing';
import { getStudioHub } from '@/lib/api';
import { GameHubPage } from '@/components/chart-room/HubPage';

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getStudioHub(slug),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  if (!hub) return { title: 'Not found' };

  const path = `/studio/${hub.slug}`;
  const title = t('studioTitle', { name: hub.name });
  const description = t('studioDescription', {
    name: hub.name,
    count: hub.games.length,
  });
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: localeLanguages(path),
    },
    openGraph: { title, description, url: `/${locale}${path}`, locale },
  };
}

export default async function StudioPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getStudioHub(slug),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  if (!hub) notFound();

  return (
    <GameHubPage
      locale={locale}
      path={`/studio/${hub.slug}`}
      title={t('studioTitle', { name: hub.name })}
      hub={hub}
    />
  );
}

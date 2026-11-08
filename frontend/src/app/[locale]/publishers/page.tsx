import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { localeLanguages } from '@/i18n/routing';
import { getPublishers } from '@/lib/api';
import { HubIndexPage } from '@/components/chart-room/HubPage';

type Params = Promise<{ locale: string }>;

const PATH = '/publishers';

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const [items, t] = await Promise.all([
    getPublishers(),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  const title = t('publishersTitle');
  const description = t('publishersIntro', { count: items.length });
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: localeLanguages(PATH),
    },
    openGraph: { title, description, url: `/${locale}${PATH}`, locale },
  };
}

export default async function PublishersPage({ params }: { params: Params }) {
  const { locale } = await params;
  const [items, t] = await Promise.all([
    getPublishers(),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  if (items.length === 0) notFound();

  return (
    <HubIndexPage
      locale={locale}
      path={PATH}
      title={t('publishersTitle')}
      intro={t('publishersIntro', { count: items.length })}
      basePath="/publisher"
      items={items}
    />
  );
}

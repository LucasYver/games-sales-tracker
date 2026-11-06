import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { localeLanguages } from '@/i18n/routing';
import { getFranchises } from '@/lib/api';
import { HubIndexPage } from '@/components/chart-room/HubPage';

type Params = Promise<{ locale: string }>;

const PATH = '/franchises';

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const [items, t] = await Promise.all([
    getFranchises(),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  const title = t('franchisesTitle');
  const description = t('franchisesIntro', { count: items.length });
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

export default async function FranchisesPage({ params }: { params: Params }) {
  const { locale } = await params;
  const [items, t] = await Promise.all([
    getFranchises(),
    getTranslations({ locale, namespace: 'hubs' }),
  ]);
  if (items.length === 0) notFound();

  return (
    <HubIndexPage
      locale={locale}
      path={PATH}
      title={t('franchisesTitle')}
      intro={t('franchisesIntro', { count: items.length })}
      basePath="/franchise"
      items={items}
    />
  );
}

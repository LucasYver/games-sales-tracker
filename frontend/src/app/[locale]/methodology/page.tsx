import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { SiteHeader } from '@/components/chart-room/SiteHeader';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'methodology' });
  const path = `/${locale}/methodology`;
  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: path,
      languages: localeLanguages('/methodology'),
    },
    openGraph: {
      title: t('title'),
      description: t('intro'),
      type: 'article',
      locale,
      url: `${SITE_URL}${path}`,
    },
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

const SIGNALS = [
  'signalReviews',
  'signalPlayers',
  'signalRatings',
  'signalFollowers',
  'signalProfile',
  'signalTrackRecord',
] as const;

const NOT_ESTIMATED = [
  'notEstimatedOld',
  'notEstimatedFree',
  'notEstimatedPlatforms',
] as const;

export default function MethodologyPage() {
  const t = useTranslations('methodology');
  const strong = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-foreground">{chunks}</strong>
  );

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-base leading-relaxed font-medium">
          {t('intro')}
        </p>

        <Section title={t('recipeTitle')}>
          <p>{t('recipeBody1')}</p>
          <p>{t('recipeBody2')}</p>
        </Section>

        <Section title={t('signalsTitle')}>
          <p>{t('signalsBody')}</p>
          <ul className="list-disc space-y-1 pl-5">
            {SIGNALS.map((key) => (
              <li key={key}>{t.rich(key, { strong })}</li>
            ))}
          </ul>
        </Section>

        <Section title={t('similarTitle')}>
          <p>{t('similarBody1')}</p>
          <p>{t('similarBody2')}</p>
        </Section>

        <Section title={t('figuresTitle')}>
          <p>{t('figuresBody1')}</p>
          <p>{t('figuresBody2')}</p>
        </Section>

        <Section title={t('readTitle')}>
          <p>{t('readBody')}</p>
        </Section>

        <Section title={t('notEstimatedTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            {NOT_ESTIMATED.map((key) => (
              <li key={key}>{t.rich(key, { strong })}</li>
            ))}
          </ul>
          <p>{t('notEstimatedBody')}</p>
        </Section>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

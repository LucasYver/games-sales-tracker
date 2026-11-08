import type { Metadata } from 'next';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasBlog, localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { defaultOgImages } from '@/lib/og-meta';

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
      images: defaultOgImages(locale),
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
  'notEstimatedUnreleased',
  'notEstimatedPlatforms',
] as const;

const EXAMPLE_GAMES = [
  { name: 'Hades II', slug: 'hades-ii' },
  { name: 'ELDEN RING', slug: 'elden-ring' },
  { name: 'Black Myth: Wukong', slug: 'black-myth-wukong' },
  { name: 'Cyberpunk 2077', slug: 'cyberpunk-2077' },
];

export default function MethodologyPage() {
  const t = useTranslations('methodology');
  const locale = useLocale();
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

        <Section title={t('examplesTitle')}>
          <p>{t('examplesBody')}</p>
          <ul className="list-disc space-y-1 pl-5">
            {EXAMPLE_GAMES.map((game) => (
              <li key={game.slug}>
                <Link
                  href={`/game/${game.slug}`}
                  className="text-primary hover:underline"
                >
                  {game.name}
                </Link>
              </li>
            ))}
          </ul>
          {hasBlog(locale) && (
            <p>
              <Link href="/blog" className="text-primary hover:underline">
                {t('examplesBlog')}
              </Link>
            </p>
          )}
        </Section>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

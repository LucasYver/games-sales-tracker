import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { CONTACT_EMAIL } from '@/lib/contact';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { defaultOgImages } from '@/lib/og-meta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });
  const path = `/${locale}/contact`;
  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: path,
      languages: localeLanguages('/contact'),
    },
    openGraph: {
      title: t('title'),
      description: t('intro'),
      type: 'website',
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

export default function ContactPage() {
  const t = useTranslations('contact');

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-base leading-relaxed font-medium">
          {t('intro')}
        </p>
        <p className="mt-2 text-base">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-semibold text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>

        <Section title={t('correctionsTitle')}>
          <p>{t('correctionsBody')}</p>
        </Section>

        <Section title={t('studiosTitle')}>
          <p>{t('studiosBody')}</p>
        </Section>

        <Section title={t('pressTitle')}>
          <p>{t('pressBody')}</p>
        </Section>

        <p className="mt-8 text-sm text-muted-foreground">
          {t('responseTime')}
        </p>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

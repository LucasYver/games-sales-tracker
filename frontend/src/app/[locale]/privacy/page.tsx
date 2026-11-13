import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { defaultOgImages } from '@/lib/og-meta';
import { CONTACT_EMAIL } from '@/lib/contact';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacy' });
  const path = `/${locale}/privacy`;
  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: path,
      languages: localeLanguages('/privacy'),
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
    <section className="mt-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

const LINK_CLASS = 'text-primary hover:underline';

export default function PrivacyPage() {
  const t = useTranslations('privacy');

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t('intro')}
        </p>

        <Section title={t('analyticsTitle')}>
          <p>{t('analyticsBody')}</p>
        </Section>

        <Section title={t('adsTitle')}>
          <p>{t('adsBody')}</p>
          <p className="mt-2">{t('adsConsent')}</p>
          <ul className="mt-2 list-disc ps-5">
            <li>
              <a
                href="https://policies.google.com/technologies/partner-sites"
                rel="noopener"
                target="_blank"
                className={LINK_CLASS}
              >
                {t('adsGooglePolicy')}
              </a>
            </li>
            <li>
              <a
                href="https://adssettings.google.com"
                rel="noopener"
                target="_blank"
                className={LINK_CLASS}
              >
                {t('adsGoogleSettings')}
              </a>
            </li>
          </ul>
        </Section>

        <Section title={t('affiliateTitle')}>
          <p>{t('affiliateBody')}</p>
        </Section>

        <Section title={t('contactTitle')}>
          <p>
            {t('contactBody')}{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

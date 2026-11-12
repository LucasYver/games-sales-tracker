import type { Metadata } from 'next';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasBlog, localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { OWNER_NAME } from '@/lib/contact';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { defaultOgImages } from '@/lib/og-meta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });
  const path = `/${locale}/about`;
  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: path,
      languages: localeLanguages('/about'),
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

const LINK_CLASS = 'text-primary hover:underline';

export default function AboutPage() {
  const t = useTranslations('about');
  const locale = useLocale();

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-base leading-relaxed font-medium">
          {t('intro')}
        </p>

        <Section title={t('offerTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('offerGames')}</li>
            <li>{t('offerHubs')}</li>
            {hasBlog(locale) && (
              <li>
                <Link href="/blog" className={LINK_CLASS}>
                  {t('offerBlog')}
                </Link>
              </li>
            )}
          </ul>
        </Section>

        <Section title={t('sourcesTitle')}>
          <p>{t('sourcesBody')}</p>
          <p>
            <Link href="/methodology" className={LINK_CLASS}>
              {t('sourcesLink')}
            </Link>
          </p>
        </Section>

        <Section title={t('whoTitle')}>
          <p>{t('whoBody', { name: OWNER_NAME })}</p>
        </Section>

        <Section title={t('fundingTitle')}>
          <p>{t('fundingBody')}</p>
        </Section>

        <Section title={t('contactTitle')}>
          <p>
            <Link href="/contact" className={LINK_CLASS}>
              {t('contactLink')}
            </Link>
          </p>
        </Section>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import { routing } from '@/i18n/routing';
import { ADSENSE_CLIENT } from '@/lib/ads';
import { SITE_URL } from '@/lib/site-url';
import { SiteFooter } from '@/components/SiteFooter';
import { ThemeScript } from '@/components/chart-room/ThemeToggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import '../globals.css';

const sans = DM_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// DM Sans has no Cyrillic. These load on /ru only, hence no preload elsewhere.
const sansCyrillic = IBM_Plex_Sans({
  variable: '--font-sans',
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
  preload: false,
});
const monoCyrillic = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'siteMeta' });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('title'),
      template: t('titleTemplate'),
    },
    description: t('description'),
    applicationName: t('siteName'),
    keywords: t('keywords').split(','),
    authors: [{ name: t('siteName') }],
    openGraph: {
      type: 'website',
      siteName: t('siteName'),
      locale,
    },
    twitter: { card: 'summary_large_image' },
    robots: { index: true, follow: true },
    ...(ADSENSE_CLIENT && {
      other: { 'google-adsense-account': ADSENSE_CLIENT },
    }),
  };
}

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const messages = await getMessages();
  const fonts =
    locale === 'ru'
      ? `${sansCyrillic.variable} ${monoCyrillic.variable}`
      : `${sans.variable} ${mono.variable}`;

  return (
    <html
      lang={locale}
      className={`${fonts} chart-scope dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        <NextIntlClientProvider messages={messages}>
          <TooltipProvider>{children}</TooltipProvider>
          <SiteFooter />
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
        {/* A plain tag, not next/script: AdSense verifies the site by looking
            for this tag in the server HTML, and next/script only adds it in
            the browser. */}
        {ADSENSE_CLIENT && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            crossOrigin="anonymous"
          />
        )}
      </body>
    </html>
  );
}

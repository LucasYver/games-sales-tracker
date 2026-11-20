import type { Metadata } from 'next';
import {
  Chivo_Mono,
  DM_Sans,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
} from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Direction } from 'radix-ui';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import { isRtl, routing } from '@/i18n/routing';
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
// Chivo Mono: a plain zero (Plex Mono only has dotted or slashed ones), same
// 0.6 em digit width, so tables keep their layout.
const mono = Chivo_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

// DM Sans has no Cyrillic. These load on /ru only, hence no preload elsewhere.
const sansCyrillic = IBM_Plex_Sans({
  variable: '--font-sans',
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
  preload: false,
});
// Chivo Mono has no Cyrillic: on /ru, Plex Mono draws only the Cyrillic letters.
const monoCyrillic = IBM_Plex_Mono({
  variable: '--font-mono-cyrillic',
  subsets: ['cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});

// Neither DM Sans nor Chivo Mono has Arabic. Loads on /ar only.
const sansArabic = IBM_Plex_Sans_Arabic({
  variable: '--font-sans',
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});

/** Chivo Mono, then `extra`, then Chivo Mono's metric fallback. */
function monoStack(extra: string) {
  const [face, ...fallbacks] = mono.style.fontFamily.split(', ');
  return [face, extra, ...fallbacks].join(', ');
}

// Chinese: the system fonts every Chinese site relies on, no web font (a CJK
// face weighs several MB). DM Sans and Chivo Mono still draw Latin and digits.
const CJK_FONTS =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC"';

/** DM Sans, then `extra`, then DM Sans's metric fallback. */
function sansStack(extra: string) {
  const [face, ...fallbacks] = sans.style.fontFamily.split(', ');
  return [face, extra, ...fallbacks].join(', ');
}

/** Per-locale font variables that override the ones the classes set. */
function fontOverrides(locale: string): React.CSSProperties | undefined {
  if (locale === 'ru') {
    return {
      '--font-mono': monoStack(monoCyrillic.style.fontFamily),
    } as React.CSSProperties;
  }
  if (locale === 'ar') {
    return {
      '--font-mono': monoStack(sansArabic.style.fontFamily),
    } as React.CSSProperties;
  }
  if (locale === 'zh-CN') {
    return {
      '--font-sans': sansStack(CJK_FONTS),
      '--font-mono': monoStack(CJK_FONTS),
    } as React.CSSProperties;
  }
  return undefined;
}

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
    // No site-wide robots tag: pages are indexable by default, and a layout
    // `index, follow` would also land on 404s next to Next.js's `noindex`.
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
  // Without it next-intl reads the locale from the request headers, which
  // makes every page under this layout render per request (no CDN cache).
  setRequestLocale(locale);

  const messages = await getMessages();
  const fonts =
    locale === 'ru'
      ? `${sansCyrillic.variable} ${mono.variable} ${monoCyrillic.variable}`
      : locale === 'ar'
        ? `${sansArabic.variable} ${mono.variable}`
        : `${sans.variable} ${mono.variable}`;
  const dir = isRtl(locale) ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${fonts} chart-scope dark h-full antialiased`}
      suppressHydrationWarning
      // Cyrillic, Arabic or Chinese words in mono text (figures, labels) fall
      // back to Plex Mono Cyrillic, the Arabic sans or the Chinese system
      // fonts, placed before next/font's metric fallback, which covers every
      // code point it has and would otherwise win.
      style={fontOverrides(locale)}
    >
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        <NextIntlClientProvider messages={messages}>
          <Direction.Provider dir={dir}>
            <TooltipProvider>{children}</TooltipProvider>
          </Direction.Provider>
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

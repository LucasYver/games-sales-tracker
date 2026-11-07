import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgTitle,
  loadOgFonts,
} from '@/lib/og';

/** Default share card for every public page without its own (home, hubs, methodology…). */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Game Sales Tracker';

// One card per locale, rendered at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, tMeta, fonts] = await Promise.all([
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'siteMeta' }),
    loadOgFonts(),
  ]);
  const tagline = t('tagline');

  return new ImageResponse(
    <OgFrame siteName={tMeta('siteName')}>
      <OgTitle length={tagline.length}>{tagline}</OgTitle>
      <div
        style={{
          marginTop: 28,
          fontSize: 32,
          lineHeight: 1.35,
          color: OG_COLORS.muted,
        }}
      >
        {t('sub')}
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts },
  );
}

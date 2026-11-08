import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getGame, headlineUnits, isUpcoming } from '@/lib/api';
import {
  OG_CACHE_HEADERS,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgTitle,
  coverDataUrl,
  loadOgFonts,
  ogCompactUnits,
} from '@/lib/og';

/**
 * Share card of a game page: cover, name and the same headline figure as the
 * page. `getGame` shares the page's fetch cache, so a crawler asking for the
 * card right after the page costs no extra backend call.
 */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Game Sales Tracker';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [game, t, tMeta, tPlatform, fonts] = await Promise.all([
    getGame(slug).catch(() => null),
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'siteMeta' }),
    getTranslations({ locale, namespace: 'platform' }),
    loadOgFonts(),
  ]);
  const cover = await coverDataUrl(game?.coverUrl ?? null);

  const name = game?.name ?? tMeta('siteName');
  const units = game && !game.isFree ? headlineUnits(game) : null;
  const status = !game
    ? null
    : game.isFree
      ? t('free')
      : isUpcoming(game.releaseDate)
        ? t('upcoming')
        : units == null && game.estimateOutOfScope
        ? t('notEstimated')
        : null;
  const platforms = (game?.platforms ?? [])
    .map((p) => (tPlatform.has(p) ? tPlatform(p) : p))
    .join(' · ');

  return new ImageResponse(
    <OgFrame siteName={tMeta('siteName')} cover={cover}>
      <OgTitle length={name.length}>{name}</OgTitle>
      {units != null ? (
        <div
          style={{ display: 'flex', flexDirection: 'column', marginTop: 20 }}
        >
          <div
            style={{
              fontFamily: 'Plex Mono',
              fontWeight: 700,
              fontSize: 96,
              lineHeight: 1,
              color: OG_COLORS.primary,
            }}
          >
            {ogCompactUnits(units, locale)}
          </div>
          <div
            style={{ marginTop: 12, fontSize: 32, color: OG_COLORS.foreground }}
          >
            {t('copiesSold')}
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: 'Plex Mono',
              fontSize: 22,
              textTransform: 'uppercase',
              letterSpacing: 2,
              color: OG_COLORS.muted,
            }}
          >
            {t('estimate')}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 24,
            fontSize: 40,
            color: status ? OG_COLORS.primary : OG_COLORS.foreground,
          }}
        >
          {status ?? t('salesOf', { name })}
        </div>
      )}
      {platforms && (
        <div
          style={{
            marginTop: 22,
            fontFamily: 'Plex Mono',
            fontSize: 24,
            color: OG_COLORS.foreground,
          }}
        >
          {platforms}
        </div>
      )}
    </OgFrame>,
    { ...OG_SIZE, fonts, headers: OG_CACHE_HEADERS },
  );
}

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getGame, headlineUnits, isUpcoming, type GameDetail } from '@/lib/api';
import { MAX_COMPARED, compareSlugs } from '@/lib/compare';
import {
  OG_CACHE_HEADERS,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,

  coverDataUrl,
  loadOgFonts,
  ogCompactUnits,
  ogLocale,
} from '@/lib/og';

/**
 * Share card of a comparison: the covers side by side, "A vs B" and each
 * game's estimate in the colour it has on the page. `getGame` shares the game
 * cards' fetch cache, so a crawler asking for it costs no extra backend call.
 *
 * A plain route rather than an `opengraph-image.tsx`: Next refuses a metadata
 * image under the catch-all `compare/[...slugs]`. The compare page lists this
 * URL as its share image (`compareCardUrl`).
 */

/** Same order as the page: accent, light neutral, then blue. */
const GAME_COLORS = [OG_COLORS.primary, '#d4d4d4', '#5b8fd9'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slugs: string[] }> },
) {
  const { slugs, locale: pageLocale } = await params;
  const locale = ogLocale(pageLocale);
  const unique = compareSlugs(slugs).slice(0, MAX_COMPARED);
  const [found, t, tCompare, tMeta, fonts] = await Promise.all([
    Promise.all(unique.map((slug) => getGame(slug).catch(() => null))),
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'compare' }),
    getTranslations({ locale, namespace: 'siteMeta' }),
    loadOgFonts(),
  ]);
  const games = found.filter((g): g is GameDetail => g != null);
  const covers = await Promise.all(games.map((g) => coverDataUrl(g.coverUrl)));

  const [a, b, c] = games.map((g) => g.name);
  const title =
    games.length === 3
      ? tCompare('heading3', { a, b, c })
      : games.length === 2
        ? tCompare('heading', { a, b })
        : tMeta('siteName');

  // Steam headers are 460x215: keep that ratio, smaller with three games.
  const coverWidth = games.length === 3 ? 280 : 380;
  const coverHeight = Math.round((coverWidth * 215) / 460);
  // Names are long ("A vs B vs C"): size the title to fit the 1072 px text
  // column on one line when it can, two at most.
  const titleSize = Math.max(34, Math.min(64, Math.floor(1072 / (title.length * 0.6))));

  const figure = (game: GameDetail) => {
    const units = game.isFree ? null : headlineUnits(game);
    if (units != null) return { text: ogCompactUnits(units, locale), big: true };
    if (game.isFree) return { text: t('free'), big: false };
    if (isUpcoming(game.releaseDate)) return { text: t('upcoming'), big: false };
    return { text: t('notEstimated'), big: false };
  };

  return new ImageResponse(
    <OgFrame siteName={tMeta('siteName')}>
      <div
        style={{
          display: 'block',
          fontWeight: 700,
          fontSize: titleSize,
          lineHeight: 1.12,
          color: '#ffffff',
          lineClamp: 2,
          overflow: 'hidden',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', gap: 32, marginTop: 24 }}>
        {games.map((game, i) => {
          const f = figure(game);
          return (
            <div
              key={game.slug}
              style={{ display: 'flex', flexDirection: 'column', width: coverWidth }}
            >
              {covers[i] ? (
                // Satori draws a plain <img>; next/image does not apply here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={covers[i] as string}
                  alt=""
                  width={coverWidth}
                  height={coverHeight}
                  style={{
                    width: coverWidth,
                    height: coverHeight,
                    objectFit: 'cover',
                    borderRadius: 10,
                    borderTop: `6px solid ${GAME_COLORS[i]}`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: coverWidth,
                    height: coverHeight,
                    borderRadius: 10,
                    background: OG_COLORS.surface,
                    borderTop: `6px solid ${GAME_COLORS[i]}`,
                  }}
                />
              )}
              <div
                style={{
                  marginTop: 16,
                  fontFamily: 'Mono',
                  fontWeight: 700,
                  fontSize: f.big ? (games.length === 3 ? 52 : 60) : 32,
                  lineHeight: 1,
                  color: f.big ? GAME_COLORS[i] : OG_COLORS.muted,
                }}
              >
                {f.text}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: 'Mono',
          fontSize: 22,
          textTransform: 'uppercase',
          letterSpacing: 2,
          color: OG_COLORS.muted,
        }}
      >
        {t('estimate')}
      </div>
    </OgFrame>,
    {
      ...OG_SIZE,
      fonts,
      headers: { ...OG_CACHE_HEADERS, 'Content-Type': OG_CONTENT_TYPE },
    },
  );
}

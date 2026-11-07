import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { API_URL, type PublicBlogPost } from '@/lib/api';
import {
  OG_COLORS,
  OG_CACHE_HEADERS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgTitle,
  coverDataUrl,
  loadOgFonts,
} from '@/lib/og';

/** Share card of a blog article: its title and the game's cover. */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Game Sales Tracker';

/**
 * The page reads the post uncached (an admin edit shows at once). The card
 * only needs the title and cover, so it caches for an hour like the index.
 */
async function getPostForCard(
  locale: string,
  slug: string,
): Promise<PublicBlogPost | null> {
  try {
    const res = await fetch(
      `${API_URL}/blog/${encodeURIComponent(locale)}/${encodeURIComponent(slug)}`,
      { next: { revalidate: 3600, tags: ['blog'] } },
    );
    return res.ok ? ((await res.json()) as PublicBlogPost) : null;
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [post, t, tMeta, fonts] = await Promise.all([
    getPostForCard(locale, slug),
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'siteMeta' }),
    loadOgFonts(),
  ]);
  const cover = await coverDataUrl(
    post?.coverUrl ?? post?.game?.coverUrl ?? null,
  );
  const title = post?.title ?? t('tagline');

  return new ImageResponse(
    <OgFrame siteName={`${tMeta('siteName')} · ${t('blog')}`} cover={cover}>
      <OgTitle length={title.length} lines={3}>
        {title}
      </OgTitle>
      {post?.game && (
        <div
          style={{
            marginTop: 26,
            fontFamily: 'Plex Mono',
            fontSize: 28,
            color: OG_COLORS.primary,
          }}
        >
          {post.game.name}
        </div>
      )}
    </OgFrame>,
    { ...OG_SIZE, fonts, headers: OG_CACHE_HEADERS },
  );
}

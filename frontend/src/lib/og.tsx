import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';

/**
 * Shared pieces of the social share images (`opengraph-image.tsx` files).
 * One 1200x630 card in the public dark palette, so a link posted on X,
 * Reddit, Discord or Slack shows the game and its figure, not a bare URL.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

/**
 * Game and blog cards render on demand. Let the CDN keep each one a day (and
 * serve it stale for a week while it re-renders), so a link shared many times
 * renders once instead of once per crawler.
 */
export const OG_CACHE_HEADERS = {
  'Cache-Control':
    'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
};

// `.chart-scope.dark` in globals.css.
export const OG_COLORS = {
  background: '#0e1420',
  surface: '#111722',
  foreground: '#cfd8e3',
  primary: '#d9a441',
  muted: '#7c8a9a',
  border: '#26303f',
};

const FONT_DIR = join(process.cwd(), 'assets/og-fonts');

/**
 * IBM Plex Sans and Mono, Latin and Cyrillic (the /ru pages). Satori picks,
 * glyph by glyph, the first listed font of a family that has it.
 */
export async function loadOgFonts() {
  const files = [
    ['Plex Sans', 400, 'ibm-plex-sans-latin-400-normal.woff'],
    ['Plex Sans', 700, 'ibm-plex-sans-latin-700-normal.woff'],
    ['Plex Sans', 400, 'ibm-plex-sans-cyrillic-400-normal.woff'],
    ['Plex Sans', 700, 'ibm-plex-sans-cyrillic-700-normal.woff'],
    ['Plex Mono', 400, 'ibm-plex-mono-latin-400-normal.woff'],
    ['Plex Mono', 700, 'ibm-plex-mono-latin-700-normal.woff'],
    ['Plex Mono', 400, 'ibm-plex-mono-cyrillic-400-normal.woff'],
    ['Plex Mono', 700, 'ibm-plex-mono-cyrillic-700-normal.woff'],
  ] as const;
  return Promise.all(
    files.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: 'normal' as const,
      data: await readFile(join(FONT_DIR, file)),
    })),
  );
}

/**
 * The cover as a data URL, or null. Fetched here rather than left to Satori
 * so a slow or missing cover drops out of the card instead of failing it.
 */
export async function coverDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Same rounding and notation as the game page headline ("4.2M", "4,2 M"). */
export function ogCompactUnits(units: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(units);
}

function Logo() {
  // public/logo.svg, drawn with boxes (Satori renders flex boxes, not SVG files).
  const cell = (color: string) => (
    <div
      style={{ width: 10, height: 9, borderRadius: 1.5, background: color }}
    />
  );
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 5,
        width: 48,
        height: 48,
        padding: '9px 9px 11px',
        borderRadius: 11,
        background: '#4D51DE',
      }}
    >
      <div style={{ display: 'flex' }}>{cell('#FFFFFF')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {cell('#FFFFFF')}
        {cell('#FFFFFF')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {cell('#FBBF24')}
        {cell('#FFFFFF')}
        {cell('#FFFFFF')}
      </div>
    </div>
  );
}

/**
 * The card: brand row on top, the page's own content in the middle, the
 * domain at the bottom, and the cover on the left when there is one.
 */
export function OgFrame({
  siteName,
  cover,
  children,
}: {
  siteName: string;
  cover?: string | null;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: OG_COLORS.background,
        color: OG_COLORS.foreground,
        fontFamily: 'Plex Sans',
        padding: 64,
        gap: 56,
        borderBottom: `10px solid ${OG_COLORS.primary}`,
      }}
    >
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt=""
          width={330}
          height={440}
          style={{
            width: 330,
            height: 440,
            alignSelf: 'center',
            objectFit: 'cover',
            borderRadius: 12,
            border: `2px solid ${OG_COLORS.border}`,
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 24,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Logo />
          <div
            style={{
              fontFamily: 'Plex Mono',
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: OG_COLORS.muted,
            }}
          >
            {siteName}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
        <div
          style={{
            fontFamily: 'Plex Mono',
            fontSize: 24,
            color: OG_COLORS.muted,
          }}
        >
          gamesalestracker.tech
        </div>
      </div>
    </div>
  );
}

/** A title clamped to `lines` lines, sized down for long names. */
export function OgTitle({
  children,
  length,
  lines = 2,
}: {
  children: ReactNode;
  length: number;
  lines?: number;
}) {
  const fontSize = length > 60 ? 48 : length > 32 ? 58 : 70;
  return (
    <div
      style={{
        display: 'block',
        fontWeight: 700,
        fontSize,
        lineHeight: 1.12,
        color: '#ffffff',
        lineClamp: lines,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

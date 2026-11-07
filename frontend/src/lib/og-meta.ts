/**
 * The default share card (`app/[locale]/opengraph-image.tsx`) as metadata.
 * A page that sets its own `openGraph.type` loses the inherited card, so it
 * lists this one explicitly.
 */
export function defaultOgImages(locale: string) {
  return [
    {
      url: `/${locale}/opengraph-image`,
      width: 1200,
      height: 630,
      type: 'image/png',
    },
  ];
}

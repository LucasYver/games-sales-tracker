import { getPublishers, getStudios, type SearchCompany } from '@/lib/api';

// Every studio and publisher with a hub page, for the live search. Served
// from the ISR cache and rebuilt once a day like the hub indexes, so opening
// the search costs no backend call. Not under /api: Vercel routes that prefix
// to the backend.
export const revalidate = 86400;

export async function GET() {
  const [studios, publishers] = await Promise.all([
    getStudios(),
    getPublishers(),
  ]);
  const companies: SearchCompany[] = [
    ...studios.map(({ slug, name, games }) => ({
      kind: 'studio' as const,
      slug,
      name,
      games,
    })),
    ...publishers.map(({ slug, name, games }) => ({
      kind: 'publisher' as const,
      slug,
      name,
      games,
    })),
  ];
  return Response.json(companies);
}

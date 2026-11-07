/**
 * Which series a game belongs to, from IGDB's own grouping. Pure: the nightly
 * refresh reads IGDB and stores the result in `game.seriesSlug` / `seriesName`.
 *
 * IGDB has two groupings. A collection is a series ("Transport Fever",
 * "NBA 2K", "Total War: Warhammer"). A franchise is wider ("Total War", "NBA",
 * "Star Wars"). The collection is the right level for most games: the
 * franchise would merge NBA 2K with NBA Live, or Forza Horizon with Forza
 * Motorsport. The franchise wins only when the collection is visibly one of
 * its sub-series, named "Franchise: …", so Total War is not split into Rome,
 * Warhammer and Saga.
 */

export interface IgdbSeriesFields {
  collections: string[];
  /** IGDB's main franchise, when it has one. */
  franchise: string | null;
  franchises: string[];
}

/** Compare names whatever their case, accents, symbols or spacing. */
function compact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function shortest(names: string[]): string {
  return names.reduce((best, name) =>
    name.length < best.length ? name : best,
  );
}

/**
 * The series name for a game, or null when IGDB has none or cannot settle on
 * one (several franchises, none of them in the title).
 */
export function pickSeriesName(
  title: string,
  igdb: IgdbSeriesFields,
): string | null {
  const titleKey = compact(title);
  const inTitle = (name: string) => {
    const key = compact(name);
    return key.length > 0 && titleKey.includes(key);
  };
  const franchises = [
    ...(igdb.franchise ? [igdb.franchise] : []),
    ...igdb.franchises.filter((name) => name !== igdb.franchise),
  ];

  if (igdb.collections.length > 0) {
    const named = igdb.collections.filter(inTitle);
    const collection = named.length > 0 ? shortest(named) : igdb.collections[0];
    const parents = franchises.filter((franchise) =>
      collection.toLowerCase().startsWith(`${franchise.toLowerCase()}:`),
    );
    return parents.length > 0 ? shortest(parents) : collection;
  }

  if (igdb.franchise) return igdb.franchise;
  const named = franchises.filter(inTitle);
  if (named.length > 0) return shortest(named);
  return franchises.length === 1 ? franchises[0] : null;
}

/**
 * URL slug of a series. Apostrophes are dropped rather than turned into a
 * hyphen, so "Assassin's Creed" keeps the `assassins-creed` slug the title
 * rule already used.
 */
export function seriesSlug(name: string): string {
  return name
    .replace(/['’`]/g, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

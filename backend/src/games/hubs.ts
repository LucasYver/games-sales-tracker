/**
 * Public hub pages (`/studio/:slug`, `/publisher/:slug`, `/franchise/:slug`).
 * A hub needs enough games to be worth indexing: below these counts it does
 * not exist, in the API, in the sitemap and in the links from game pages.
 */
export const STUDIO_HUB_MIN_GAMES = 4;
export const PUBLISHER_HUB_MIN_GAMES = 4;
export const FRANCHISE_HUB_MIN_GAMES = 3;

/**
 * A company hub: studios group games by their `developer` row, publishers by
 * their `publisher` row. Same slugs, same redirects from an older spelling.
 */
export interface CompanyHub {
  label: string;
  table: 'developer' | 'publisher';
  idColumn: 'developerId' | 'publisherId';
  /** The name every reader uses, then the Steam store one: both feed redirects. */
  nameColumn: 'developer' | 'publisher';
  steamColumn: 'steamDeveloper' | 'steamPublisher';
  minGames: number;
}

export const COMPANY_HUBS = {
  studio: {
    label: 'Studio',
    table: 'developer',
    idColumn: 'developerId',
    nameColumn: 'developer',
    steamColumn: 'steamDeveloper',
    minGames: STUDIO_HUB_MIN_GAMES,
  },
  publisher: {
    label: 'Publisher',
    table: 'publisher',
    idColumn: 'publisherId',
    nameColumn: 'publisher',
    steamColumn: 'steamPublisher',
    minGames: PUBLISHER_HUB_MIN_GAMES,
  },
} as const satisfies Record<string, CompanyHub>;

/**
 * Studio or publisher slug in SQL. Neither has a slug column, so the slug is
 * derived from the company name. ASCII only and lowered last, so this and
 * `studioSlug` agree whatever the database locale does with accented capitals.
 */
export function studioSlugSql(column: string): string {
  return `trim(both '-' from lower(regexp_replace(${column}, '[^a-zA-Z0-9]+', '-', 'g')))`;
}

/** Same result as `studioSlugSql`. Empty for a name without any ASCII letter. */
export function studioSlug(developer: string): string {
  return developer
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

/** Display names: `franchiseSlug` alone cannot restore capitals or apostrophes. */
const FRANCHISE_NAMES: Record<string, string> = {
  'assassins-creed': "Assassin's Creed",
  battlefield: 'Battlefield',
  borderlands: 'Borderlands',
  'call-of-duty': 'Call of Duty',
  'car-mechanic-simulator': 'Car Mechanic Simulator',
  civilization: 'Civilization',
  'dark-souls': 'Dark Souls',
  f1: 'F1',
  fallout: 'Fallout',
  'far-cry': 'Far Cry',
  fifa: 'FIFA',
  'final-fantasy': 'Final Fantasy',
  'football-manager': 'Football Manager',
  'forza-horizon': 'Forza Horizon',
  'grand-theft-auto': 'Grand Theft Auto',
  halo: 'Halo',
  'madden-nfl': 'Madden NFL',
  'nba-2k': 'NBA 2K',
  'nekopara-vol': 'Nekopara',
  'pes-efootball': 'PES / eFootball',
  'resident-evil': 'Resident Evil',
  'sniper-elite': 'Sniper Elite',
  'the-elder-scrolls': 'The Elder Scrolls',
  'the-jackbox-party-pack': 'The Jackbox Party Pack',
  'the-legend-of-heroes-trails-of-cold-steel':
    'The Legend of Heroes: Trails of Cold Steel',
  'the-sims': 'The Sims',
  'the-witcher': 'The Witcher',
  'total-war': 'Total War',
  trine: 'Trine',
  uncharted: 'Uncharted',
  'wwe-2k': 'WWE 2K',
};

/**
 * Franchise slug of a game in SQL: its IGDB series, else the slug derived from
 * its title (games the nightly series refresh has not reached yet, and games
 * IGDB puts in no series). `alias` is the table alias, if any.
 */
export function franchiseSlugSql(alias?: string): string {
  const column = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
  return `COALESCE(${column('seriesSlug')}, ${column('franchiseSlug')})`;
}

/**
 * Display name of a franchise: the curated name, else IGDB's series name,
 * else the slug with capitals so a new franchise is still readable.
 */
export function franchiseName(
  slug: string,
  seriesName?: string | null,
): string {
  return (
    FRANCHISE_NAMES[slug] ??
    seriesName ??
    slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

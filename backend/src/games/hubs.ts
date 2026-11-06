/**
 * Public hub pages (`/studio/:slug`, `/franchise/:slug`). A hub needs enough
 * games to be worth indexing: below these counts it does not exist, in the API,
 * in the sitemap and in the links from game pages.
 */
export const STUDIO_HUB_MIN_GAMES = 4;
export const FRANCHISE_HUB_MIN_GAMES = 3;

/**
 * Studio slug in SQL. It has no table of its own, so the slug is derived from
 * the developer name. ASCII only and lowered last, so this and `studioSlug` agree
 * whatever the database locale does with accented capitals.
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

/** A franchise that newly reaches the threshold still gets a readable name. */
export function franchiseName(slug: string): string {
  return (
    FRANCHISE_NAMES[slug] ??
    slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

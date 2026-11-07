/**
 * The developer and publisher shown on the public pages, from IGDB. Pure: the
 * nightly IGDB refresh stores the result in `game.igdbDeveloper` /
 * `igdbPublisher`. The Steam columns `developer` / `publisher` are left alone:
 * the matcher, the ML and the curated publisher link read them.
 *
 * IGDB names each company once, without legal suffixes or spelling variants,
 * and tells the porting and supporting studios apart from the real developer.
 * It also splits some companies into internal divisions, or uses a legal name
 * nobody knows: `COMPANY_ALIASES` folds those back.
 */

export interface IgdbInvolvedCompany {
  name: string;
  developer: boolean;
  publisher: boolean;
  porting: boolean;
  supporting: boolean;
}

/** First match wins. Keep each pattern anchored to whole names. */
const COMPANY_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [
    /^capcom (development division|production studio|planning room|u\.?s\.?a)/i,
    'Capcom',
  ],
  [/^ea digital illusions ce$/i, 'DICE'],
  [/^(the )?creative assembly$/i, 'Creative Assembly'],
  [/^bandai namco studios?( inc\.?)?$/i, 'Bandai Namco Studios'],
  [
    /^(bandai namco entertainment( america| europe)?|bandai namco games|namco bandai games( america)?)$/i,
    'Bandai Namco Entertainment',
  ],
  [/^sega( games| corporation| of america| europe)?$/i, 'Sega'],
  [/^koei tecmo( games| europe| america corporation)?$/i, 'Koei Tecmo'],
  [/^ubisoft( entertainment| europe)?$/i, 'Ubisoft'],
];

export function canonicalCompany(name: string): string {
  const trimmed = name.trim();
  for (const [pattern, canonical] of COMPANY_ALIASES) {
    if (pattern.test(trimmed)) return canonical;
  }
  return trimmed;
}

/** Compare names whatever their case, accents, symbols or legal suffix. */
function compact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(co|ltd|inc|llc|gmbh|corp|corporation|a\/s|s\.?a)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * One company for a role, or null when IGDB lists none (porting and
 * supporting studios never count). With several, the one Steam names wins,
 * else IGDB's first, so the choice is stable from one night to the next.
 */
function pick(
  companies: IgdbInvolvedCompany[],
  role: 'developer' | 'publisher',
  steamName: string | null,
): string | null {
  const names = companies
    .filter((c) => c[role] && !c.porting && !c.supporting && c.name.trim())
    .map((c) => canonicalCompany(c.name));
  if (names.length === 0) return null;
  const steamKey = steamName ? compact(canonicalCompany(steamName)) : '';
  return names.find((name) => compact(name) === steamKey) ?? names[0];
}

export function pickCompanies(
  companies: IgdbInvolvedCompany[],
  steam: { developer: string | null; publisher: string | null },
): { developer: string | null; publisher: string | null } {
  return {
    developer: pick(companies, 'developer', steam.developer),
    publisher: pick(companies, 'publisher', steam.publisher),
  };
}

type CompanyColumns = {
  developer: string | null;
  publisher: string | null;
  igdbDeveloper: string | null;
  igdbPublisher: string | null;
  manualFields: string[] | null;
};

/**
 * Developer shown on the public pages: an admin correction first, then IGDB,
 * then Steam. Same rule as `publicDeveloperSql`.
 */
export function publicDeveloper(game: CompanyColumns): string | null {
  const steam = game.developer?.trim() || null;
  if (game.manualFields?.includes('developer')) return steam;
  return game.igdbDeveloper ?? steam;
}

/**
 * Publisher shown on the public pages, same order as the developer. With no
 * publisher anywhere, the game is taken as self-published.
 */
export function publicPublisher(game: CompanyColumns): string | null {
  const steam = game.publisher?.trim() || null;
  const publisher = game.manualFields?.includes('publisher')
    ? steam
    : (game.igdbPublisher ?? steam);
  return publisher ?? publicDeveloper(game);
}

/** `publicDeveloper` in SQL. `alias` is the table alias, if any. */
export function publicDeveloperSql(alias?: string): string {
  const column = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
  const steam = `NULLIF(trim(${column('developer')}), '')`;
  return `(CASE WHEN 'developer' = ANY(${column('manualFields')}) THEN ${steam} ELSE COALESCE(${column('igdbDeveloper')}, ${steam}) END)`;
}

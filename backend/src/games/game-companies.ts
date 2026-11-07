/**
 * A game's one developer and one publisher, in `game.developer` /
 * `game.publisher`, read everywhere: public pages, studio hubs, matcher, ML,
 * blog. Order: an admin correction, else IGDB's credit, else the store's name
 * (`steamDeveloper` / `steamPublisher`).
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
 * Key under which two spellings of one company meet: aliases folded, then case,
 * accents, symbols and legal suffixes ignored ("CAPCOM Co., Ltd." = "Capcom").
 */
export function companyKey(name: string): string {
  return compact(canonicalCompany(name));
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
  steamDeveloper: string | null;
  steamPublisher: string | null;
  manualFields: string[] | null;
};

/**
 * The developer and publisher to store. `igdb` is IGDB's list of credited
 * companies, or null when IGDB was not asked or did not answer: the current
 * value then stays, and only an empty one takes the store's name. A column an
 * admin corrected is never replaced.
 */
export function resolveCompanies(
  game: CompanyColumns,
  igdb: IgdbInvolvedCompany[] | null,
): { developer: string | null; publisher: string | null } {
  const steam = {
    developer: game.steamDeveloper?.trim() || null,
    publisher: game.steamPublisher?.trim() || null,
  };
  const picked = igdb ? pickCompanies(igdb, steam) : null;
  const resolve = (role: 'developer' | 'publisher'): string | null => {
    const current = game[role]?.trim() || null;
    if (game.manualFields?.includes(role)) return current;
    if (picked) return picked[role] ?? steam[role] ?? current;
    return current ?? steam[role];
  };
  return { developer: resolve('developer'), publisher: resolve('publisher') };
}

/**
 * Publisher shown on the public pages. With no publisher anywhere, the game is
 * taken as self-published.
 */
export function shownPublisher(game: {
  developer: string | null;
  publisher: string | null;
}): string | null {
  return game.publisher?.trim() || game.developer?.trim() || null;
}

/** `game.developer` in SQL, empty as NULL. `alias` is the table alias, if any. */
export function developerSql(alias?: string): string {
  return `NULLIF(trim(${alias ? `${alias}."developer"` : '"developer"'}), '')`;
}

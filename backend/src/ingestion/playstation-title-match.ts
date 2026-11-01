/**
 * Decides whether a PlayStation Store concept is the catalog game. A plain
 * prefix check is not enough: "Wardogs" is a prefix of "WarDogs: Red's Return",
 * and "Attack on Titan" of "Attack on Titan 3", yet those are different games
 * whose ratings must never feed an estimate.
 *
 * Pure and dependency-free. See the skill `playstation-store-matching`.
 */

export type PsTitleRelation = 'exact' | 'edition' | 'subtitle' | 'none';

const ROMAN_TO_DIGIT: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

const PLATFORM_WORDS = new Set([
  'ps4',
  'ps5',
  'playstation',
  'playstation4',
  'playstation5',
]);

// Words that name a packaging of the same game, never a different game. A
// remaster counts: the store often sells only that listing, with the original's
// ratings ("The Witcher 3: Wild Hunt — Remastered"). An exact concept still wins
// when the search finds one. "vr" stays out: it is a separate product.
const EDITION_WORDS = new Set([
  'anniversary',
  'bundle',
  'celebration',
  'collection',
  'collectors',
  'complete',
  'console',
  'cross',
  'cut',
  'definitive',
  'deluxe',
  'digital',
  'directors',
  'dx',
  'edition',
  'editions',
  'enhanced',
  'extended',
  'f2p',
  'free',
  'full',
  'game',
  'gen',
  'gold',
  'goty',
  'launch',
  'limited',
  'new',
  'of',
  'pass',
  'play',
  'premium',
  'remaster',
  'remastered',
  'season',
  'special',
  'standard',
  'the',
  'title',
  'to',
  'ultimate',
  'upgrade',
  'version',
  'year',
]);

const EDITION_SUFFIXES = new Set([
  'edition',
  'version',
  'bundle',
  'collection',
]);

// A subtitle only proves the same game when both releases are this close: a
// real short title and its full name launch together, a spin-off does not.
const SUBTITLE_MAX_RELEASE_GAP_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

export function psTitleTokens(title: string): string[] {
  const tokens = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‚‛'`]/g, '')
    .replace(/[™®©]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !PLATFORM_WORDS.has(token))
    .map((token) => ROMAN_TO_DIGIT[token] ?? token);
  // "The Quarry for PS5": the platform word is gone, its "for" is left over.
  if (tokens[tokens.length - 1] === 'for') tokens.pop();
  return tokens;
}

/** Tokens of `longer` left after `shorter`, or null if it is not a prefix. */
function remainderAfterPrefix(
  shorter: string[],
  longer: string[],
): string[] | null {
  // Compare joined text so "WarDogs" and "War Dogs" still line up.
  const target = shorter.join('');
  let joined = '';
  for (let i = 0; i < longer.length; i++) {
    joined += longer[i];
    if (joined === target) return longer.slice(i + 1);
    if (joined.length >= target.length) return null;
  }
  return null;
}

function isEditionRemainder(
  remainder: string[],
  storeHasRemainder: boolean,
): boolean {
  const freeWords = remainder.filter((token) => !EDITION_WORDS.has(token));
  if (freeWords.length === 0) return true;
  if (!EDITION_SUFFIXES.has(remainder[remainder.length - 1])) return false;
  // The store may name its edition freely ("Zombies Chronicles Edition"), but a
  // catalog title may only add one word: "Need for Speed Rivals: Complete
  // Edition" is not the store's "Need for Speed".
  return storeHasRemainder ? freeWords.length <= 2 : remainder.length === 2;
}

export function psTitleRelation(
  catalogTitle: string,
  storeTitle: string,
): PsTitleRelation {
  const catalog = psTitleTokens(catalogTitle);
  const store = psTitleTokens(storeTitle);
  if (catalog.length === 0 || store.length === 0) return 'none';

  const catalogIsShorter = catalog.join('').length <= store.join('').length;
  const shorter = catalogIsShorter ? catalog : store;
  const longer = catalogIsShorter ? store : catalog;
  // Same bar as the previous matcher: too short a title proves nothing.
  if (shorter.join('').length < 4) {
    return catalog.join('') === store.join('') ? 'exact' : 'none';
  }

  const remainder = remainderAfterPrefix(shorter, longer);
  if (!remainder) return 'none';
  if (remainder.length === 0) return 'exact';
  // "Tormented Souls" vs "Tormented Souls 2": a number opens a sequel, unless
  // it dates an edition ("SnowRunner - 5-Year Anniversary Edition").
  if (/^\d/.test(remainder[0]) && remainder[1] !== 'year') return 'none';
  return isEditionRemainder(remainder, catalogIsShorter)
    ? 'edition'
    : 'subtitle';
}

export function psConceptMatchesGame(
  catalogTitle: string,
  storeTitle: string,
  storeReleaseDate: Date | null,
  catalogReleaseDates: Array<Date | null | undefined>,
): boolean {
  const relation = psTitleRelation(catalogTitle, storeTitle);
  if (relation === 'exact' || relation === 'edition') return true;
  if (relation !== 'subtitle' || !storeReleaseDate) return false;
  return catalogReleaseDates.some(
    (date) =>
      date &&
      Math.abs(date.getTime() - storeReleaseDate.getTime()) <=
        SUBTITLE_MAX_RELEASE_GAP_DAYS * DAY_MS,
  );
}

/** Search queries for a catalog title, the plainest forms first. */
export function psTitleBaseNames(name: string): string[] {
  const withoutMarks = name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const bases = [withoutMarks];
  const add = (value: string) => {
    const base = value.replace(/\s+/g, ' ').trim();
    if (base.length >= 2 && !bases.includes(base)) bases.push(base);
  };
  // "The Quarry - Full Game", "Mass Effect: Andromeda Deluxe Edition".
  const beforeDash = withoutMarks.split(/\s[-–—]\s/)[0];
  add(beforeDash);
  for (const value of [withoutMarks, beforeDash]) {
    add(
      value.replace(
        /[\s:,-]+((?:[\p{L}\d'’]+\s+){0,3}(?:edition|version|bundle)|full game)\s*$/iu,
        '',
      ),
    );
  }
  return bases;
}

/** "Alan Wake II" searches as "Alan Wake 2" too; the store uses either. */
export function psRomanNumeralsToDigits(name: string): string {
  return name.replace(/\b(viii|vii|iii|ii|iv|vi|ix)\b/gi, (match) => {
    return ROMAN_TO_DIGIT[match.toLowerCase()] ?? match;
  });
}

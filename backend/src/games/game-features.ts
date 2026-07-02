/**
 * Pure, dependency-free derivation of the matcher's per-game features
 * from the metadata we already ingest (name, Steam categories, DLC).
 * Shared by the ingestion pipeline, the backfill scripts, and the
 * diagnostic so a single definition drives every consumer.
 *
 * Nothing here touches the DB or the network — inputs in, plain values
 * out — so it's trivially unit-testable and safe to call in a tight
 * loop over the whole catalog.
 */

export interface FranchiseFeatures {
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
}

/**
 * Curated franchises whose entries are released on a (roughly) yearly
 * cadence. A name match sets `isAnnualIteration = true` and pins the
 * franchise slug. Patterns are matched case-insensitively against the
 * raw title; order doesn't matter (first match wins). Extend freely —
 * precision matters more than recall here (a wrong annual flag is worse
 * than a missing one).
 */
const ANNUAL_FRANCHISES: ReadonlyArray<{ slug: string; pattern: RegExp }> = [
  { slug: 'fifa', pattern: /\b(fifa|ea sports fc)\b/i },
  { slug: 'madden-nfl', pattern: /\bmadden\b/i },
  { slug: 'nba-2k', pattern: /\bnba 2k\d*/i },
  { slug: 'wwe-2k', pattern: /\bwwe 2k\d*/i },
  { slug: 'nhl', pattern: /\bnhl \d/i },
  { slug: 'mlb-the-show', pattern: /\bmlb the show\b/i },
  { slug: 'pga-tour', pattern: /\bpga tour\b/i },
  { slug: 'call-of-duty', pattern: /\bcall of duty\b/i },
  { slug: 'assassins-creed', pattern: /\bassassin'?s creed\b/i },
  { slug: 'far-cry', pattern: /\bfar cry\b/i },
  { slug: 'f1', pattern: /\bf1 (?:20)?\d{2}\b/i },
  { slug: 'football-manager', pattern: /\bfootball manager\b/i },
  {
    slug: 'pes-efootball',
    pattern: /\b(pro evolution soccer|pes \d|efootball)\b/i,
  },
  { slug: 'just-dance', pattern: /\bjust dance\b/i },
  { slug: 'nba-live', pattern: /\bnba live\b/i },
];

/**
 * Non-annual franchises worth clustering (sequels years apart). Only
 * sets the franchise slug — no annual flag. Kept short and explicit;
 * the generic title-normalisation fallback below catches the rest.
 */
const KNOWN_FRANCHISES: ReadonlyArray<{ slug: string; pattern: RegExp }> = [
  { slug: 'battlefield', pattern: /\bbattlefield\b/i },
  { slug: 'grand-theft-auto', pattern: /\b(grand theft auto|gta)\b/i },
  { slug: 'the-elder-scrolls', pattern: /\belder scrolls\b/i },
  { slug: 'fallout', pattern: /\bfallout\b/i },
  { slug: 'the-witcher', pattern: /\bwitcher\b/i },
  { slug: 'dark-souls', pattern: /\bdark souls\b/i },
  { slug: 'resident-evil', pattern: /\bresident evil\b/i },
  { slug: 'final-fantasy', pattern: /\bfinal fantasy\b/i },
  { slug: 'total-war', pattern: /\btotal war\b/i },
  { slug: 'civilization', pattern: /\bcivilization\b/i },
  { slug: 'the-sims', pattern: /\bthe sims\b/i },
];

/**
 * Roman numeral → integer for the trailing-iteration parser. Only the
 * small values that realistically appear in game titles.
 */
const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

/**
 * Derive franchise identity from a title. Resolution order:
 *   1. annual dictionary  → franchise + annual flag (+ parsed number)
 *   2. known-franchise dictionary → franchise slug only
 *   3. generic trailing-iteration parse ("Portal 2", "FIFA 18",
 *      "The Witcher 3: Wild Hunt") → base slug + iteration number
 *   4. otherwise → all null / false (a genuine one-off)
 */
export function deriveFranchise(name: string): FranchiseFeatures {
  const trimmed = name.trim();

  for (const { slug, pattern } of ANNUAL_FRANCHISES) {
    if (pattern.test(trimmed)) {
      return {
        franchiseSlug: slug,
        isAnnualIteration: true,
        iterationNumber: parseTrailingIteration(trimmed)?.number ?? null,
      };
    }
  }

  for (const { slug, pattern } of KNOWN_FRANCHISES) {
    if (pattern.test(trimmed)) {
      return {
        franchiseSlug: slug,
        isAnnualIteration: false,
        iterationNumber: parseTrailingIteration(trimmed)?.number ?? null,
      };
    }
  }

  const parsed = parseTrailingIteration(trimmed);
  if (parsed) {
    return {
      franchiseSlug: slugify(parsed.base),
      isAnnualIteration: false,
      iterationNumber: parsed.number,
    };
  }

  return {
    franchiseSlug: null,
    isAnnualIteration: false,
    iterationNumber: null,
  };
}

/**
 * Extract a trailing iteration marker ("… 2", "… V", "… 2018",
 * "… 3: Subtitle") from a title. Returns the base title (marker
 * stripped) and the numeric value, or null when the title has no
 * trailing iteration. A bare year (>= 1980) is normalised to its
 * two-digit form so "FIFA 18" and "FIFA 2018" collapse to the same
 * franchise base regardless of styling.
 */
function parseTrailingIteration(
  name: string,
): { base: string; number: number } | null {
  // "Base N: Subtitle" or "Base N" — capture the base and the marker,
  // ignoring any colon-separated subtitle.
  const match = /^(.*?)[\s:-]+([0-9]{1,4}|[ivxIVX]+)(?::.*| - .*)?$/.exec(
    name.trim(),
  );
  if (!match) return null;
  const base = match[1].trim();
  const marker = match[2].toLowerCase();
  if (base.length === 0) return null;

  let value: number;
  if (/^[0-9]+$/.test(marker)) {
    value = Number(marker);
  } else if (ROMAN[marker] !== undefined) {
    value = ROMAN[marker];
  } else {
    return null;
  }

  // Reject noise: a lone "1" is rarely an iteration ("Portal 1" is
  // unusual), and huge numbers that aren't plausible years are likely
  // part of the actual title ("Payday 2" ok, "Katana 3000" not).
  if (value === 1) return null;
  if (value > 12 && (value < 1980 || value > 2100)) return null;

  return { base, number: value };
}

const LIVE_SERVICE_CATEGORIES = new Set(['mmo', 'massively multiplayer']);

/**
 * Curated paid live-service titles that Steam categories alone don't
 * flag (many carry only "Online PvP" / "Co-op"). F2P titles are
 * intentionally omitted — they're excluded from estimation upstream.
 */
const LIVE_SERVICE_NAMES: ReadonlyArray<RegExp> = [
  /\bdestiny 2\b/i,
  /\bgrand theft auto v\b/i,
  /\brainbow six\b.*\bsiege\b/i,
  /\belder scrolls online\b/i,
  /\bfinal fantasy xiv\b/i,
  /\bmonster hunter\b.*\bworld\b/i,
  /\bno man'?s sky\b/i,
  /\bsea of thieves\b/i,
  /\bgrand theft auto online\b/i,
];

/**
 * Decide whether a game is a live-service title. Conservative: an
 * explicit MMO/massively-multiplayer category, or a curated-name match.
 * `dlc` is accepted for future refinement (heavy ongoing DLC cadence)
 * but not yet used to avoid false positives from expansion-pack games.
 */
export function deriveLiveService(
  name: string,
  categories: string[] | null,
): boolean {
  const cats = new Set((categories ?? []).map((c) => c.toLowerCase()));
  for (const flag of LIVE_SERVICE_CATEGORIES) {
    if (cats.has(flag)) return true;
  }
  return LIVE_SERVICE_NAMES.some((re) => re.test(name));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

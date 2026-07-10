/**
 * Curated registry of "big" publishers used for **publisher identity in
 * the matcher**: linking a game to a curated `Publisher` row canonicalises
 * its publisher across raw-string variants (e.g. "Capcom" vs "CAPCOM Co.,
 * Ltd.", "Sony Computer Entertainment" vs "PlayStation Publishing LLC"),
 * so the matcher's publisher axis connects same-publisher titles that the
 * raw string would otherwise split.
 *
 * On every game ingestion the raw IGDB/Steam publisher string is matched
 * against `patterns` here; on a match, the game is linked to the
 * corresponding `Publisher` row (created idempotently at boot).
 *
 * Patterns are intentionally tight: every regex must clearly identify the
 * publisher with no false-positives.
 */
export interface PublisherHeuristic {
  name: string;
  patterns: RegExp[];
}

export const PUBLISHER_HEURISTICS: PublisherHeuristic[] = [
  {
    name: 'Ubisoft',
    patterns: [/\bubisoft\b/i],
  },
  {
    name: 'Electronic Arts',
    patterns: [
      /^electronic arts/i,
      /\bea\s+(games|sports|originals|dice|inc)\b/i,
    ],
  },
  {
    name: 'Activision',
    patterns: [/^activision(\s+blizzard|\s+publishing)?$/i, /^activision\b/i],
  },
  {
    name: 'Blizzard Entertainment',
    patterns: [/^blizzard\b/i, /activision blizzard/i],
  },
  {
    name: 'Xbox Game Studios',
    patterns: [
      /xbox game studios/i,
      /microsoft game studios/i,
      /^microsoft studios$/i,
    ],
  },
  {
    name: 'Bethesda Softworks',
    patterns: [/bethesda softworks/i, /bethesda game studios/i, /^bethesda$/i],
  },
  {
    name: 'Rockstar Games',
    patterns: [/rockstar games/i],
  },
  {
    name: 'Epic Games',
    patterns: [/^epic games(\s+publishing)?$/i],
  },
  {
    name: 'CD Projekt',
    patterns: [/cd projekt/i],
  },
  {
    name: 'Sony Interactive Entertainment',
    patterns: [
      /sony (computer|interactive) entertainment/i,
      /playstation (publishing|mobile|studios)/i,
    ],
  },
  {
    name: 'Paradox Interactive',
    patterns: [/paradox interactive/i],
  },
  {
    name: 'SEGA',
    patterns: [/^sega\b/i],
  },
  {
    name: 'Capcom',
    patterns: [/^capcom\b/i],
  },
  {
    name: 'BANDAI NAMCO Entertainment',
    patterns: [/bandai namco/i],
  },
  {
    name: 'Square Enix',
    patterns: [/square enix/i],
  },
  {
    name: '2K',
    patterns: [/^2k\b/i, /^2k games\b/i],
  },
  {
    name: 'Warner Bros. Interactive Entertainment',
    patterns: [/warner bros/i],
  },
  {
    name: 'THQ Nordic',
    patterns: [/thq nordic/i],
  },
  {
    name: 'Deep Silver',
    patterns: [/deep silver/i],
  },
  {
    name: 'Devolver Digital',
    patterns: [/devolver/i],
  },
  {
    name: 'Annapurna Interactive',
    patterns: [/annapurna/i],
  },
  {
    name: '505 Games',
    patterns: [/^505 games\b/i],
  },
  {
    name: 'Focus Entertainment',
    patterns: [/focus (home|entertainment|interactive)/i],
  },
  {
    name: 'Team17',
    patterns: [/team\s?17/i],
  },
];

/**
 * Find the canonical publisher heuristic matching a raw IGDB / Steam
 * publisher string. Returns null when no curated entry matches — these
 * games keep their raw `publisher` string but no `publisherId` FK.
 */
export function findPublisherHeuristic(
  rawName: string | null | undefined,
): PublisherHeuristic | null {
  if (!rawName) return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  for (const h of PUBLISHER_HEURISTICS) {
    if (h.patterns.some((p) => p.test(trimmed))) return h;
  }
  return null;
}

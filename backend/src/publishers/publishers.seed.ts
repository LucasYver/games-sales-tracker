/**
 * Curated heuristic registry of "big" publishers whose PC distribution
 * profile deviates from the Steam-default. On every game ingestion the
 * raw IGDB publisher string is matched against `patterns` here; on a
 * match, the game is linked to the corresponding `Publisher` row (created
 * idempotently at boot with the default Steam-share range below).
 *
 * Admin-edited shares persist in DB — the default range is only used for
 * the *initial* insert and never overwrites an existing row's share
 * during subsequent boot seeding.
 *
 * The share is Steam's estimated cut of the publisher's *PC* sales,
 * expressed as a percentage range. Anchors mirror the former preset
 * profiles:
 *   - launcher-primary (Ubisoft Connect / EA App / Battle.net / MS Store):
 *     Steam ≈ 14–29% of PC → ×3.5–7 correction.
 *   - multi-store (significant EGS / GOG presence): Steam ≈ 50–71% of PC
 *     → ×1.4–2 correction.
 * Patterns are intentionally tight: every regex must clearly identify the
 * publisher with no false-positives on indies/subsidiaries we want to
 * leave at the Steam-dominant default (100/100). Add a new heuristic only
 * when you're sure the publisher's PC sales mostly bypass Steam.
 */
export interface PublisherHeuristic {
  name: string;
  defaultSteamSharePctLow: number;
  defaultSteamSharePctHigh: number;
  patterns: RegExp[];
}

// Steam-share anchors equivalent to the former launcher profiles.
const LAUNCHER_PRIMARY_SHARE = { low: 14, high: 29 } as const;
const MULTI_STORE_SHARE = { low: 50, high: 71 } as const;

export const PUBLISHER_HEURISTICS: PublisherHeuristic[] = [
  {
    name: 'Ubisoft',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [/\bubisoft\b/i],
  },
  {
    name: 'Electronic Arts',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [
      /^electronic arts/i,
      /\bea\s+(games|sports|originals|dice|inc)\b/i,
    ],
  },
  {
    name: 'Activision',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [/^activision(\s+blizzard|\s+publishing)?$/i, /^activision\b/i],
  },
  {
    name: 'Blizzard Entertainment',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [/^blizzard\b/i, /activision blizzard/i],
  },
  {
    name: 'Xbox Game Studios',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [
      /xbox game studios/i,
      /microsoft game studios/i,
      /^microsoft studios$/i,
    ],
  },
  {
    name: 'Bethesda Softworks',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [
      /bethesda softworks/i,
      /bethesda game studios/i,
      /^bethesda$/i,
    ],
  },
  {
    name: 'Rockstar Games',
    defaultSteamSharePctLow: LAUNCHER_PRIMARY_SHARE.low,
    defaultSteamSharePctHigh: LAUNCHER_PRIMARY_SHARE.high,
    patterns: [/rockstar games/i],
  },
  // Multi-store (Steam + significant alternative PC storefront).
  {
    name: 'Epic Games',
    defaultSteamSharePctLow: MULTI_STORE_SHARE.low,
    defaultSteamSharePctHigh: MULTI_STORE_SHARE.high,
    patterns: [/^epic games(\s+publishing)?$/i],
  },
  {
    name: 'CD Projekt',
    defaultSteamSharePctLow: MULTI_STORE_SHARE.low,
    defaultSteamSharePctHigh: MULTI_STORE_SHARE.high,
    patterns: [/cd projekt/i],
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

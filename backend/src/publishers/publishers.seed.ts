/**
 * Curated registry of "big" publishers. It serves two purposes:
 *
 *   1. **Steam-share correction** — for publishers whose PC sales deviate
 *      from the Steam-dominant default, the share below drives the launcher
 *      correction applied by the estimator.
 *   2. **Publisher identity for the matcher** — linking a game to a curated
 *      `Publisher` row canonicalises its publisher across raw-string
 *      variants (e.g. "Capcom" vs "CAPCOM Co., Ltd.", "Sony Computer
 *      Entertainment" vs "PlayStation Publishing LLC"), so the matcher's
 *      publisher axis connects same-publisher titles that the raw string
 *      would otherwise split.
 *
 * On every game ingestion the raw IGDB/Steam publisher string is matched
 * against `patterns` here; on a match, the game is linked to the
 * corresponding `Publisher` row (created idempotently at boot with the
 * default Steam-share range below). Admin-edited shares persist in DB — the
 * default range is only used for the *initial* insert and never overwrites
 * an existing row's share during subsequent boot seeding.
 *
 * The share is Steam's estimated cut of the publisher's *PC* sales,
 * expressed as a percentage range:
 *   - launcher-primary (Ubisoft Connect / EA App / Battle.net / MS Store):
 *     Steam ≈ 14–29% of PC → ×3.5–7 correction.
 *   - multi-store (significant EGS / GOG presence): Steam ≈ 50–71% of PC
 *     → ×1.4–2 correction.
 *   - steam-dominant (100/100): no correction — same as the global default.
 *     Used for identity/canonicalisation only; safe to add liberally since
 *     it never shifts an estimate.
 * Patterns are intentionally tight: every regex must clearly identify the
 * publisher with no false-positives. Only assign a non-100 share when you
 * are sure the publisher's PC sales bypass Steam — otherwise use
 * `STEAM_DOMINANT_SHARE`.
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
// Steam is the dominant PC store — identical to the global default, so
// these entries exist purely for publisher identity/canonicalisation.
const STEAM_DOMINANT_SHARE = { low: 100, high: 100 } as const;

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
  // Steam-dominant — identity/canonicalisation only (no share correction).
  {
    name: 'Sony Interactive Entertainment',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [
      /sony (computer|interactive) entertainment/i,
      /playstation (publishing|mobile|studios)/i,
    ],
  },
  {
    name: 'Paradox Interactive',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/paradox interactive/i],
  },
  {
    name: 'SEGA',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/^sega\b/i],
  },
  {
    name: 'Capcom',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/^capcom\b/i],
  },
  {
    name: 'BANDAI NAMCO Entertainment',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/bandai namco/i],
  },
  {
    name: 'Square Enix',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/square enix/i],
  },
  {
    name: '2K',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/^2k\b/i, /^2k games\b/i],
  },
  {
    name: 'Warner Bros. Interactive Entertainment',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/warner bros/i],
  },
  {
    name: 'THQ Nordic',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/thq nordic/i],
  },
  {
    name: 'Deep Silver',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/deep silver/i],
  },
  {
    name: 'Devolver Digital',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/devolver/i],
  },
  {
    name: 'Annapurna Interactive',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/annapurna/i],
  },
  {
    name: '505 Games',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/^505 games\b/i],
  },
  {
    name: 'Focus Entertainment',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
    patterns: [/focus (home|entertainment|interactive)/i],
  },
  {
    name: 'Team17',
    defaultSteamSharePctLow: STEAM_DOMINANT_SHARE.low,
    defaultSteamSharePctHigh: STEAM_DOMINANT_SHARE.high,
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

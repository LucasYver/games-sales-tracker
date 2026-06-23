import { LauncherProfile } from '../entities';

/**
 * Curated heuristic registry of "big" publishers whose PC distribution
 * profile deviates from the Steam-default. On every game ingestion the
 * raw IGDB publisher string is matched against `patterns` here; on a
 * match, the game is linked to the corresponding `Publisher` row (created
 * idempotently at boot with `defaultLauncherProfile`).
 *
 * Admin-edited profiles persist in DB — `defaultLauncherProfile` is only
 * used for the *initial* insert and never overwrites an existing row's
 * profile during subsequent boot seeding.
 *
 * Patterns are intentionally tight: every regex must clearly identify
 * the publisher with no false-positives on indies/subsidiaries we want
 * to leave as STEAM_DOMINANT by default. Add a new heuristic only when
 * you're sure the publisher's PC sales mostly bypass Steam.
 */
export interface PublisherHeuristic {
  name: string;
  defaultLauncherProfile: LauncherProfile;
  patterns: RegExp[];
}

export const PUBLISHER_HEURISTICS: PublisherHeuristic[] = [
  {
    name: 'Ubisoft',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [/\bubisoft\b/i],
  },
  {
    name: 'Electronic Arts',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [
      /^electronic arts/i,
      /\bea\s+(games|sports|originals|dice|inc)\b/i,
    ],
  },
  {
    name: 'Activision',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [/^activision(\s+blizzard|\s+publishing)?$/i, /^activision\b/i],
  },
  {
    name: 'Blizzard Entertainment',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [/^blizzard\b/i, /activision blizzard/i],
  },
  {
    name: 'Xbox Game Studios',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [
      /xbox game studios/i,
      /microsoft game studios/i,
      /^microsoft studios$/i,
    ],
  },
  {
    name: 'Bethesda Softworks',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [
      /bethesda softworks/i,
      /bethesda game studios/i,
      /^bethesda$/i,
    ],
  },
  {
    name: 'Rockstar Games',
    defaultLauncherProfile: LauncherProfile.LAUNCHER_PRIMARY,
    patterns: [/rockstar games/i],
  },
  // Multi-store (Steam + significant alternative PC storefront).
  {
    name: 'Epic Games',
    defaultLauncherProfile: LauncherProfile.MULTI_STORE,
    patterns: [/^epic games(\s+publishing)?$/i],
  },
  {
    name: 'CD Projekt',
    defaultLauncherProfile: LauncherProfile.MULTI_STORE,
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

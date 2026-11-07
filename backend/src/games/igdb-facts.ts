/**
 * Descriptive facts the nightly IGDB refresh reads for a game: what kind of
 * release it is (`game_type`, `parent_game`), how it is played
 * (`game_modes`) and how long it takes (`game_time_to_beats`). Shown on the
 * public and admin game pages. Nothing here feeds the estimate yet.
 */

/** IGDB `game_types` (ids checked live on 2026-11-07). */
const IGDB_GAME_TYPES = {
  0: 'MAIN_GAME',
  1: 'DLC',
  2: 'EXPANSION',
  3: 'BUNDLE',
  4: 'STANDALONE_EXPANSION',
  5: 'MOD',
  6: 'EPISODE',
  7: 'SEASON',
  8: 'REMAKE',
  9: 'REMASTER',
  10: 'EXPANDED_GAME',
  11: 'PORT',
  12: 'FORK',
  13: 'PACK',
  14: 'UPDATE',
} as const;

export type GameType = (typeof IGDB_GAME_TYPES)[keyof typeof IGDB_GAME_TYPES];

/** IGDB `game_modes`, keyed by their slug (stable, unlike the names). */
const IGDB_GAME_MODES = {
  'single-player': 'SINGLE_PLAYER',
  multiplayer: 'MULTIPLAYER',
  'co-operative': 'CO_OP',
  'split-screen': 'SPLIT_SCREEN',
  'massively-multiplayer-online-mmo': 'MMO',
  'battle-royale': 'BATTLE_ROYALE',
} as const;

export type GameMode = (typeof IGDB_GAME_MODES)[keyof typeof IGDB_GAME_MODES];

const GAME_MODE_ORDER = Object.values(IGDB_GAME_MODES) as GameMode[];

/**
 * Player-reported completion times, in seconds, from IGDB
 * `game_time_to_beats`. `count` is the number of reports behind them: a
 * handful can be wildly off (Palworld: 2 reports, "hastily" longer than
 * "normally"), so public pages go through `shownTimeToBeat`.
 */
export interface TimeToBeat {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
  count: number;
}

export const TIME_TO_BEAT_MIN_REPORTS = 3;

export function gameTypeFromIgdb(id: unknown): GameType | null {
  return typeof id === 'number' && id in IGDB_GAME_TYPES
    ? IGDB_GAME_TYPES[id as keyof typeof IGDB_GAME_TYPES]
    : null;
}

/** Known modes in a fixed order; unknown slugs are dropped. */
export function gameModesFromIgdb(
  slugs: Array<string | undefined>,
): GameMode[] {
  const modes = new Set<GameMode>();
  for (const slug of slugs) {
    if (slug && slug in IGDB_GAME_MODES) {
      modes.add(IGDB_GAME_MODES[slug as keyof typeof IGDB_GAME_MODES]);
    }
  }
  return GAME_MODE_ORDER.filter((mode) => modes.has(mode));
}

/**
 * The time to beat a public page may show, or null when it cannot be trusted:
 * below the report floor, or for a live-service game, which has no end (The
 * Finals: 1,500 h "complete"). A rushed or complete time on the wrong side of
 * the normal one is dropped rather than the whole figure (The Last of Us
 * Part I: 19.5 h rushed, 18.8 h normal, on 23 reports).
 */
export function shownTimeToBeat(
  value: TimeToBeat | null | undefined,
  liveService: boolean,
): TimeToBeat | null {
  if (!value || liveService || value.count < TIME_TO_BEAT_MIN_REPORTS) {
    return null;
  }
  const { normally } = value;
  let { hastily, completely } = value;
  if (normally) {
    if (hastily && hastily > normally) hastily = null;
    if (completely && completely < normally) completely = null;
  } else if (hastily && completely && hastily > completely) {
    return null;
  }
  if (!hastily && !normally && !completely) return null;
  return { hastily, normally, completely, count: value.count };
}

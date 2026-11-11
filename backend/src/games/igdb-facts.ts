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
 * `game_time_to_beats`. `count` is the number of reports behind them.
 * Shown in the admin only.
 */
export interface TimeToBeat {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
  count: number;
}

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

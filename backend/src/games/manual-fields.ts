import type { Game } from '../entities/game.entity';

/**
 * Game metadata columns an admin may correct by hand. Once edited, a column is
 * listed in `game.manualFields` and the ingestion upserts keep its value.
 */
export const MANUAL_GAME_FIELDS = [
  'name',
  'summary',
  'releaseDate',
  'coverUrl',
  'developer',
  'publisher',
  'platforms',
  'genres',
  'categories',
  'steamTags',
  'isFree',
  'liveService',
] as const;

export type ManualGameField = (typeof MANUAL_GAME_FIELDS)[number];

/**
 * Run an ingestion write on `game`, then put back every column the admin
 * locked. The cron still refreshes the other columns.
 */
export function keepManualFields(game: Game, apply: () => void): void {
  const locked = game.manualFields ?? [];
  if (locked.length === 0) {
    apply();
    return;
  }
  const kept: Partial<Pick<Game, ManualGameField>> = {};
  for (const field of locked as ManualGameField[]) {
    if (field in game) Object.assign(kept, { [field]: game[field] });
  }
  apply();
  Object.assign(game, kept);
}

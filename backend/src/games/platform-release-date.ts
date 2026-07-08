import { Game, Platform } from '../entities';

/**
 * Resolves the launch date for one platform of a game, e.g. a PlayStation
 * release a year ahead of its PC port. Falls back to the game-wide
 * `releaseDate` (earliest date across all platforms) when no per-platform
 * row exists — older catalog entries backfilled before this feature, or an
 * IGDB record with no `release_dates` breakdown.
 *
 * Requires `game.platformReleaseDates` to be loaded (relation must be
 * included in the caller's `find`/`findOne`); an unloaded relation is
 * `undefined` and treated the same as "no per-platform data".
 */
export function platformReleaseDate(
  game: Game,
  platform: Platform,
): Date | null {
  const match = game.platformReleaseDates?.find((r) => r.platform === platform);
  return match?.releaseDate ?? game.releaseDate;
}

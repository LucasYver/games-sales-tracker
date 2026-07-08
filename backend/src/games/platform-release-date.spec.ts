import { Platform } from '../entities';
import { platformReleaseDate } from './platform-release-date';
import type { Game } from '../entities';

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    releaseDate: null,
    platformReleaseDates: [],
    ...overrides,
  } as Game;
}

describe('platformReleaseDate', () => {
  it('returns the per-platform date when one exists', () => {
    const psDate = new Date('2022-09-02T00:00:00Z');
    const pcDate = new Date('2023-03-03T00:00:00Z');
    const game = makeGame({
      releaseDate: psDate,
      platformReleaseDates: [
        {
          gameId: 'g1',
          platform: Platform.PLAYSTATION,
          releaseDate: psDate,
        } as never,
        { gameId: 'g1', platform: Platform.PC, releaseDate: pcDate } as never,
      ],
    });

    expect(platformReleaseDate(game, Platform.PC)).toBe(pcDate);
    expect(platformReleaseDate(game, Platform.PLAYSTATION)).toBe(psDate);
  });

  it('falls back to the game-wide releaseDate when no per-platform row matches', () => {
    const globalDate = new Date('2020-01-01T00:00:00Z');
    const game = makeGame({
      releaseDate: globalDate,
      platformReleaseDates: [],
    });

    expect(platformReleaseDate(game, Platform.PC)).toBe(globalDate);
  });

  it('falls back to the game-wide releaseDate when the relation is not loaded', () => {
    const globalDate = new Date('2020-01-01T00:00:00Z');
    const game = makeGame({ releaseDate: globalDate });
    delete (game as { platformReleaseDates?: unknown }).platformReleaseDates;

    expect(platformReleaseDate(game, Platform.PC)).toBe(globalDate);
  });

  it('returns null when neither a per-platform nor a global date exists', () => {
    const game = makeGame();
    expect(platformReleaseDate(game, Platform.XBOX)).toBeNull();
  });
});

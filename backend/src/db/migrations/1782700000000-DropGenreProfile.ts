import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the legacy `GenreProfile` system. The estimation model now
 * derives every behavioural parameter from the data-driven matcher
 * (`reference_profile` + `MatcherService`), so the hand-tuned genre
 * profiles and the game/genre → profile links are dead weight.
 *
 * Drops, in dependency order:
 *  1. `game.genreProfileId` / `game.genreProfileManual` (the persisted
 *     per-game profile pin);
 *  2. `genre.profileId` (the genre → profile mapping);
 *  3. the `genre_profile` table itself.
 *
 * The `genre` taxonomy (classification/display metadata) is kept.
 *
 * This is intentionally irreversible: `down` throws rather than
 * silently recreating an empty, unseeded `genre_profile` table that
 * would no longer be wired to anything. Roll forward, not back.
 */
export class DropGenreProfile1782700000000 implements MigrationInterface {
  name = 'DropGenreProfile1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "genreProfileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "genreProfileManual"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre" DROP COLUMN IF EXISTS "profileId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "genre_profile"`);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'DropGenreProfile1782700000000 is irreversible: the legacy genre_profile ' +
          'system was removed. Restore from a backup if a rollback is required.',
      ),
    );
  }
}

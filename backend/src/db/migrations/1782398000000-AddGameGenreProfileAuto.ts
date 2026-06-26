import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the genre profile on the game instead of resolving it on the
 * fly at estimation time. Adds `game.genreProfileManual` to distinguish
 * an admin-pinned profile from an auto-resolved one, then:
 *
 *  1. Flags every game that already had a `genreProfileId` as manual —
 *     before this change the only way to set it was the admin override,
 *     so those values must be preserved.
 *  2. Backfills `genreProfileId` for the remaining (auto) games with the
 *     profile of the FIRST genre (in `genres` array order) that maps to
 *     a profile. Mirrors `GenresService.resolveFirstProfileId`.
 */
export class AddGameGenreProfileAuto1782398000000
  implements MigrationInterface
{
  name = 'AddGameGenreProfileAuto1782398000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "genreProfileManual" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `UPDATE "game" SET "genreProfileManual" = true WHERE "genreProfileId" IS NOT NULL`,
    );

    // First matching genre per game (lowest ordinal in the comma-separated
    // simple-array) whose `genre` row carries a profile. DISTINCT ON +
    // ORDER BY ordinal keeps the first hit only.
    await queryRunner.query(
      `UPDATE "game" g
         SET "genreProfileId" = sub."profileId"
       FROM (
         SELECT DISTINCT ON (gg.id) gg.id AS game_id, ge."profileId" AS "profileId"
         FROM "game" gg
         CROSS JOIN LATERAL unnest(string_to_array(gg.genres, ',')) WITH ORDINALITY AS t(name, ord)
         JOIN "genre" ge
           ON LOWER(TRIM(ge.name)) = LOWER(TRIM(t.name))
          AND ge."profileId" IS NOT NULL
         WHERE gg.genres IS NOT NULL AND gg.genres <> ''
         ORDER BY gg.id, t.ord
       ) sub
       WHERE g.id = sub.game_id AND g."genreProfileManual" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the prior state where auto games had no persisted profile.
    await queryRunner.query(
      `UPDATE "game" SET "genreProfileId" = NULL WHERE "genreProfileManual" = false`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "genreProfileManual"`,
    );
  }
}

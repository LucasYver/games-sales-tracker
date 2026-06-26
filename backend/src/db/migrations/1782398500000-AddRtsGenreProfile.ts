import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits RTS out of the combined `grand-strategy-rts` profile into its
 * own `rts` profile.
 *
 * For now the new profile is a verbatim clone of the platform-split,
 * lifecycle and peak-CCU values of the original — the only goal is to
 * separate the taxonomy so RTS can be recalibrated independently later.
 * Because the ratios are identical, no estimate changes as a result of
 * this migration.
 *
 * Steps:
 *   1. Clone the current `grand-strategy-rts` row into a new `rts`
 *      profile (named "RTS"). INSERT … SELECT preserves any admin edits
 *      made to the source row since the original seed.
 *   2. Rename the source profile to drop the RTS scope:
 *      slug `grand-strategy-rts` → `grand-strategy-4x`,
 *      name "Grand strategy / 4X / RTS" → "Grand strategy / 4X".
 *      (Mirrors the earlier western-rpg-arpg split, which also renamed
 *      the slug; no code references the slug — only UUID FKs do.)
 *   3. Repoint the IGDB "Real Time Strategy (RTS)" genre (externalId 11)
 *      at the new `rts` profile. "Strategy" (15) and "Turn-based
 *      strategy" (16) stay on grand-strategy / 4X.
 *   4. Re-run the auto genre-profile backfill (same logic as
 *      `AddGameGenreProfileAuto`) for non-manual games so RTS titles now
 *      resolve to the `rts` profile.
 */
export class AddRtsGenreProfile1782398500000 implements MigrationInterface {
  name = 'AddRtsGenreProfile1782398500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "genre_profile"
         ("slug", "name", "description", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence", "lifecycleIndex", "firstWeekToYearOneMultiplier", "year2Retention", "lifecycleDriver", "peakCcuToWeekOneLow", "peakCcuToWeekOneHigh")
       SELECT 'rts', 'RTS', "description", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence", "lifecycleIndex", "firstWeekToYearOneMultiplier", "year2Retention", "lifecycleDriver", "peakCcuToWeekOneLow", "peakCcuToWeekOneHigh"
       FROM "genre_profile"
       WHERE slug = 'grand-strategy-rts'
       ON CONFLICT (slug) DO NOTHING`,
    );

    await queryRunner.query(
      `UPDATE "genre_profile"
         SET slug = 'grand-strategy-4x',
             name = 'Grand strategy / 4X'
       WHERE slug = 'grand-strategy-rts'`,
    );

    await queryRunner.query(
      `UPDATE "genre"
         SET "profileId" = (SELECT id FROM "genre_profile" WHERE slug = 'rts')
       WHERE source = 'IGDB' AND "externalId" = 11`,
    );

    await this.backfillAutoGameProfiles(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "genre"
         SET "profileId" = (SELECT id FROM "genre_profile" WHERE slug = 'grand-strategy-4x')
       WHERE source = 'IGDB' AND "externalId" = 11`,
    );

    await queryRunner.query(
      `UPDATE "game"
         SET "genreProfileId" = (SELECT id FROM "genre_profile" WHERE slug = 'grand-strategy-4x')
       WHERE "genreProfileId" = (SELECT id FROM "genre_profile" WHERE slug = 'rts')`,
    );

    await queryRunner.query(`DELETE FROM "genre_profile" WHERE slug = 'rts'`);

    await queryRunner.query(
      `UPDATE "genre_profile"
         SET slug = 'grand-strategy-rts',
             name = 'Grand strategy / 4X / RTS'
       WHERE slug = 'grand-strategy-4x'`,
    );
  }

  /**
   * Recompute `game.genreProfileId` for auto (non-manual) games from the
   * first profile-mapped genre in `genres` array order. Identical to the
   * backfill in `AddGameGenreProfileAuto` and to
   * `GenresService.resolveFirstProfileId`.
   */
  private async backfillAutoGameProfiles(
    queryRunner: QueryRunner,
  ): Promise<void> {
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
}

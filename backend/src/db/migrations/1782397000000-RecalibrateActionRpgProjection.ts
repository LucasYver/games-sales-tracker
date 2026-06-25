import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recalibrates the `action-rpg` genre profile's lifetime projection
 * against declared figures (anchor: Palworld, PC ≈ 15M declared vs a
 * ~10.5M launch-window baseline → real launch→lifetime ratio ~1.5).
 *
 * The previous values (m1 = 2.50, year2Retention = MEDIUM) over-projected
 * front-loaded viral hits: combined with the peak-derived launch baseline
 * they reached ~3.6× at ~2.4 years (PC ≈ 26–49M for Palworld, vs 15M
 * declared). Lowering m1 to 1.50 and flattening the tail to VERY_LOW
 * brings the projection to ~1.6× at that age (PC ≈ 12–22M).
 *
 * Data-only change (admin-editable); shipped as a migration so it is
 * reproducible on a fresh database.
 */
export class RecalibrateActionRpgProjection1782397000000
  implements MigrationInterface
{
  name = 'RecalibrateActionRpgProjection1782397000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET "firstWeekToYearOneMultiplier" = 1.50,
             "year2Retention" = 'VERY_LOW'::"public"."genre_profile_year2retention_enum"
       WHERE slug = 'action-rpg'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET "firstWeekToYearOneMultiplier" = 2.50,
             "year2Retention" = 'MEDIUM'::"public"."genre_profile_year2retention_enum"
       WHERE slug = 'action-rpg'`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `PLATFORM_SPLIT` family to `EstimationMethodFamily` and
 * seeds two methods that ventilate a PC estimate to console using a
 * resolved `GenreProfile`:
 *
 *   genre-console-split-from-pc-playstation
 *   genre-console-split-from-pc-xbox
 *
 * Both consume the same canonical PC aggregate produced earlier in the
 * estimation pipeline and emit a single per-platform row scaled by the
 * profile's `(psShare or xboxShare) / pcShare`. They are weighted
 * slightly below the calibrated Boxleiter methods (0.4) — they add a
 * second opinion when console ratings exist and become the *only*
 * console signal when no console rating snapshot has been captured.
 *
 * Postgres requires the enum-alteration dance (rename old → create
 * new → ALTER COLUMN TYPE … USING → drop old) because we can't add a
 * value to a referenced enum atomically.
 */
export class AddPlatformSplitFamilyAndGenreSplitMethods1782223100959
  implements MigrationInterface
{
  name = 'AddPlatformSplitFamilyAndGenreSplitMethods1782223100959';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."estimation_method_family_enum" RENAME TO "estimation_method_family_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_method_family_enum" AS ENUM('BOXLEITER', 'ACHIEVEMENTS', 'LIFECYCLE', 'PLATFORM_SPLIT', 'AGGREGATE', 'MANUAL')`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_method" ALTER COLUMN "family" TYPE "public"."estimation_method_family_enum" USING "family"::"text"::"public"."estimation_method_family_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."estimation_method_family_enum_old"`,
    );

    const methods: ReadonlyArray<{ code: string; label: string }> = [
      {
        code: 'genre-console-split-from-pc-playstation',
        label:
          'Genre-aware PlayStation share of the PC aggregate (psShare / pcShare)',
      },
      {
        code: 'genre-console-split-from-pc-xbox',
        label:
          'Genre-aware Xbox share of the PC aggregate (xboxShare / pcShare)',
      },
    ];

    for (const m of methods) {
      await queryRunner.query(
        `INSERT INTO "estimation_method" ("code", "label", "family", "defaultWeight", "isEnabled", "isAggregate")
         VALUES ($1, $2, 'PLATFORM_SPLIT', 0.4, true, false)`,
        [m.code, m.label],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "estimation_method"
        WHERE code IN ('genre-console-split-from-pc-playstation', 'genre-console-split-from-pc-xbox')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_method_family_enum_old" AS ENUM('BOXLEITER', 'ACHIEVEMENTS', 'LIFECYCLE', 'AGGREGATE', 'MANUAL')`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_method" ALTER COLUMN "family" TYPE "public"."estimation_method_family_enum_old" USING "family"::"text"::"public"."estimation_method_family_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."estimation_method_family_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."estimation_method_family_enum_old" RENAME TO "estimation_method_family_enum"`,
    );
  }
}

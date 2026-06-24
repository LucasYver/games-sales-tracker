import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rename `sales_record` → `milestone` (full rename: table, FK column on
 * `estimation_discrepancy`, indexes). Replace the `confidence` enum with
 * a numeric `confidenceScore` int (0–100) derived from the trusted
 * source's weight — the score is informational only and no longer drives
 * calibration. Legacy enum values are mapped LOW→30 / MEDIUM→55 / HIGH→90.
 *
 * Also tidy up the estimation method registry to reflect the simplified
 * calibration model: a single `*-calibrated` method per platform replaces
 * the per-source variants. Old `*-calibrated-{official,announcement,
 * media,wikipedia}` rows are disabled rather than dropped so historical
 * `sales_estimate` rows that reference them keep their FK intact.
 */
export class RenameSalesRecordToMilestone1782260000000
  implements MigrationInterface
{
  name = 'RenameSalesRecordToMilestone1782260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_record" ADD "confidenceScore" integer`,
    );
    await queryRunner.query(`UPDATE "sales_record" SET "confidenceScore" =
      CASE "confidence"
        WHEN 'LOW' THEN 30
        WHEN 'MEDIUM' THEN 55
        WHEN 'HIGH' THEN 90
        ELSE NULL
      END`);
    await queryRunner.query(
      `ALTER TABLE "sales_record" DROP COLUMN "confidence"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."sales_record_confidence_enum"`,
    );

    await queryRunner.query(`ALTER TABLE "sales_record" RENAME TO "milestone"`);

    await queryRunner.query(
      `ALTER TABLE "estimation_discrepancy" RENAME COLUMN "recordId" TO "milestoneId"`,
    );

    await queryRunner.query(`UPDATE "estimation_method" SET "isEnabled" = false
      WHERE code LIKE '%-calibrated-official'
         OR code LIKE '%-calibrated-announcement'
         OR code LIKE '%-calibrated-media'
         OR code LIKE '%-calibrated-wikipedia'`);

    await queryRunner.query(`INSERT INTO "estimation_method"
        ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
      VALUES
        ('boxleiter-calibrated', 'Boxleiter PC — calibrated', 'Steam reviews × per-game multiplier learnt from the latest dated milestone (any source).', 'BOXLEITER', 1.0, true, false),
        ('ps-ratings-boxleiter-calibrated', 'Boxleiter PS — calibrated', 'PS Store ratings × per-game multiplier learnt from the latest dated milestone (any source).', 'BOXLEITER', 1.0, true, false),
        ('xbox-ratings-boxleiter-calibrated', 'Boxleiter Xbox — calibrated', 'Xbox Store ratings × per-game multiplier learnt from the latest dated milestone (any source).', 'BOXLEITER', 1.0, true, false)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "estimation_method" WHERE code IN ('boxleiter-calibrated', 'ps-ratings-boxleiter-calibrated', 'xbox-ratings-boxleiter-calibrated')`,
    );

    await queryRunner.query(`UPDATE "estimation_method" SET "isEnabled" = true
      WHERE code LIKE '%-calibrated-official'
         OR code LIKE '%-calibrated-announcement'
         OR code LIKE '%-calibrated-media'
         OR code LIKE '%-calibrated-wikipedia'`);

    await queryRunner.query(
      `ALTER TABLE "estimation_discrepancy" RENAME COLUMN "milestoneId" TO "recordId"`,
    );
    await queryRunner.query(`ALTER TABLE "milestone" RENAME TO "sales_record"`);

    await queryRunner.query(
      `CREATE TYPE "public"."sales_record_confidence_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH')`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_record" ADD "confidence" "public"."sales_record_confidence_enum"`,
    );
    await queryRunner.query(`UPDATE "sales_record" SET "confidence" =
      CASE
        WHEN "confidenceScore" >= 75 THEN 'HIGH'::"public"."sales_record_confidence_enum"
        WHEN "confidenceScore" >= 45 THEN 'MEDIUM'::"public"."sales_record_confidence_enum"
        WHEN "confidenceScore" IS NOT NULL THEN 'LOW'::"public"."sales_record_confidence_enum"
        ELSE NULL
      END`);
    await queryRunner.query(
      `ALTER TABLE "sales_record" DROP COLUMN "confidenceScore"`,
    );
  }
}

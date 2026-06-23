import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduce the `estimation_method` registry table and link `sales_estimate`
 * to it via a new `methodId` FK. The legacy free-form `method` column is
 * intentionally kept for one release: it still carries dynamic modifier
 * suffixes (e.g. `+ccu-intersect`, `+launcher-primary`) that aren't yet
 * first-class methods. A follow-up migration will drop it once nothing
 * reads it anymore.
 *
 * Backfill strategy: strip the `+xxx` modifier suffixes from each legacy
 * `method` string and look up the resulting canonical code in the seeded
 * registry. Any leftover row that doesn't match a known code is mapped to
 * the `aggregated` method as a safety net (better than failing the
 * migration on a corner-case tag we forgot).
 */
export class AddEstimationMethodRegistry1782205443622
  implements MigrationInterface
{
  name = 'AddEstimationMethodRegistry1782205443622';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_method_family_enum" AS ENUM('BOXLEITER', 'ACHIEVEMENTS', 'AGGREGATE', 'MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "estimation_method" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "label" character varying NOT NULL,
        "description" text,
        "family" "public"."estimation_method_family_enum" NOT NULL,
        "defaultWeight" numeric(5,2) NOT NULL DEFAULT '1',
        "isEnabled" boolean NOT NULL DEFAULT true,
        "isAggregate" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_estimation_method_code" UNIQUE ("code"),
        CONSTRAINT "PK_estimation_method_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_estimation_method_family" ON "estimation_method" ("family")`,
    );

    await queryRunner.query(`INSERT INTO "estimation_method"
        ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
      VALUES
        ('boxleiter-default', 'Boxleiter PC — default range', 'Steam reviews × default PC Boxleiter range. Used when no calibrated multiplier is available.', 'BOXLEITER', 0.5, true, false),
        ('boxleiter-calibrated-official', 'Boxleiter PC — calibrated (OFFICIAL)', 'Steam reviews × per-game multiplier learnt from a publisher-declared figure.', 'BOXLEITER', 1.0, true, false),
        ('boxleiter-calibrated-announcement', 'Boxleiter PC — calibrated (ANNOUNCEMENT)', 'Steam reviews × per-game multiplier learnt from a social/PR announcement.', 'BOXLEITER', 0.7, true, false),
        ('boxleiter-calibrated-media', 'Boxleiter PC — calibrated (MEDIA)', 'Steam reviews × per-game multiplier learnt from a trusted media outlet.', 'BOXLEITER', 0.5, true, false),
        ('boxleiter-calibrated-wikipedia', 'Boxleiter PC — calibrated (WIKIPEDIA)', 'Steam reviews × per-game multiplier learnt from a Wikipedia-cited figure.', 'BOXLEITER', 0.4, true, false),
        ('ps-ratings-boxleiter-default', 'Boxleiter PS — default range', 'PS Store ratings × default PlayStation Boxleiter range.', 'BOXLEITER', 0.5, true, false),
        ('ps-ratings-boxleiter-calibrated-official', 'Boxleiter PS — calibrated (OFFICIAL)', 'PS Store ratings × per-game multiplier learnt from a publisher-declared figure.', 'BOXLEITER', 1.0, true, false),
        ('ps-ratings-boxleiter-calibrated-announcement', 'Boxleiter PS — calibrated (ANNOUNCEMENT)', 'PS Store ratings × per-game multiplier learnt from a social/PR announcement.', 'BOXLEITER', 0.7, true, false),
        ('ps-ratings-boxleiter-calibrated-media', 'Boxleiter PS — calibrated (MEDIA)', 'PS Store ratings × per-game multiplier learnt from a trusted media outlet.', 'BOXLEITER', 0.5, true, false),
        ('ps-ratings-boxleiter-calibrated-wikipedia', 'Boxleiter PS — calibrated (WIKIPEDIA)', 'PS Store ratings × per-game multiplier learnt from a Wikipedia-cited figure.', 'BOXLEITER', 0.4, true, false),
        ('xbox-ratings-boxleiter-default', 'Boxleiter Xbox — default range', 'Xbox Store ratings × default Xbox Boxleiter range.', 'BOXLEITER', 0.5, true, false),
        ('xbox-ratings-boxleiter-calibrated-official', 'Boxleiter Xbox — calibrated (OFFICIAL)', 'Xbox Store ratings × per-game multiplier learnt from a publisher-declared figure.', 'BOXLEITER', 1.0, true, false),
        ('xbox-ratings-boxleiter-calibrated-announcement', 'Boxleiter Xbox — calibrated (ANNOUNCEMENT)', 'Xbox Store ratings × per-game multiplier learnt from a social/PR announcement.', 'BOXLEITER', 0.7, true, false),
        ('xbox-ratings-boxleiter-calibrated-media', 'Boxleiter Xbox — calibrated (MEDIA)', 'Xbox Store ratings × per-game multiplier learnt from a trusted media outlet.', 'BOXLEITER', 0.5, true, false),
        ('xbox-ratings-boxleiter-calibrated-wikipedia', 'Boxleiter Xbox — calibrated (WIKIPEDIA)', 'Xbox Store ratings × per-game multiplier learnt from a Wikipedia-cited figure.', 'BOXLEITER', 0.4, true, false),
        ('achievements-exophase-pc', 'Achievements PC — Exophase', 'Exophase sample × coverage. Dormant until coverage constants are calibrated.', 'ACHIEVEMENTS', 0.3, false, false),
        ('achievements-exophase-pc-steam-corrected', 'Achievements PC — Exophase + Steam-corrected', 'Exophase sample debiased against Steam-official unlock %. Dormant.', 'ACHIEVEMENTS', 0.3, false, false),
        ('achievements-exophase-playstation', 'Achievements PS — Exophase', 'Exophase sample × coverage on PlayStation. Dormant.', 'ACHIEVEMENTS', 0.3, false, false),
        ('achievements-exophase-xbox', 'Achievements Xbox — Exophase', 'Exophase sample × coverage on Xbox. Dormant.', 'ACHIEVEMENTS', 0.3, false, false),
        ('aggregated', 'Aggregated estimate', 'Weighted combination of every enabled method for the same (game, platform, computedAt). The headline range consumed by the reconcile step.', 'AGGREGATE', 1.0, true, true)`);

    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD "methodId" uuid`,
    );

    // Backfill `methodId` by stripping the `+xxx` modifier suffixes off
    // each legacy `method` string and looking up the canonical code.
    // Unknown rows fall back to `aggregated` as a safety net (defensive;
    // every known shape today is covered by the seed above).
    await queryRunner.query(`UPDATE "sales_estimate" se
      SET "methodId" = COALESCE(
        (
          SELECT em.id
          FROM "estimation_method" em
          WHERE em.code = regexp_replace(se.method, '\\+[^+]+', '', 'g')
        ),
        (SELECT id FROM "estimation_method" WHERE code = 'aggregated')
      )`);

    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ALTER COLUMN "methodId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_estimate_game_platform_method_at" ON "sales_estimate" ("gameId", "platform", "methodId", "computedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD CONSTRAINT "FK_sales_estimate_methodId" FOREIGN KEY ("methodId") REFERENCES "estimation_method"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP CONSTRAINT "FK_sales_estimate_methodId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sales_estimate_game_platform_method_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP COLUMN "methodId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_estimation_method_family"`,
    );
    await queryRunner.query(`DROP TABLE "estimation_method"`);
    await queryRunner.query(
      `DROP TYPE "public"."estimation_method_family_enum"`,
    );
  }
}

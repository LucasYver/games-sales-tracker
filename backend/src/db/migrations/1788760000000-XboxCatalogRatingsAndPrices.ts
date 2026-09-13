import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switch Xbox ratings to Display Catalog worldwide AllTime counts:
 * drop US-scoped snapshots so charts do not jump, and re-enable the
 * default Xbox Boxleiter (genre splits stay on).
 *
 * Also tag price_snapshot rows with a store source so Steam and Xbox
 * prices can share the table.
 */
export class XboxCatalogRatingsAndPrices1788760000000
  implements MigrationInterface
{
  name = 'XboxCatalogRatingsAndPrices1788760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "signal_snapshot" WHERE "metric" = 'XBOX_RATINGS'`,
    );
    await queryRunner.query(
      `UPDATE "estimation_method"
          SET "isEnabled" = true
        WHERE "code" = 'xbox-ratings-boxleiter-default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshot"
         ADD "source" "game_source_source_enum" NOT NULL DEFAULT 'STEAM'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_snapshot_game_source_country_captured"
         ON "price_snapshot" ("gameId", "source", "country", "capturedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_price_snapshot_game_source_country_captured"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshot" DROP COLUMN "source"`,
    );
    await queryRunner.query(
      `UPDATE "estimation_method"
          SET "isEnabled" = false
        WHERE "code" = 'xbox-ratings-boxleiter-default'`,
    );
  }
}

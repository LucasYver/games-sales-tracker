import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds Steam store metadata on `game` (`categories`, `dlc`) and the
 * `price_snapshot` table that records a daily Steam price point per game so
 * price changes form a time series.
 *
 * The auto-generated diff also tried to rename the `sales_record_*` enums to
 * `milestone_*`, drop `estimate_snapshot.pureBreakdown`, and churn a few
 * milestone / estimation_discrepancy indexes. That noise belongs to earlier
 * migrations (RenameSalesRecordToMilestone, AddPureBreakdownToSnapshot, …)
 * and is intentionally omitted here — this migration only ships the new
 * columns and table.
 */
export class AddSteamCategoriesDlcAndPriceSnapshot1782395875937
  implements MigrationInterface
{
  name = 'AddSteamCategoriesDlcAndPriceSnapshot1782395875937';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ADD "categories" text`);
    await queryRunner.query(`ALTER TABLE "game" ADD "dlc" integer array`);
    await queryRunner.query(
      `CREATE TABLE "price_snapshot" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gameId" uuid NOT NULL, "currency" character varying(8) NOT NULL, "initial" integer NOT NULL, "final" integer NOT NULL, "discountPercent" integer NOT NULL DEFAULT '0', "capturedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2cc519fe024a44176db2173d64d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e39786c0ec60812480e07654fe" ON "price_snapshot" ("gameId", "capturedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshot" ADD CONSTRAINT "FK_77f125ab8bb9400fcac80cdfcb8" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "price_snapshot" DROP CONSTRAINT "FK_77f125ab8bb9400fcac80cdfcb8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e39786c0ec60812480e07654fe"`,
    );
    await queryRunner.query(`DROP TABLE "price_snapshot"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "dlc"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "categories"`);
  }
}

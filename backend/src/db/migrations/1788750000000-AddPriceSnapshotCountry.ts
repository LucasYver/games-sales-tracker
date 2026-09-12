import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceSnapshotCountry1788750000000
  implements MigrationInterface
{
  name = 'AddPriceSnapshotCountry1788750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "price_snapshot" ADD "country" character varying(2) NOT NULL DEFAULT 'us'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_snapshot_game_country_captured" ON "price_snapshot" ("gameId", "country", "capturedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_price_snapshot_game_country_captured"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshot" DROP COLUMN "country"`,
    );
  }
}

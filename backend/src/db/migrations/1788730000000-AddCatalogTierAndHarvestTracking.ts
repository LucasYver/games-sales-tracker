import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCatalogTierAndHarvestTracking1788730000000 implements MigrationInterface {
  name = 'AddCatalogTierAndHarvestTracking1788730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."game_catalogtier_enum" AS ENUM('CORE', 'EXTENDED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "catalogTier" "public"."game_catalogtier_enum" NOT NULL DEFAULT 'CORE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "lastMilestoneHarvestedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "game" SET "lastMilestoneHarvestedAt" = "lastRefreshedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_rank" ADD "recentVelocityPercentile" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_rank" DROP COLUMN "recentVelocityPercentile"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "lastMilestoneHarvestedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "catalogTier"`);
    await queryRunner.query(`DROP TYPE "public"."game_catalogtier_enum"`);
  }
}

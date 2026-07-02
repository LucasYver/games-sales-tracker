import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reintroduce a per-platform dimension on `milestone`, replacing the ad-hoc
 * `region` varchar (only ever 'GLOBAL' / 'PC') with a proper `platform` enum
 * so we can store PlayStation / Xbox / Switch cumulative figures scraped from
 * the web and learn the PC-vs-console split from real data.
 *
 * Mapping of the old `region` values:
 *   - 'PC'     -> platform = 'PC'
 *   - 'GLOBAL' -> platform = 'GLOBAL' (worldwide, all-platforms combined)
 *
 * Also adds `isEstimate` to tag lower-trust modeled figures (e.g. a future
 * VGChartz-style source) apart from sourced actuals.
 */
export class ReintroduceMilestonePlatform1782720000000
  implements MigrationInterface
{
  name = 'ReintroduceMilestonePlatform1782720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."milestone_platform_enum" AS ENUM('PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE', 'GLOBAL', 'OTHER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone" ADD "platform" "public"."milestone_platform_enum" NOT NULL DEFAULT 'GLOBAL'`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone" ADD "isEstimate" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "milestone" SET "platform" = 'PC' WHERE "region" = 'PC'`,
    );
    await queryRunner.query(`ALTER TABLE "milestone" DROP COLUMN "region"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_milestone_game_platform" ON "milestone" ("gameId", "platform")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_milestone_game_platform"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone" ADD "region" character varying NOT NULL DEFAULT 'GLOBAL'`,
    );
    await queryRunner.query(
      `UPDATE "milestone" SET "region" = 'PC' WHERE "platform" = 'PC'`,
    );
    await queryRunner.query(`ALTER TABLE "milestone" DROP COLUMN "isEstimate"`);
    await queryRunner.query(`ALTER TABLE "milestone" DROP COLUMN "platform"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."milestone_platform_enum"`,
    );
  }
}

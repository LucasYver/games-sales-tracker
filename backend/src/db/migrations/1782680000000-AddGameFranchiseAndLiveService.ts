import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the per-game features consumed by the data-driven matcher:
 *   - `franchiseSlug`      : franchise identity (strong similarity axis)
 *   - `isAnnualIteration`  : annually-iterated title flag
 *   - `iterationNumber`    : best-effort year / sequel number from title
 *   - `liveService`        : persistent online / ongoing-content flag
 *
 * All four are populated by backfill scripts / ingestion, never hand
 * edited per game. Defaults keep existing rows valid without a data
 * migration (booleans default false, others nullable).
 */
export class AddGameFranchiseAndLiveService1782680000000 implements MigrationInterface {
  name = 'AddGameFranchiseAndLiveService1782680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "franchiseSlug" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "isAnnualIteration" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "game" ADD "iterationNumber" integer`);
    await queryRunner.query(
      `ALTER TABLE "game" ADD "liveService" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_franchiseSlug" ON "game" ("franchiseSlug") WHERE "franchiseSlug" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_game_franchiseSlug"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "liveService"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "iterationNumber"`);
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "isAnnualIteration"`,
    );
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "franchiseSlug"`);
  }
}

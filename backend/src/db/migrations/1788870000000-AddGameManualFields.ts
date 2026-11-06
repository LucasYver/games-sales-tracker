import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Names of the `game` metadata columns an admin corrected by hand. The
 * ingestion upserts (Steam, IGDB) leave these columns alone, so a manual fix
 * survives the next cron pass.
 */
export class AddGameManualFields1788870000000 implements MigrationInterface {
  name = 'AddGameManualFields1788870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "manualFields" text array NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "manualFields"`);
  }
}

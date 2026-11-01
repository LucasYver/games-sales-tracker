import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Language counts of a game's latest sample of recent Steam reviews, shown on
 * its page. Filled by the monthly reviewer-playtime cron.
 */
export class AddGameReviewLanguages1788850000000 implements MigrationInterface {
  name = 'AddGameReviewLanguages1788850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "reviewLanguages" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "reviewLanguages"`);
  }
}

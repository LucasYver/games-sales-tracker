import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Steam store name per site locale, only where it differs from the English
 * one (黑神话：悟空 on /zh-CN). Null for every game: the weekly Steam price
 * cron fills it as it re-prices each game.
 */
export class AddGameLocalizedNames1789090000000 implements MigrationInterface {
  name = 'AddGameLocalizedNames1789090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ADD "localizedNames" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "localizedNames"`);
  }
}

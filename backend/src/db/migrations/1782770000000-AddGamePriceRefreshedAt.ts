import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGamePriceRefreshedAt1782770000000
  implements MigrationInterface
{
  name = 'AddGamePriceRefreshedAt1782770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "priceRefreshedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "priceRefreshedAt"`,
    );
  }
}

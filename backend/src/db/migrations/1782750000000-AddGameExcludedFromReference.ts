import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameExcludedFromReference1782750000000
  implements MigrationInterface
{
  name = 'AddGameExcludedFromReference1782750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "excludedFromReference" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "excludedFromReference"`,
    );
  }
}

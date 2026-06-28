import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameDeletedAt1782656340237 implements MigrationInterface {
  name = 'AddGameDeletedAt1782656340237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "deletedAt"`);
  }
}

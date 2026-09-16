import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropTrustedSourceWeight1788790000000 implements MigrationInterface {
  name = 'DropTrustedSourceWeight1788790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trusted_source" DROP COLUMN "weight"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trusted_source" ADD "weight" integer NOT NULL DEFAULT '50'`,
    );
  }
}

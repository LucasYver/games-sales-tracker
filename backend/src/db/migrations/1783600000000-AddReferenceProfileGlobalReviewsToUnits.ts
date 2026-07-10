import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferenceProfileGlobalReviewsToUnits1783600000000 implements MigrationInterface {
  name = 'AddReferenceProfileGlobalReviewsToUnits1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_profile" ADD "globalReviewsToUnits" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_profile" DROP COLUMN "globalReviewsToUnits"`,
    );
  }
}

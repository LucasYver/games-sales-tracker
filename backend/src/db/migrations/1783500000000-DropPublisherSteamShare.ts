import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPublisherSteamShare1783500000000 implements MigrationInterface {
  name = 'DropPublisherSteamShare1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publisher" DROP COLUMN "steamSharePctHigh"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publisher" DROP COLUMN "steamSharePctLow"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publisher" ADD "steamSharePctLow" double precision NOT NULL DEFAULT '100'`,
    );
    await queryRunner.query(
      `ALTER TABLE "publisher" ADD "steamSharePctHigh" double precision NOT NULL DEFAULT '100'`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cross-posting to X: the short, link-free version of each social post and
 * where it was posted on X.
 */
export class AddSocialPostX1789010000000 implements MigrationInterface {
  name = 'AddSocialPostX1789010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_post"
        ADD COLUMN "xText" text NOT NULL DEFAULT '',
        ADD COLUMN "xExternalId" character varying,
        ADD COLUMN "xExternalUrl" character varying(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_post"
        DROP COLUMN "xExternalUrl",
        DROP COLUMN "xExternalId",
        DROP COLUMN "xText"`);
  }
}

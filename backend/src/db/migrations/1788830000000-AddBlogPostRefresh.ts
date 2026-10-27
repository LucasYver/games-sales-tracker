import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlogPostRefresh1788830000000 implements MigrationInterface {
  name = 'AddBlogPostRefresh1788830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "blog_post"
        ADD COLUMN "contentUpdatedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "liveSnapshot" jsonb,
        ADD COLUMN "staleAckFingerprint" text
    `);
    await queryRunner.query(`
      UPDATE "blog_post"
      SET "contentUpdatedAt" = "publishedAt"
      WHERE "publishedAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "blog_post"
        DROP COLUMN "staleAckFingerprint",
        DROP COLUMN "liveSnapshot",
        DROP COLUMN "contentUpdatedAt"
    `);
  }
}

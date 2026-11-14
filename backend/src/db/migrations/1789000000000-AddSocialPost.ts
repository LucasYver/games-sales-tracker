import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Posts for the site's social accounts (Threads first), drafted by the daily
 * `social-drafts` cron and published by an admin, plus the refreshable access
 * token of each account. A few rows a week.
 */
export class AddSocialPost1789000000000 implements MigrationInterface {
  name = 'AddSocialPost1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "social_post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "network" character varying(16) NOT NULL DEFAULT 'THREADS',
        "kind" character varying(32) NOT NULL,
        "topicKey" character varying(200) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "text" text NOT NULL,
        "linkUrl" character varying(500) NOT NULL,
        "facts" jsonb NOT NULL DEFAULT '[]',
        "unverifiedNumbers" jsonb NOT NULL DEFAULT '[]',
        "model" character varying,
        "externalId" character varying,
        "externalUrl" character varying(500),
        "publishedAt" TIMESTAMP WITH TIME ZONE,
        "lastError" text,
        "reviewedBy" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_post_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_social_post_topicKey" ON "social_post" ("topicKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_social_post_status" ON "social_post" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE "social_credential" (
        "network" character varying(16) NOT NULL,
        "accessToken" text NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "refreshedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_social_credential_network" PRIMARY KEY ("network")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "social_credential"`);
    await queryRunner.query(`DROP TABLE "social_post"`);
  }
}

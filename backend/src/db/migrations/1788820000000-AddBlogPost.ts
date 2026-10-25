import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlogPost1788820000000 implements MigrationInterface {
  name = 'AddBlogPost1788820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "blog_post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "gameId" uuid,
        "kind" character varying(32) NOT NULL DEFAULT 'GAME_SALES_FACTS',
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "factPack" jsonb NOT NULL,
        "model" character varying,
        "generatedAt" TIMESTAMP WITH TIME ZONE,
        "publishedAt" TIMESTAMP WITH TIME ZONE,
        "reviewEmailSentAt" TIMESTAMP WITH TIME ZONE,
        "reviewedBy" character varying,
        "rejectReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_blog_post" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_blog_post_gameId" UNIQUE ("gameId"),
        CONSTRAINT "FK_blog_post_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_blog_post_status" ON "blog_post" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "blog_post_translation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "postId" uuid NOT NULL,
        "locale" character varying(8) NOT NULL,
        "slug" character varying(180) NOT NULL,
        "title" character varying(200) NOT NULL,
        "metaDescription" character varying(320) NOT NULL,
        "excerpt" text NOT NULL,
        "tldr" jsonb NOT NULL,
        "bodyMarkdown" text NOT NULL,
        "faq" jsonb NOT NULL,
        "claims" jsonb NOT NULL DEFAULT '[]',
        "reviewIssues" jsonb NOT NULL DEFAULT '[]',
        "unverifiedNumbers" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_blog_post_translation" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_blog_post_translation_post_locale" UNIQUE ("postId", "locale"),
        CONSTRAINT "UQ_blog_post_translation_locale_slug" UNIQUE ("locale", "slug"),
        CONSTRAINT "FK_blog_post_translation_post" FOREIGN KEY ("postId")
          REFERENCES "blog_post"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "blog_post_translation"`);
    await queryRunner.query(`DROP TABLE "blog_post"`);
  }
}

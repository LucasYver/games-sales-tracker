import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New blog formats: a game can now have several posts (news items, a launch
 * report), so "one post per game" only holds for the sales-facts article.
 * `topicKey` makes the other formats idempotent: the same figure, launch or
 * ranking never gets two posts.
 */
export class AddBlogPostTopicKey1788880000000 implements MigrationInterface {
  name = 'AddBlogPostTopicKey1788880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blog_post" ADD "topicKey" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "blog_post" DROP CONSTRAINT "UQ_blog_post_gameId"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_blog_post_game_facts" ON "blog_post" ("gameId") WHERE "kind" = 'GAME_SALES_FACTS' AND "gameId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_blog_post_topicKey" ON "blog_post" ("topicKey") WHERE "topicKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The old constraint only fits sales-facts articles: the other formats go.
    await queryRunner.query(
      `DELETE FROM "blog_post" WHERE "kind" <> 'GAME_SALES_FACTS'`,
    );
    await queryRunner.query(`DROP INDEX "UQ_blog_post_topicKey"`);
    await queryRunner.query(`DROP INDEX "UQ_blog_post_game_facts"`);
    await queryRunner.query(
      `ALTER TABLE "blog_post" ADD CONSTRAINT "UQ_blog_post_gameId" UNIQUE ("gameId")`,
    );
    await queryRunner.query(`ALTER TABLE "blog_post" DROP COLUMN "topicKey"`);
  }
}

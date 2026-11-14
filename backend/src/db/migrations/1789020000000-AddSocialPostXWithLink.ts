import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-post choice to add the link to the X version of a social post. */
export class AddSocialPostXWithLink1789020000000 implements MigrationInterface {
  name = 'AddSocialPostXWithLink1789020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_post" ADD COLUMN "xWithLink" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_post" DROP COLUMN "xWithLink"`,
    );
  }
}

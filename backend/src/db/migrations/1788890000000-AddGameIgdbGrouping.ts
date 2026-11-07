import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How IGDB groups a game, for the public pages: its series (franchise pages)
 * and its developer and publisher (studio pages, game page). Kept apart from
 * `franchiseSlug`, `developer` and `publisher`, which the matcher and the ML
 * read. `igdbCheckedAt` orders the nightly refresh: games never checked come
 * first.
 */
export class AddGameIgdbGrouping1788890000000 implements MigrationInterface {
  name = 'AddGameIgdbGrouping1788890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "seriesSlug" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "seriesName" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbDeveloper" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbPublisher" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "igdbCheckedAt"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "igdbPublisher"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "igdbDeveloper"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "seriesName"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "seriesSlug"`);
  }
}

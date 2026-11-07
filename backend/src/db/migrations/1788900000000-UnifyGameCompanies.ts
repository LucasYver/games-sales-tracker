import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One developer and one publisher per game, from IGDB. `developer` and
 * `publisher` take the IGDB credit the nightly refresh already stored, unless
 * an admin corrected them. The store names they held move to `steamDeveloper`
 * / `steamPublisher`, kept as the fallback and for old studio slugs. Games the
 * refresh has not reached yet switch at their turn.
 */
export class UnifyGameCompanies1788900000000 implements MigrationInterface {
  name = 'UnifyGameCompanies1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "steamDeveloper" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "steamPublisher" character varying`,
    );
    await queryRunner.query(
      `UPDATE "game" SET "steamDeveloper" = "developer", "steamPublisher" = "publisher"`,
    );
    await queryRunner.query(
      `UPDATE "game" SET "developer" = "igdbDeveloper"
       WHERE "igdbDeveloper" IS NOT NULL
         AND NOT ('developer' = ANY("manualFields"))`,
    );
    await queryRunner.query(
      `UPDATE "game" SET "publisher" = "igdbPublisher"
       WHERE "igdbPublisher" IS NOT NULL
         AND NOT ('publisher' = ANY("manualFields"))`,
    );
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "igdbDeveloper"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "igdbPublisher"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbPublisher" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbDeveloper" character varying`,
    );
    await queryRunner.query(
      `UPDATE "game" SET "igdbDeveloper" = "developer", "igdbPublisher" = "publisher"
       WHERE "igdbCheckedAt" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "game"
       SET "developer" = CASE WHEN 'developer' = ANY("manualFields") THEN "developer" ELSE "steamDeveloper" END,
           "publisher" = CASE WHEN 'publisher' = ANY("manualFields") THEN "publisher" ELSE "steamPublisher" END`,
    );
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "steamPublisher"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "steamDeveloper"`);
  }
}

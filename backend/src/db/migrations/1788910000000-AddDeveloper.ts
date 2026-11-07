import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per development studio, linked from `game.developerId`, like
 * `publisher`. Rows and links are filled by `DevelopersService` at boot, at
 * ingestion and by the nightly IGDB refresh.
 */
export class AddDeveloper1788910000000 implements MigrationInterface {
  name = 'AddDeveloper1788910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "developer" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_developer" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_developer_name" ON "developer" ("name")`,
    );
    await queryRunner.query(`ALTER TABLE "game" ADD "developerId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_developerId" ON "game" ("developerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD CONSTRAINT "FK_game_developer"
       FOREIGN KEY ("developerId") REFERENCES "developer"("id")
       ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP CONSTRAINT "FK_game_developer"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_game_developerId"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "developerId"`);
    await queryRunner.query(`DROP TABLE "developer"`);
  }
}

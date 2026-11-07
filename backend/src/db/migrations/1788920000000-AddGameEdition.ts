import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The commercial editions IGDB lists for a catalog game (see
 * `entities/game-edition.entity.ts`), filled by the nightly IGDB refresh.
 */
export class AddGameEdition1788920000000 implements MigrationInterface {
  name = 'AddGameEdition1788920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "game_edition" (
        "igdbId" integer NOT NULL,
        "gameId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "versionTitle" character varying,
        "releaseDate" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_game_edition" PRIMARY KEY ("igdbId"),
        CONSTRAINT "FK_game_edition_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_edition_gameId" ON "game_edition" ("gameId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "game_edition"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What IGDB says about a game beyond its sales signals: the other stores it
 * links (Epic, GOG, Game Pass cloud), its release type and parent game, its
 * game modes and its player-reported time to beat (`games/igdb-facts.ts`).
 */
export class AddGameIgdbFacts1788940000000 implements MigrationInterface {
  name = 'AddGameIgdbFacts1788940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game"
        ADD "igdbEpicUrl" character varying,
        ADD "igdbGogUrl" character varying,
        ADD "igdbGamePassCloud" boolean NOT NULL DEFAULT false,
        ADD "gameType" character varying,
        ADD "igdbParentGameId" integer,
        ADD "igdbParentGameName" character varying,
        ADD "gameModes" text[],
        ADD "timeToBeat" jsonb
    `);
    // The game page lists a game's remakes and remasters by parent id.
    await queryRunner.query(
      `CREATE INDEX "IDX_game_igdbParentGameId" ON "game" ("igdbParentGameId")
       WHERE "igdbParentGameId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_game_igdbParentGameId"`);
    await queryRunner.query(`
      ALTER TABLE "game"
        DROP COLUMN "timeToBeat",
        DROP COLUMN "gameModes",
        DROP COLUMN "igdbParentGameName",
        DROP COLUMN "igdbParentGameId",
        DROP COLUMN "gameType",
        DROP COLUMN "igdbGamePassCloud",
        DROP COLUMN "igdbGogUrl",
        DROP COLUMN "igdbEpicUrl"
    `);
  }
}

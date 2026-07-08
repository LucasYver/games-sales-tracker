import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-platform IGDB `release_dates`, e.g. a game can launch on PlayStation a
 * year ahead of its PC port. `game.releaseDate` stays the earliest date
 * across all platforms (IGDB `first_release_date`) for platform-agnostic
 * logic; this table lets platform-scoped estimation anchor on the right
 * launch date. Rewritten wholesale per game on each ingestion sync.
 */
export class AddGamePlatformReleaseDate1782780000000 implements MigrationInterface {
  name = 'AddGamePlatformReleaseDate1782780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."game_platform_release_date_platform_enum" AS ENUM('PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE', 'GLOBAL', 'OTHER')`,
    );
    await queryRunner.query(`
      CREATE TABLE "game_platform_release_date" (
        "gameId" uuid NOT NULL,
        "platform" "public"."game_platform_release_date_platform_enum" NOT NULL,
        "releaseDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_game_platform_release_date" PRIMARY KEY ("gameId", "platform"),
        CONSTRAINT "FK_game_platform_release_date_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "game_platform_release_date"`);
    await queryRunner.query(
      `DROP TYPE "public"."game_platform_release_date_platform_enum"`,
    );
  }
}

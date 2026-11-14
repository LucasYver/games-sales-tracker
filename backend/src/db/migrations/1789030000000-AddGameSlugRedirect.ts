import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The slugs renamed games no longer use, each pointing at its game (see
 * `entities/game-slug-redirect.entity.ts`).
 */
export class AddGameSlugRedirect1789030000000 implements MigrationInterface {
  name = 'AddGameSlugRedirect1789030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "game_slug_redirect" (
        "slug" character varying NOT NULL,
        "gameId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_slug_redirect" PRIMARY KEY ("slug"),
        CONSTRAINT "FK_game_slug_redirect_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_slug_redirect_gameId" ON "game_slug_redirect" ("gameId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "game_slug_redirect"`);
  }
}

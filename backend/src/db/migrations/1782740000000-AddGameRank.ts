import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameRank1782740000000 implements MigrationInterface {
  name = 'AddGameRank1782740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_rank" (
        "gameId" uuid NOT NULL,
        "weeksCharted" integer NOT NULL,
        "peakRank" integer NOT NULL,
        "avgRank" double precision NOT NULL,
        "peakPercentile" double precision NOT NULL,
        "avgPercentile" double precision NOT NULL,
        "weeksTopDecile" integer NOT NULL,
        "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_game_rank" PRIMARY KEY ("gameId"),
        CONSTRAINT "FK_game_rank_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "game_rank"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameIngestionState1788735000000 implements MigrationInterface {
  name = 'AddGameIngestionState1788735000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "game_ingestion_state" (
        "gameId" uuid NOT NULL,
        "pipeline" character varying(64) NOT NULL,
        "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
        "lastSuccessAt" TIMESTAMP WITH TIME ZONE,
        "failureCount" integer NOT NULL DEFAULT 0,
        "lastError" text,
        CONSTRAINT "PK_game_ingestion_state" PRIMARY KEY ("gameId", "pipeline"),
        CONSTRAINT "FK_game_ingestion_state_game" FOREIGN KEY ("gameId")
          REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_ingestion_state_pipeline_attempt"
       ON "game_ingestion_state" ("pipeline", "lastAttemptAt")`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT id, 'DISCOVERY', "createdAt", "createdAt" FROM game`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT id, 'SIGNALS_REFRESH', "lastRefreshedAt", "lastRefreshedAt"
       FROM game WHERE "lastRefreshedAt" IS NOT NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT "gameId", 'STEAM_CCU', MAX("capturedAt"), MAX("capturedAt")
       FROM signal_snapshot WHERE metric = 'STEAM_CONCURRENT' GROUP BY "gameId"`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT "gameId", 'STEAM_PRICE', MAX("capturedAt"), MAX("capturedAt")
       FROM price_snapshot GROUP BY "gameId"`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT "gameId", 'TWITCH_VIEWERS', MAX("capturedAt"), MAX("capturedAt")
       FROM signal_snapshot WHERE metric = 'TWITCH_VIEWERS' GROUP BY "gameId"`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT "gameId", 'STEAM_POPULARITY', MAX("capturedAt"), MAX("capturedAt")
       FROM signal_snapshot WHERE metric = 'STEAM_FOLLOWERS' GROUP BY "gameId"`,
    );
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT id, 'MILESTONE_HARVEST',
              "lastMilestoneHarvestedAt", "lastMilestoneHarvestedAt"
       FROM game WHERE "lastMilestoneHarvestedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_game_ingestion_state_pipeline_attempt"`,
    );
    await queryRunner.query(`DROP TABLE "game_ingestion_state"`);
  }
}

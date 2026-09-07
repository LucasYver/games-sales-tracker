import { MigrationInterface, QueryRunner } from 'typeorm';

const SPLIT_PIPELINES = [
  'STEAM_REVIEWS',
  'STORE_RATINGS',
  'ACHIEVEMENTS',
  'ESTIMATE_REBUILD',
];

export class SplitSignalsRefreshPipelines1788740000000 implements MigrationInterface {
  name = 'SplitSignalsRefreshPipelines1788740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The monolithic signals refresh did all four jobs in one pass, so its
    // timestamps are a valid starting point for each split pipeline and keep
    // the stalest-first ordering meaningful from the very first run.
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT state."gameId", pipeline.name,
              state."lastAttemptAt", state."lastSuccessAt"
       FROM "game_ingestion_state" state
       CROSS JOIN unnest($1::text[]) AS pipeline(name)
       WHERE state.pipeline = 'SIGNALS_REFRESH'
       ON CONFLICT ("gameId", pipeline) DO NOTHING`,
      [SPLIT_PIPELINES],
    );
    await queryRunner.query(
      `DELETE FROM "game_ingestion_state" WHERE pipeline = 'SIGNALS_REFRESH'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "game_ingestion_state"
        ("gameId", pipeline, "lastAttemptAt", "lastSuccessAt")
       SELECT "gameId", 'SIGNALS_REFRESH',
              MIN("lastAttemptAt"), MIN("lastSuccessAt")
       FROM "game_ingestion_state"
       WHERE pipeline = ANY($1::text[])
       GROUP BY "gameId"
       ON CONFLICT ("gameId", pipeline) DO NOTHING`,
      [SPLIT_PIPELINES],
    );
    await queryRunner.query(
      `DELETE FROM "game_ingestion_state" WHERE pipeline = ANY($1::text[])`,
      [SPLIT_PIPELINES],
    );
  }
}

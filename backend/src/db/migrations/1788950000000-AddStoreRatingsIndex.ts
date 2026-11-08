import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The listing's "Reviews" column sums Steam reviews and the PlayStation, Xbox
 * and Switch store ratings of every game. Without this index each console
 * count is a bitmap heap scan per game (~1 s for the whole catalog); with it,
 * one index-only probe per game and platform, like the Steam one. Partial, so
 * it only holds the ~275k real console rating rows (~10 MB).
 *
 * Plain CREATE INDEX: migrations run inside a transaction, so CONCURRENTLY is
 * not available. Writes to signal_snapshot wait while it builds (seconds).
 */
export class AddStoreRatingsIndex1788950000000 implements MigrationInterface {
  name = 'AddStoreRatingsIndex1788950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_signal_snapshot_store_ratings"
         ON "signal_snapshot" ("gameId", "metric", "value")
         WHERE "metric" IN ('PS_RATINGS', 'XBOX_RATINGS', 'SWITCH_RATINGS')
           AND NOT "synthetic"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_signal_snapshot_store_ratings"`,
    );
  }
}

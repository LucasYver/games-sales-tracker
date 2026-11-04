import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each game's Steam review count (MAX of its STEAM_REVIEWS snapshots) is read
 * for every game on the public listing. Without this index that is a full
 * scan of signal_snapshot (~3.9M rows, ~0.7 s) on every uncached listing
 * call; with it, one index-only probe per game. Partial, so it only holds the
 * ~720k review rows (~30 MB).
 *
 * Plain CREATE INDEX: migrations run inside a transaction, so CONCURRENTLY is
 * not available. Writes to signal_snapshot wait while it builds (seconds).
 */
export class AddSteamReviewsIndex1788860000000 implements MigrationInterface {
  name = 'AddSteamReviewsIndex1788860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_signal_snapshot_steam_reviews"
         ON "signal_snapshot" ("gameId", "value")
         WHERE "metric" = 'STEAM_REVIEWS'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_signal_snapshot_steam_reviews"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `STEAM_REVIEWER_MEDIAN_PLAYTIME` signal metric. `SignalMetric` is
 * mapped only by the `signal_snapshot` entity, so a single `ADD VALUE` on
 * `signal_snapshot_metric_enum` suffices. `ADD VALUE` cannot run inside a
 * transaction, hence the direct (non-pooled) connection used by the migration
 * runner.
 */
export class AddSteamReviewerMedianPlaytimeMetric1783800000000
  implements MigrationInterface
{
  name = 'AddSteamReviewerMedianPlaytimeMetric1783800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_metric_enum" ADD VALUE IF NOT EXISTS 'STEAM_REVIEWER_MEDIAN_PLAYTIME'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating the type and rewriting every dependent column. The
    // value is harmless if left in place, so the down migration is a no-op.
  }
}

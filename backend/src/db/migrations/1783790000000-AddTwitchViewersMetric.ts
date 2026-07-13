import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the Twitch viewers signal. `SourceType.TWITCH` is referenced by three
 * separate Postgres enum types (one per entity that maps the enum column), so
 * the new value must be added to each; `SignalMetric.TWITCH_VIEWERS` extends
 * the single metric enum. `ADD VALUE` cannot run inside a transaction, hence
 * the direct (non-pooled) connection used by the migration runner.
 */
export class AddTwitchViewersMetric1783790000000 implements MigrationInterface {
  name = 'AddTwitchViewersMetric1783790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_source_enum" ADD VALUE IF NOT EXISTS 'TWITCH'`,
    );
    await queryRunner.query(
      `ALTER TYPE "game_source_source_enum" ADD VALUE IF NOT EXISTS 'TWITCH'`,
    );
    await queryRunner.query(
      `ALTER TYPE "achievement_snapshot_source_enum" ADD VALUE IF NOT EXISTS 'TWITCH'`,
    );
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_metric_enum" ADD VALUE IF NOT EXISTS 'TWITCH_VIEWERS'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating the type and rewriting every dependent column. The
    // values are harmless if left in place, so the down migration is a no-op.
  }
}

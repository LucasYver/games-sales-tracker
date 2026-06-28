import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSteamPlayersLeakMetric1782660000000 implements MigrationInterface {
  name = 'AddSteamPlayersLeakMetric1782660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_metric_enum" ADD VALUE IF NOT EXISTS 'STEAM_PLAYERS_LEAK'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating the type and rewriting every dependent column.
    // The value is harmless if left in place, so the down migration is a
    // deliberate no-op.
  }
}

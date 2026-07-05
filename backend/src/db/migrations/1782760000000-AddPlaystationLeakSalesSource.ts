import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Register the `PLAYSTATION_LEAK` sales source across every Postgres enum that
 * accepts a milestone/calibration source, mirroring the earlier `STEAM_LEAK`
 * migrations. The value feeds the first-party PlayStation sales figures leaked
 * in the Dec 2023 Rhysida/Insomniac breach (internal SIE shipments as of
 * 2022-02-27). The actual milestone rows are inserted by the separate
 * `BackfillPlaystationLeakMilestones` migration — Postgres forbids using a
 * freshly-added enum value in the same transaction that added it.
 */
export class AddPlaystationLeakSalesSource1782760000000
  implements MigrationInterface
{
  name = 'AddPlaystationLeakSalesSource1782760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."milestone_source_enum" ADD VALUE IF NOT EXISTS 'PLAYSTATION_LEAK'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourcepc_enum" ADD VALUE IF NOT EXISTS 'PLAYSTATION_LEAK'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourceps_enum" ADD VALUE IF NOT EXISTS 'PLAYSTATION_LEAK'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourcexbox_enum" ADD VALUE IF NOT EXISTS 'PLAYSTATION_LEAK'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating each type and rewriting the dependent columns. The
    // value is harmless if left in place, so the down migration is a no-op.
  }
}

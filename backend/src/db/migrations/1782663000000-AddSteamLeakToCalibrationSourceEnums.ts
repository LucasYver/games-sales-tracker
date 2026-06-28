import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `Game.calibrationSource{Pc,Ps,Xbox}` use three Postgres enum types distinct
 * from `milestone_source_enum`. The earlier `AddSteamLeakSalesSource` migration
 * only added the value to the milestone enum; the calibration columns reject
 * the new `STEAM_LEAK` value at write time (e.g. PC-region calibration from a
 * Steam-leak milestone).
 */
export class AddSteamLeakToCalibrationSourceEnums1782663000000
  implements MigrationInterface
{
  name = 'AddSteamLeakToCalibrationSourceEnums1782663000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourcepc_enum" ADD VALUE IF NOT EXISTS 'STEAM_LEAK'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourceps_enum" ADD VALUE IF NOT EXISTS 'STEAM_LEAK'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_calibrationsourcexbox_enum" ADD VALUE IF NOT EXISTS 'STEAM_LEAK'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating each type and rewriting the calibrationSource* columns.
    // The value is harmless if left in place, so the down migration is a
    // deliberate no-op.
  }
}

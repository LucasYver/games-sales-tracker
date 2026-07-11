import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the per-game calibration schema now that sales estimates are
 * corpus-only: declared milestones no longer derive per-game Boxleiter
 * multipliers, and the "pure algo" headline is redundant (the reconciled
 * headline is already the corpus output, without any declared-figure
 * floor/cap).
 *
 * Drops on `game`:
 *   - calibratedMultiplier / calibratedPsMultiplier / calibratedXboxMultiplier
 *   - calibrationSourcePc / calibrationSourcePs / calibrationSourceXbox (+ enums)
 *   - psCalibrationReconstructed
 *
 * Drops on `estimate_snapshot`:
 *   - pureEstimatedTodayLow / pureEstimatedTodayHigh
 *
 * The `down` recreates the columns (nullable) and enum types so the schema
 * can be rolled back, but historical calibration values are not restored.
 */
export class DropCalibrationAndPureEstimate1783780000000
  implements MigrationInterface
{
  name = 'DropCalibrationAndPureEstimate1783780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibratedMultiplier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibratedPsMultiplier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibratedXboxMultiplier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibrationSourcePc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibrationSourcePs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "calibrationSourceXbox"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN IF EXISTS "psCalibrationReconstructed"`,
    );

    await queryRunner.query(
      `DROP TYPE IF EXISTS "game_calibrationsourcepc_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "game_calibrationsourceps_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "game_calibrationsourcexbox_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN IF EXISTS "pureEstimatedTodayLow"`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN IF EXISTS "pureEstimatedTodayHigh"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD COLUMN "pureEstimatedTodayHigh" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD COLUMN "pureEstimatedTodayLow" integer`,
    );

    const enumValues =
      `'OFFICIAL', 'WIKIPEDIA', 'ANNOUNCEMENT', 'MEDIA', ` +
      `'STEAM_LEAK', 'PLAYSTATION_LEAK'`;
    await queryRunner.query(
      `CREATE TYPE "game_calibrationsourcepc_enum" AS ENUM(${enumValues})`,
    );
    await queryRunner.query(
      `CREATE TYPE "game_calibrationsourceps_enum" AS ENUM(${enumValues})`,
    );
    await queryRunner.query(
      `CREATE TYPE "game_calibrationsourcexbox_enum" AS ENUM(${enumValues})`,
    );

    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "psCalibrationReconstructed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibrationSourceXbox" "game_calibrationsourcexbox_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibrationSourcePs" "game_calibrationsourceps_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibrationSourcePc" "game_calibrationsourcepc_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibratedXboxMultiplier" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibratedPsMultiplier" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN "calibratedMultiplier" double precision`,
    );
  }
}

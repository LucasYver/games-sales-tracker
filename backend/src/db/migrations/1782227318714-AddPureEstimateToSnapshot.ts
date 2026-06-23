import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a parallel "pure algo" headline range to `estimate_snapshot`.
 *
 * Motivation: today the snapshot's `estimatedTodayLow/High` is the
 * reconciled figure — it benefits from (a) Boxleiter multipliers
 * calibrated on declared sales records and (b) the declared figures
 * themselves used as floor / freshness-capped ceiling inside
 * `aggregateSales`. That's the right number for the user-facing
 * headline but it makes it impossible to measure how our model
 * performs *on its own*.
 *
 * `pureEstimatedTodayLow/High` is the same headline range but
 * computed with `ignoreCalibration = true` (all multipliers fall
 * back to the platform default range) and with `aggregateSales`
 * called with an empty record list (no declared-figure floor / cap).
 *
 * Columns are nullable: legacy rows produced before this migration
 * stay as-is (`NULL`) and only future snapshots get both values.
 * Re-running `rebuildEstimateHistory` will backfill the whole
 * history for a given game.
 */
export class AddPureEstimateToSnapshot1782227318714
  implements MigrationInterface
{
  name = 'AddPureEstimateToSnapshot1782227318714';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD "pureEstimatedTodayLow" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD "pureEstimatedTodayHigh" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN "pureEstimatedTodayHigh"`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN "pureEstimatedTodayLow"`,
    );
  }
}

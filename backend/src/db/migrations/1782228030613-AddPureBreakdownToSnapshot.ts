import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the per-platform breakdown of the "pure algo" headline
 * computed alongside the reconciled one in `snapshotReconcile`.
 *
 * Shape: `[{ platform: Platform, low: number, high: number }, ...]`.
 *
 * Why a jsonb breakdown rather than a parallel `SalesEstimate`
 * row per platform: the pure-algo aggregates are deliberately
 * NOT persisted as `SalesEstimate` rows (they would shadow the
 * real, calibrated rows in the admin view). Caching them on the
 * snapshot lets the methods card surface "pure consensus per
 * platform vs calibrated aggregated per platform" without
 * re-running the estimation pipeline on every page load.
 *
 * Defaults to an empty array so the column is non-null on every
 * row (legacy rows just won't have any breakdown to display).
 */
export class AddPureBreakdownToSnapshot1782228030613
  implements MigrationInterface
{
  name = 'AddPureBreakdownToSnapshot1782228030613';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD "pureBreakdown" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN "pureBreakdown"`,
    );
  }
}

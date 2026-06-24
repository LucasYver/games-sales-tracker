import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hard-delete every artefact of the deprecated Xbox Store rating
 * signal so the new PS→Xbox genre-split pipeline starts from a clean
 * slate. The previous per-locale ratingCount scrape under-counted AAA
 * titles by 10×+ and any stale row left around would either skew the
 * aggregator (when its method was still enabled) or pollute the admin
 * UI (when disabled but still present).
 *
 * Sweeps (in order, so we don't leave dangling FK references):
 *
 *  1. Every `SalesEstimate` whose `methodId` resolves to one of the
 *     `xbox-ratings-boxleiter-*` codes (default + 4 calibrated
 *     source variants).
 *  2. Every `SignalSnapshot` with `metric = 'XBOX_RATINGS'`.
 *  3. Reset `Game.calibratedXboxMultiplier` and
 *     `Game.calibrationSourceXbox` — those were derived from the
 *     Xbox rating signal and are meaningless once the underlying
 *     signal is gone.
 *
 * Estimate snapshots (`EstimateSnapshot`) are NOT touched here: they
 * hold the per-game reconciled headline at a point in time, with no
 * per-platform / per-method breakdown that could be cleaned in place.
 * Run `GamesService.rebuildEstimateHistory` on affected games to
 * regenerate them with the new pipeline.
 *
 * This is a one-way data scrub: the `down` side is a no-op (we can't
 * resurrect deleted rows, and re-running the scraper would only
 * repopulate `SignalSnapshot` going forward anyway).
 */
export class CleanupXboxRatingsData1782253600000
  implements MigrationInterface
{
  name = 'CleanupXboxRatingsData1782253600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sales_estimate"
        WHERE "methodId" IN (
          SELECT id FROM "estimation_method"
           WHERE code LIKE 'xbox-ratings-boxleiter%'
        )`,
    );

    await queryRunner.query(
      `DELETE FROM "signal_snapshot"
        WHERE "metric" = 'XBOX_RATINGS'`,
    );

    await queryRunner.query(
      `UPDATE "game"
          SET "calibratedXboxMultiplier" = NULL,
              "calibrationSourceXbox" = NULL
        WHERE "calibratedXboxMultiplier" IS NOT NULL
           OR "calibrationSourceXbox" IS NOT NULL`,
    );
  }

  public async down(): Promise<void> {
    // No-op: deleted rows cannot be resurrected and the upstream Xbox
    // rating signal has been retired. Re-enable the scraper (and
    // `xbox-ratings-boxleiter-*` methods via the previous migration's
    // `down`) if the path ever needs to come back.
  }
}

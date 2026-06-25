import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recalibrates the `simulation` genre profile's peak-CCU → week-1 ratio
 * against declared figures (anchor: Frostpunk, ~4.3M PC declared, peak CCU
 * ~29k → real launch ratio ~8.8×).
 *
 * Colony / management / vehicle sims are largely single-player and
 * finishable: their concurrent footprint is tiny relative to total owners,
 * so the previous range (2.0–3.5, sized on high-concurrency strategy) made
 * the first-week extrapolation undershoot sales by ~3–4×. The lifetime
 * projection (m1 + VERY_HIGH tail) was already correct; only the peak→week-1
 * base ratio was too low.
 *
 * Data-only change (admin-editable); shipped as a migration for reproducibility.
 */
export class RecalibrateSimulationPeakCcuRatio1782397500000
  implements MigrationInterface
{
  name = 'RecalibrateSimulationPeakCcuRatio1782397500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET "peakCcuToWeekOneLow" = 6.0,
             "peakCcuToWeekOneHigh" = 11.0
       WHERE slug = 'simulation'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET "peakCcuToWeekOneLow" = 2.0,
             "peakCcuToWeekOneHigh" = 3.5
       WHERE slug = 'simulation'`,
    );
  }
}

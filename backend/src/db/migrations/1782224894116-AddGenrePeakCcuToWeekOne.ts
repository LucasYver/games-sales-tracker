import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the genre-specific "all-time peak Steam CCU → week-1 units"
 * range (`peakCcuToWeekOneLow` / `peakCcuToWeekOneHigh`) to
 * `genre_profile` and seeds it for every existing profile.
 *
 * Motivation: the first-week extrapolation used a single global range
 * `[3, 7]` calibrated on action / multiplayer launches. For
 * high-engagement genres (grand strategy, MMO, MOBA, battle royale)
 * the peak CCU is huge relative to total sales — a large share of
 * owners are online simultaneously — so the real ratio is much lower
 * (~1.5-3×). Applying `[3, 7]` there overestimated week-1 (and hence
 * the projected lifetime units) by ~2×. Europa Universalis V was the
 * trigger: peak 72.8k, declared ~986k at 7.5 months, implied week-1
 * ratio ≈ 2.5 vs the 5.0 midpoint we were using.
 *
 * Values are a first-pass heuristic anchored on EU5 + the lifecycle
 * index ranking; they are editable from the admin and will be
 * refined as more dated declared figures land.
 *
 * Columns are added nullable, back-filled, then set NOT NULL so the
 * entity contract (non-null numerics) holds.
 */
export class AddGenrePeakCcuToWeekOne1782224894116
  implements MigrationInterface
{
  name = 'AddGenrePeakCcuToWeekOne1782224894116';

  // [slug, low, high]
  private static readonly SEED: ReadonlyArray<readonly [string, number, number]> =
    [
      ['sandbox', 2.0, 4.0],
      ['grand-strategy-rts', 1.8, 3.2],
      ['simulation', 2.0, 3.5],
      ['co-op-party', 2.5, 5.0],
      ['survival-craft', 2.2, 4.0],
      ['roguelike-deckbuilder', 3.0, 6.0],
      ['tactical-competitive-shooter', 1.8, 3.5],
      ['moba', 1.2, 2.5],
      ['mmorpg', 1.3, 2.8],
      ['fighting', 2.5, 5.0],
      ['horror', 3.0, 6.0],
      ['racing-arcade', 2.5, 5.0],
      ['battle-royale', 1.0, 2.5],
      ['action-rpg', 3.5, 6.5],
      ['western-rpg', 4.0, 7.5],
      ['platformer-mainstream', 4.0, 8.0],
      ['jrpg', 4.5, 9.0],
      ['visual-novel', 5.0, 10.0],
      ['cinematic-action-adventure-aaa', 4.0, 8.0],
      ['narrative-walking-sim', 5.0, 11.0],
      ['sport', 2.5, 5.0],
    ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "peakCcuToWeekOneLow" numeric(4,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "peakCcuToWeekOneHigh" numeric(4,2)`,
    );

    for (const [slug, low, high] of AddGenrePeakCcuToWeekOne1782224894116.SEED) {
      await queryRunner.query(
        `UPDATE "genre_profile"
         SET "peakCcuToWeekOneLow" = $2, "peakCcuToWeekOneHigh" = $3
         WHERE slug = $1`,
        [slug, low, high],
      );
    }

    // Safety net for any profile not covered by the seed (e.g. a row
    // added out-of-band): fall back to the legacy global [3, 7] so the
    // NOT NULL constraint below never fails.
    await queryRunner.query(
      `UPDATE "genre_profile"
       SET "peakCcuToWeekOneLow" = 3.0
       WHERE "peakCcuToWeekOneLow" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "genre_profile"
       SET "peakCcuToWeekOneHigh" = 7.0
       WHERE "peakCcuToWeekOneHigh" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "peakCcuToWeekOneLow" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "peakCcuToWeekOneHigh" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "peakCcuToWeekOneHigh"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "peakCcuToWeekOneLow"`,
    );
  }
}

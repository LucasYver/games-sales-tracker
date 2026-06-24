import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pivot the Xbox estimation away from the per-region Xbox Store ratings
 * scrape (the `xbox.com/{locale}` page only exposes the local market's
 * ratingCount, so AAA titles see only a fraction of their true signal).
 *
 * Two changes:
 *
 *  1. Seed a new `genre-console-split-from-ps-xbox` method that
 *     ventilates the PS aggregate into Xbox using the resolved
 *     `GenreProfile` (`xboxShare / playstationShare`). When PS data is
 *     unavailable, the existing `genre-console-split-from-pc-xbox`
 *     method still acts as a fallback path from PC.
 *
 *  2. Disable every `xbox-ratings-boxleiter-*` method. Existing
 *     `sales_estimate` rows that reference them are kept (historical
 *     audit trail) but will no longer feed the aggregator. New
 *     ingestions stop writing XBOX_RATINGS signals altogether (see
 *     `StoreRatingsClient`).
 *
 * Same weight as the PC-sourced splits (0.4) so a future opt-in can
 * combine both Xbox splits with consistent weighting.
 */
export class AddPsToXboxGenreSplitMethod1782253500000
  implements MigrationInterface
{
  name = 'AddPsToXboxGenreSplitMethod1782253500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "estimation_method" ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
       VALUES (
         'genre-console-split-from-ps-xbox',
         'Genre-aware Xbox share of the PS aggregate (xboxShare / playstationShare)',
         'Ventilates the PlayStation aggregate to Xbox using the resolved GenreProfile. Preferred over the PC-sourced split when PS data is available because PS is the closest console proxy.',
         'PLATFORM_SPLIT',
         0.4,
         true,
         false
       )`,
    );

    await queryRunner.query(
      `UPDATE "estimation_method"
         SET "isEnabled" = false
       WHERE "code" IN (
         'xbox-ratings-boxleiter-default',
         'xbox-ratings-boxleiter-calibrated-official',
         'xbox-ratings-boxleiter-calibrated-announcement',
         'xbox-ratings-boxleiter-calibrated-media',
         'xbox-ratings-boxleiter-calibrated-wikipedia'
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "estimation_method"
         SET "isEnabled" = true
       WHERE "code" IN (
         'xbox-ratings-boxleiter-default',
         'xbox-ratings-boxleiter-calibrated-official',
         'xbox-ratings-boxleiter-calibrated-announcement',
         'xbox-ratings-boxleiter-calibrated-media',
         'xbox-ratings-boxleiter-calibrated-wikipedia'
       )`,
    );

    await queryRunner.query(
      `DELETE FROM "estimation_method"
        WHERE "code" = 'genre-console-split-from-ps-xbox'`,
    );
  }
}

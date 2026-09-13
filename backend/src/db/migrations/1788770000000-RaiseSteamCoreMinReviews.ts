import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Steam Core admission moved from 2,500 to 5,000 reviews
 * (`STEAM_CORE_MIN_REVIEWS`). Existing Core rows never demote in app code,
 * so this backfill drops titles whose latest STEAM_REVIEWS is still below
 * the new bar (including games with no Steam review signal).
 */
export class RaiseSteamCoreMinReviews1788770000000
  implements MigrationInterface
{
  name = 'RaiseSteamCoreMinReviews1788770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE game g
         SET "catalogTier" = 'EXTENDED'
       WHERE g."catalogTier" = 'CORE'
         AND g."deletedAt" IS NULL
         AND COALESCE(
           (
             SELECT s.value
               FROM signal_snapshot s
              WHERE s."gameId" = g.id
                AND s.metric = 'STEAM_REVIEWS'
              ORDER BY s."capturedAt" DESC
              LIMIT 1
           ),
           0
         ) < 5000
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE game g
         SET "catalogTier" = 'CORE'
       WHERE g."catalogTier" = 'EXTENDED'
         AND g."deletedAt" IS NULL
         AND COALESCE(
           (
             SELECT s.value
               FROM signal_snapshot s
              WHERE s."gameId" = g.id
                AND s.metric = 'STEAM_REVIEWS'
              ORDER BY s."capturedAt" DESC
              LIMIT 1
           ),
           0
         ) >= 2500
    `);
  }
}

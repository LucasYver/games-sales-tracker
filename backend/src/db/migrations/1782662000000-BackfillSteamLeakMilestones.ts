import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill milestones from the already-imported `STEAM_PLAYERS_LEAK` signal
 * snapshots, so we don't have to re-run the import script. Each leak signal
 * becomes a PC-region sales milestone (paid games only → a Steam player is a
 * buyer, i.e. ≈ PC copies sold; NOT engagement). Runs in its own transaction,
 * separate from the `ADD VALUE 'STEAM_LEAK'` migration (Postgres forbids using
 * a freshly-added enum value in the same transaction that added it).
 *
 * `NOT EXISTS` makes it idempotent and rejection-aware: a game that already
 * has any STEAM_LEAK milestone (active or admin-rejected) is left untouched.
 */
export class BackfillSteamLeakMilestones1782662000000 implements MigrationInterface {
  name = 'BackfillSteamLeakMilestones1782662000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "milestone" (
        "id", "gameId", "source", "units", "region",
        "confidenceScore", "sourceUrl", "note", "reportedAt", "isEngagement"
      )
      SELECT
        uuid_generate_v4(), s."gameId", 'STEAM_LEAK', s."value", 'PC',
        90, NULL,
        'July 2018 Steam achievement-data leak: unique players who launched the game (Steam/PC). Paid game, so this approximates PC copies sold.',
        s."capturedAt", false
      FROM "signal_snapshot" s
      WHERE s."metric" = 'STEAM_PLAYERS_LEAK'
        AND NOT EXISTS (
          SELECT 1 FROM "milestone" m
          WHERE m."gameId" = s."gameId" AND m."source" = 'STEAM_LEAK'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "milestone" WHERE "source" = 'STEAM_LEAK'`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first group lookups (2026-11-19, 259 games) read the announcement's
 * `clanid` on the store's events endpoint: the group that wrote the event,
 * often the publisher's, not the game's own group. HITMAN got IO
 * Interactive's group (219 members instead of ~190,000). The lookup now reads
 * the event's `clan_steamid`, checked against memberslistxml on 7 games.
 *
 * Forget those lookups so the followers cron redoes them, and drop the
 * follower values written from them that day (the cron writes them again).
 * Scoped to lookups made before 2026-11-20, so it does not depend on when it
 * runs.
 */
export class ResetSteamClanLookups1789070000000 implements MigrationInterface {
  name = 'ResetSteamClanLookups1789070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "signal_snapshot" s
       USING "game_source" gs
       WHERE gs."gameId" = s."gameId"
         AND gs.source = 'STEAM'
         AND gs."steamClanCheckedAt" < '2026-11-20'
         AND s.metric = 'STEAM_FOLLOWERS'
         AND NOT s.synthetic
         AND s."capturedAt" >= '2026-11-19'
         AND s."capturedAt" < '2026-11-20'
    `);
    await queryRunner.query(`
      UPDATE "game_source"
         SET "steamClanId" = NULL, "steamClanCheckedAt" = NULL
       WHERE "steamClanCheckedAt" < '2026-11-20'
    `);
  }

  public async down(): Promise<void> {
    // The wrong lookups are not worth restoring.
  }
}

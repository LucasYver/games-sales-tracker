import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Steam community group of each STEAM source: its member count is the
 * game's followers, read in batches over the Steam client network. The group
 * never changes, so it is looked up once (`steamClanCheckedAt` also marks a
 * lookup that found none, to retry it only after a while).
 */
export class AddGameSourceSteamClan1789060000000 implements MigrationInterface {
  name = 'AddGameSourceSteamClan1789060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_source"
        ADD COLUMN "steamClanId" varchar NULL,
        ADD COLUMN "steamClanCheckedAt" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_source"
        DROP COLUMN "steamClanCheckedAt",
        DROP COLUMN "steamClanId"
    `);
  }
}

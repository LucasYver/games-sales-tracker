import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `Game.steamTags`: the Steam community tags (e.g. "Grand Strategy",
 * "4X", "Roguelike") sourced from SteamSpy. This is the richest
 * gameplay-type signal for the data-driven matcher — much finer than the
 * coarse Steam `genres`. Nullable: populated by ingestion + a backfill
 * script, never hand edited, so existing rows stay valid.
 */
export class AddGameSteamTags1782710000000 implements MigrationInterface {
  name = 'AddGameSteamTags1782710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ADD "steamTags" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "steamTags"`);
  }
}

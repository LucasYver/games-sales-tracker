import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-game switch that hides the public estimate. Turned on for the Call of
 * Duty games run through the Call of Duty HQ launcher (Modern Warfare II
 * onwards): their Steam page records almost no concurrent players and their
 * PlayStation ratings belong to the HQ title shared by the whole series, so
 * no signal measures the game alone.
 */
export class AddGameEstimateHidden1788960000000 implements MigrationInterface {
  name = 'AddGameEstimateHidden1788960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "estimateHidden" boolean NOT NULL DEFAULT false`,
    );
    // Steam apps of the HQ-era games: MW II, Warzone, MW III, BO6, BO7, MW4.
    await queryRunner.query(
      `UPDATE "game" g SET "estimateHidden" = true
       FROM "game_source" s
       WHERE s."gameId" = g.id AND s.source = 'STEAM'
         AND s."externalId" IN ('1962660', '1962663', '2519060', '2933620', '3606480', '4435490')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "estimateHidden"`);
  }
}

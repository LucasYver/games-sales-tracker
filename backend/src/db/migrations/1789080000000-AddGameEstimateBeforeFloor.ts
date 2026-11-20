import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-game switch that lets a game released before 2017 get a public
 * estimate anyway (the floor is `ESTIMATE_MIN_RELEASE`). Off for every game:
 * the admin turns it on game by game.
 */
export class AddGameEstimateBeforeFloor1789080000000 implements MigrationInterface {
  name = 'AddGameEstimateBeforeFloor1789080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD "estimateBeforeFloor" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "estimateBeforeFloor"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The PlayStation Store concepts and Xbox Store products IGDB links to a game
 * (`external_games`). The console store lookup tries them before searching.
 */
export class AddGameIgdbStoreIds1788930000000 implements MigrationInterface {
  name = 'AddGameIgdbStoreIds1788930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ADD "igdbPsConceptIds" text[]`);
    await queryRunner.query(
      `ALTER TABLE "game" ADD "igdbXboxProductIds" text[]`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "igdbXboxProductIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "igdbPsConceptIds"`,
    );
  }
}

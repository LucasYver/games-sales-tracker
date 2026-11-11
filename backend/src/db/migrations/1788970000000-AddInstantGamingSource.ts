import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `game_source` rows that link a game to its Instant Gaming product page,
 * written by `InstantGamingLinksService` from the store's sitemap.
 */
export class AddInstantGamingSource1788970000000 implements MigrationInterface {
  name = 'AddInstantGamingSource1788970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "game_source_source_enum" ADD VALUE IF NOT EXISTS 'INSTANT_GAMING'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; the value is harmless
    // if left in place, so the down migration is a deliberate no-op.
  }
}

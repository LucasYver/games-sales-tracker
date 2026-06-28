import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSteamLeakSalesSource1782661000000 implements MigrationInterface {
  name = 'AddSteamLeakSalesSource1782661000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."milestone_source_enum" ADD VALUE IF NOT EXISTS 'STEAM_LEAK'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating the type and rewriting the milestone.source column.
    // The value is harmless if left in place, so the down migration is a
    // deliberate no-op.
  }
}

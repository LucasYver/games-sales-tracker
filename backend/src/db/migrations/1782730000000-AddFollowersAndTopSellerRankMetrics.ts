import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFollowersAndTopSellerRankMetrics1782730000000
  implements MigrationInterface
{
  name = 'AddFollowersAndTopSellerRankMetrics1782730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_metric_enum" ADD VALUE IF NOT EXISTS 'STEAM_FOLLOWERS'`,
    );
    await queryRunner.query(
      `ALTER TYPE "signal_snapshot_metric_enum" ADD VALUE IF NOT EXISTS 'STEAM_TOPSELLER_RANK'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no safe DROP VALUE for an enum type; removing it would
    // require recreating the type and rewriting every dependent column.
    // The values are harmless if left in place, so the down migration is a
    // deliberate no-op.
  }
}

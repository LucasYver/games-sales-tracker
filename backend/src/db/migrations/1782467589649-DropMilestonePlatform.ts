import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropMilestonePlatform1782467589649 implements MigrationInterface {
  name = 'DropMilestonePlatform1782467589649';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Milestones are worldwide totals only now. Hard-delete every
    // per-platform figure (discrepancies referencing them cascade away via
    // the ON DELETE CASCADE FK) before dropping the column.
    await queryRunner.query(
      `DELETE FROM "milestone" WHERE "platform" <> 'GLOBAL'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_f0b6c6d775f7687e96ae82fcff"`,
    );
    await queryRunner.query(`ALTER TABLE "milestone" DROP COLUMN "platform"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."sales_record_platform_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4ed6a1421524b483f72ff60dd" ON "milestone" ("gameId", "source")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_d4ed6a1421524b483f72ff60dd"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sales_record_platform_enum" AS ENUM('PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE', 'GLOBAL', 'OTHER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone" ADD "platform" "public"."sales_record_platform_enum" NOT NULL DEFAULT 'GLOBAL'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0b6c6d775f7687e96ae82fcff" ON "milestone" ("gameId", "platform", "source")`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the `LIFECYCLE` value to `estimation_method_family_enum` and seed
 * the first time-since-release projection method:
 *   `first-week-extrapolation-pc` (PC only for this iteration).
 *
 * Postgres enum values cannot be added inside the same transaction
 * that depends on them, so we follow TypeORM's canonical "rename old,
 * create new, alter column, drop old" dance. The FK + index on
 * `sales_estimate(methodId)` and the `family` index on
 * `estimation_method` have to be dropped and recreated around the
 * column type swap.
 */
export class AddLifecycleFamilyAndFirstWeekMethod1782219035410
  implements MigrationInterface
{
  name = 'AddLifecycleFamilyAndFirstWeekMethod1782219035410';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP CONSTRAINT "FK_sales_estimate_methodId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_estimation_method_family"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sales_estimate_game_platform_method_at"`,
    );

    await queryRunner.query(
      `ALTER TYPE "public"."estimation_method_family_enum" RENAME TO "estimation_method_family_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_method_family_enum" AS ENUM('BOXLEITER', 'ACHIEVEMENTS', 'LIFECYCLE', 'AGGREGATE', 'MANUAL')`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_method" ALTER COLUMN "family" TYPE "public"."estimation_method_family_enum" USING "family"::"text"::"public"."estimation_method_family_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."estimation_method_family_enum_old"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_estimation_method_family" ON "estimation_method" ("family")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_estimate_game_platform_method_at" ON "sales_estimate" ("gameId", "platform", "methodId", "computedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD CONSTRAINT "FK_sales_estimate_methodId" FOREIGN KEY ("methodId") REFERENCES "estimation_method"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`INSERT INTO "estimation_method"
        ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
      VALUES
        ('first-week-extrapolation-pc',
         'First-week extrapolation PC',
         'Estimates week-1 PC sales from the all-time Steam peak CCU (and reviews captured close to launch when available), then projects to today via a degressive curve bucketed on launch size (2.68× year-1 for > 100k week-1 launches, 3.77× for smaller titles).',
         'LIFECYCLE',
         0.6,
         true,
         false)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "estimation_method" WHERE "code" = 'first-week-extrapolation-pc'`,
    );

    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP CONSTRAINT "FK_sales_estimate_methodId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sales_estimate_game_platform_method_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_estimation_method_family"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."estimation_method_family_enum_old" AS ENUM('BOXLEITER', 'ACHIEVEMENTS', 'AGGREGATE', 'MANUAL')`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_method" ALTER COLUMN "family" TYPE "public"."estimation_method_family_enum_old" USING "family"::"text"::"public"."estimation_method_family_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."estimation_method_family_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."estimation_method_family_enum_old" RENAME TO "estimation_method_family_enum"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_estimation_method_family" ON "estimation_method" ("family")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_estimate_game_platform_method_at" ON "sales_estimate" ("gameId", "platform", "methodId", "computedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD CONSTRAINT "FK_sales_estimate_methodId" FOREIGN KEY ("methodId") REFERENCES "estimation_method"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}

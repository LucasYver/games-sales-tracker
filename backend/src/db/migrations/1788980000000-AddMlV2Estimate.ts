import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Worldwide V2 estimate (`V2EstimateService`, model frozen in `ml2/`):
 *
 *  - seeds the `ml-v2` method, the GLOBAL estimate the site displays. Family
 *    AGGREGATE + `isAggregate`, like `ml-ensemble`: an output of the pipeline,
 *    never an input of `aggregateMethods` (weight 0);
 *  - adds `sales_estimate.estimatedUnits`, the estimate itself. The V2 range is
 *    not always symmetric around it (an anchored estimate never goes below the
 *    published figure), so the figure cannot be rebuilt from low and high.
 *    Null on every other row; 0 on a V2 row means "not estimated".
 */
export class AddMlV2Estimate1788980000000 implements MigrationInterface {
  name = 'AddMlV2Estimate1788980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "estimation_method" ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
       VALUES ($1, $2, $3, 'AGGREGATE', 0, true, true)
       ON CONFLICT ("code") DO NOTHING`,
      [
        'ml-v2',
        'Worldwide V2 estimate (boosting + anchoring)',
        'Gradient-boosted model frozen by ml2/freeze.py, anchored on the last published total of the game when it has one, raised by the console store ratings, floored by a published platform figure. Displayed for every game it estimates; estimatedUnits = 0 means not estimated.',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD COLUMN "estimatedUnits" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sales_estimate" WHERE "methodId" IN (SELECT id FROM "estimation_method" WHERE code = 'ml-v2')`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP COLUMN "estimatedUnits"`,
    );
    await queryRunner.query(
      `DELETE FROM "estimation_method" WHERE code = 'ml-v2'`,
    );
  }
}

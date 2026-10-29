import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Worldwide ML estimate (`MlEstimateService`):
 *
 *  - seeds the `ml-ensemble` method, the GLOBAL estimate of the model chosen
 *    in `ml/` (random forest + ridge). Family AGGREGATE + `isAggregate`: like
 *    `aggregated`, an output of the pipeline, never an input of
 *    `aggregateMethods` (weight 0);
 *  - adds `estimate_snapshot.estimatedTodayUnits`, the single figure the site
 *    displays. The ML range is estimate ÷/× a factor, so its midpoint would
 *    overstate it; existing rows (platform sums) get their midpoint, the
 *    figure they already displayed.
 */
export class AddMlEnsembleEstimate1788840000000 implements MigrationInterface {
  name = 'AddMlEnsembleEstimate1788840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "estimation_method" ("code", "label", "description", "family", "defaultWeight", "isEnabled", "isAggregate")
       VALUES ($1, $2, $3, 'AGGREGATE', 0, true, true)
       ON CONFLICT ("code") DO NOTHING`,
      [
        'ml-ensemble',
        'Worldwide ML estimate (random forest + ridge)',
        'Mean, in log space, of a random forest and a ridge regression trained on real worldwide milestones (ml/freeze.py). Range = estimate ÷/× the factor measured on unseen games. Displayed only for games the platform methods put at 300k+.',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" ADD COLUMN "estimatedTodayUnits" integer`,
    );
    await queryRunner.query(
      `UPDATE "estimate_snapshot"
          SET "estimatedTodayUnits" = ROUND(("estimatedTodayLow"::numeric + "estimatedTodayHigh") / 2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "estimate_snapshot" DROP COLUMN "estimatedTodayUnits"`,
    );
    await queryRunner.query(
      `DELETE FROM "sales_estimate" WHERE "methodId" IN (SELECT id FROM "estimation_method" WHERE code = 'ml-ensemble')`,
    );
    await queryRunner.query(
      `DELETE FROM "estimation_method" WHERE code = 'ml-ensemble'`,
    );
  }
}

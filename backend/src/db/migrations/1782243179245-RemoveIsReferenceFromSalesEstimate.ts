import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reverts `AddIsReferenceToSalesEstimate1782228710396`.
 *
 * The variant-matrix experiment (producing reference rows for every
 * combination of calibration × ccu-intersect × genre axes) was
 * dropped: enumerating all cells on every refresh roughly tripled
 * the estimation CPU cost and persisted 10-15 rows per game per
 * batch with no aggregation benefit (refs were excluded by design).
 *
 * Cleanup order matters: we first delete every existing reference
 * row so dropping the column doesn't leak diagnostic-only rows back
 * into the consensus pool, then drop the column itself.
 */
export class RemoveIsReferenceFromSalesEstimate1782243179245
  implements MigrationInterface
{
  name = 'RemoveIsReferenceFromSalesEstimate1782243179245';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sales_estimate" WHERE "isReference" = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP COLUMN "isReference"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD "isReference" boolean NOT NULL DEFAULT false`,
    );
  }
}

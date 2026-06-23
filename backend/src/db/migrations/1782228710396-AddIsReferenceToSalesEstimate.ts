import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tags every `SalesEstimate` row as either part of the canonical
 * consensus path (`isReference = false`, default) or a side-by-side
 * diagnostic variant (`isReference = true`).
 *
 * Reference rows are produced for every alternative cell of the
 * "variant matrix" — calibration axis, ccu-intersect axis, genre
 * axis — so that the admin UI can show, for the same game and the
 * same platform, both the canonical method (the most-informed one,
 * fed into the `aggregated` consensus) and the alternative paths
 * (excluded from the consensus to avoid double-counting boxleiter
 * with itself).
 *
 * All existing rows are kept as `false` (they were the canonical
 * path at the time of insertion). Subsequent runs of
 * `computeAndStore` will add the reference siblings.
 */
export class AddIsReferenceToSalesEstimate1782228710396
  implements MigrationInterface
{
  name = 'AddIsReferenceToSalesEstimate1782228710396';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD "isReference" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP COLUMN "isReference"`,
    );
  }
}

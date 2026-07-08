import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support for reconstructed PlayStation ratings curves:
 *  - `signal_snapshot.synthetic`: flags rows rebuilt from the Steam-review
 *    curve shape (never fed into any live read).
 *  - `game.psCalibrationReconstructed`: traceability flag set when the PS
 *    Boxleiter multiplier was calibrated off a reconstructed rating.
 *
 * Hand-authored to only the two intended additions — the auto-generated diff
 * pulled in unrelated pre-existing drift (dead reddit columns, enum reorders,
 * index/FK renames) that belongs to other migrations / prod state.
 */
export class AddPsReconstructionSupport1783456310205
  implements MigrationInterface
{
  name = 'AddPsReconstructionSupport1783456310205';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "signal_snapshot" ADD "synthetic" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD "psCalibrationReconstructed" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "psCalibrationReconstructed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "signal_snapshot" DROP COLUMN "synthetic"`,
    );
  }
}

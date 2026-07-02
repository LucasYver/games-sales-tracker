import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the observed `peakCcuRatio` to `reference_profile` — the
 * data-driven replacement for `GenreProfile.peakCcuToWeekOne*`. It is
 * the anchor's week-1 units (week-1 cumulative reviews × reviewsToUnits)
 * over its launch-window peak `STEAM_CONCURRENT`. Nullable: not every
 * anchor has a launch CCU sample. Populated by
 * `ReferenceProfileService.rebuildOne`.
 */
export class AddReferenceProfilePeakCcuRatio1782690000000 implements MigrationInterface {
  name = 'AddReferenceProfilePeakCcuRatio1782690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_profile" ADD "peakCcuRatio" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_profile" DROP COLUMN "peakCcuRatio"`,
    );
  }
}

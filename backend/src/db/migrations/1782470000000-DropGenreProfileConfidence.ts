import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropGenreProfileConfidence1782470000000
  implements MigrationInterface
{
  name = 'DropGenreProfileConfidence1782470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "confidence"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."genre_profile_confidence_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."genre_profile_confidence_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH')`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "confidence" "public"."genre_profile_confidence_enum" NOT NULL DEFAULT 'MEDIUM'`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "confidence" DROP DEFAULT`,
    );
  }
}

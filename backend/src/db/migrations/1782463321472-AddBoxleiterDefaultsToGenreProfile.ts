import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBoxleiterDefaultsToGenreProfile1782463321472
  implements MigrationInterface
{
  name = 'AddBoxleiterDefaultsToGenreProfile1782463321472';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "pcDefaultBoxleiterLow" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "pcDefaultBoxleiterHigh" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "psDefaultBoxleiterLow" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "psDefaultBoxleiterHigh" numeric(5,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "psDefaultBoxleiterHigh"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "psDefaultBoxleiterLow"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "pcDefaultBoxleiterHigh"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "pcDefaultBoxleiterLow"`,
    );
  }
}

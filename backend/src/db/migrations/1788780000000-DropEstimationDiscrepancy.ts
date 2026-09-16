import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropEstimationDiscrepancy1788780000000
  implements MigrationInterface
{
  name = 'DropEstimationDiscrepancy1788780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "estimation_discrepancy"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."estimation_discrepancy_platform_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."estimation_discrepancy_declaredsource_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_discrepancy_platform_enum" AS ENUM('PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE', 'GLOBAL', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."estimation_discrepancy_declaredsource_enum" AS ENUM('OFFICIAL', 'WIKIPEDIA', 'ANNOUNCEMENT', 'MEDIA', 'STEAM_LEAK', 'PLAYSTATION_LEAK')`,
    );
    await queryRunner.query(
      `CREATE TABLE "estimation_discrepancy" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gameId" uuid NOT NULL, "platform" "public"."estimation_discrepancy_platform_enum" NOT NULL, "milestoneId" uuid NOT NULL, "declaredUnits" integer NOT NULL, "declaredSource" "public"."estimation_discrepancy_declaredsource_enum" NOT NULL, "declaredAt" TIMESTAMP, "priorEstimateLow" integer NOT NULL, "priorEstimateHigh" integer NOT NULL, "priorEstimateAt" TIMESTAMP NOT NULL, "ratio" double precision NOT NULL, "detectedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_estimation_discrepancy" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_estimation_discrepancy_game_detected" ON "estimation_discrepancy" ("gameId", "detectedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a2883d2c2df80977707581f131" ON "estimation_discrepancy" ("milestoneId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_discrepancy" ADD CONSTRAINT "FK_estimation_discrepancy_game" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "estimation_discrepancy" ADD CONSTRAINT "FK_a2883d2c2df80977707581f131c" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `reference_profile`, the per-game observed behavioural vector
 * consumed by the data-driven similarity matcher (Forme C). Every field
 * is measured (curve checkpoints, reviews→units ratio, per-platform
 * proxy shares, scale, quality score) — no hand-typed genre stays on
 * this row. Populated on demand by `ReferenceProfileService`.
 *
 * One row per game (unique `gameId`). The FK cascades so a game
 * deletion cleans up its anchor automatically.
 */
export class AddReferenceProfile1782670000000 implements MigrationInterface {
  name = 'AddReferenceProfile1782670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reference_profile" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "gameId" uuid NOT NULL,
         "curveS1" double precision,
         "curveM1" double precision,
         "curveM3" double precision,
         "curveM6" double precision,
         "curveA1" double precision,
         "curveA2" double precision,
         "reviewsToUnits" double precision,
         "platformSharePc" double precision,
         "platformSharePs" double precision,
         "platformShareXbox" double precision,
         "platformShareSwitch" double precision,
         "scaleUnits" bigint,
         "qualityScore" double precision NOT NULL,
         "observedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_reference_profile" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_reference_profile_gameId" ON "reference_profile" ("gameId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reference_profile"
         ADD CONSTRAINT "FK_reference_profile_gameId"
         FOREIGN KEY ("gameId") REFERENCES "game"("id")
         ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_profile" DROP CONSTRAINT "FK_reference_profile_gameId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UX_reference_profile_gameId"`,
    );
    await queryRunner.query(`DROP TABLE "reference_profile"`);
  }
}

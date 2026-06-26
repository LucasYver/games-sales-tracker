import { MigrationInterface, QueryRunner } from "typeorm";

export class DropConfidenceFromSalesEstimate1782490393633 implements MigrationInterface {
    name = 'DropConfidenceFromSalesEstimate1782490393633'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "milestone" DROP CONSTRAINT "FK_7021a16222a6ee4a0dd35beb69e"`);
        await queryRunner.query(`ALTER TABLE "game" DROP CONSTRAINT "FK_game_genreProfileId"`);
        await queryRunner.query(`ALTER TABLE "estimation_discrepancy" DROP CONSTRAINT "FK_a0322c2c2a3c99cdb1724fbab43"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_61cf3345c98544603e3c99dd05"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0322c2c2a3c99cdb1724fbab4"`);
        await queryRunner.query(`ALTER TABLE "sales_estimate" DROP COLUMN "confidence"`);
        await queryRunner.query(`DROP TYPE "public"."sales_estimate_confidence_enum"`);
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" DROP COLUMN "pureBreakdown"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4ed6a1421524b483f72ff60dd"`);
        await queryRunner.query(`ALTER TYPE "public"."sales_record_source_enum" RENAME TO "sales_record_source_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."milestone_source_enum" AS ENUM('OFFICIAL', 'WIKIPEDIA', 'ANNOUNCEMENT', 'MEDIA')`);
        await queryRunner.query(`ALTER TABLE "milestone" ALTER COLUMN "source" TYPE "public"."milestone_source_enum" USING "source"::"text"::"public"."milestone_source_enum"`);
        await queryRunner.query(`DROP TYPE "public"."sales_record_source_enum_old"`);
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" ALTER COLUMN "reconciliation" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`CREATE INDEX "IDX_7603f5c293debe8dfe7477f29e" ON "milestone" ("rejectedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_d4ed6a1421524b483f72ff60dd" ON "milestone" ("gameId", "source") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a2883d2c2df80977707581f131" ON "estimation_discrepancy" ("milestoneId") `);
        await queryRunner.query(`ALTER TABLE "milestone" ADD CONSTRAINT "FK_cd199438d36d97aa1b0d1b09555" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game" ADD CONSTRAINT "FK_1bdc9787f4cc73aaece71cb0dc7" FOREIGN KEY ("genreProfileId") REFERENCES "genre_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "estimation_discrepancy" ADD CONSTRAINT "FK_a2883d2c2df80977707581f131c" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "estimation_discrepancy" DROP CONSTRAINT "FK_a2883d2c2df80977707581f131c"`);
        await queryRunner.query(`ALTER TABLE "game" DROP CONSTRAINT "FK_1bdc9787f4cc73aaece71cb0dc7"`);
        await queryRunner.query(`ALTER TABLE "milestone" DROP CONSTRAINT "FK_cd199438d36d97aa1b0d1b09555"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a2883d2c2df80977707581f131"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4ed6a1421524b483f72ff60dd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7603f5c293debe8dfe7477f29e"`);
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" ALTER COLUMN "reconciliation" SET DEFAULT '[]'`);
        await queryRunner.query(`CREATE TYPE "public"."sales_record_source_enum_old" AS ENUM('ANNOUNCEMENT', 'MEDIA', 'OFFICIAL', 'WIKIPEDIA')`);
        await queryRunner.query(`ALTER TABLE "milestone" ALTER COLUMN "source" TYPE "public"."sales_record_source_enum_old" USING "source"::"text"::"public"."sales_record_source_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."milestone_source_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."sales_record_source_enum_old" RENAME TO "sales_record_source_enum"`);
        await queryRunner.query(`CREATE INDEX "IDX_d4ed6a1421524b483f72ff60dd" ON "milestone" ("gameId", "source") `);
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" ADD "pureBreakdown" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`CREATE TYPE "public"."sales_estimate_confidence_enum" AS ENUM('HIGH', 'LOW', 'MEDIUM')`);
        await queryRunner.query(`ALTER TABLE "sales_estimate" ADD "confidence" "public"."sales_estimate_confidence_enum" NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a0322c2c2a3c99cdb1724fbab4" ON "estimation_discrepancy" ("milestoneId") `);
        await queryRunner.query(`CREATE INDEX "IDX_61cf3345c98544603e3c99dd05" ON "milestone" ("rejectedAt") `);
        await queryRunner.query(`ALTER TABLE "estimation_discrepancy" ADD CONSTRAINT "FK_a0322c2c2a3c99cdb1724fbab43" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game" ADD CONSTRAINT "FK_game_genreProfileId" FOREIGN KEY ("genreProfileId") REFERENCES "genre_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "milestone" ADD CONSTRAINT "FK_7021a16222a6ee4a0dd35beb69e" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}

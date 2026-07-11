import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMilestoneAudit1783775191521 implements MigrationInterface {
  name = 'AddMilestoneAudit1783775191521';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."milestone_audit_verdict_enum" AS ENUM('OK', 'FIX', 'REJECT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."milestone_audit_proposedplatform_enum" AS ENUM('PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE', 'GLOBAL', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."milestone_audit_status_enum" AS ENUM('PENDING', 'AUTO_APPLIED', 'APPLIED', 'DISMISSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "milestone_audit" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "milestoneId" uuid NOT NULL, "gameId" uuid NOT NULL, "verdict" "public"."milestone_audit_verdict_enum" NOT NULL, "confidence" integer NOT NULL, "proposedPlatform" "public"."milestone_audit_proposedplatform_enum", "proposedReportedAt" TIMESTAMP WITH TIME ZONE, "proposedUnits" integer, "proposedIsEngagement" boolean, "ruleFlags" jsonb, "reasons" jsonb, "status" "public"."milestone_audit_status_enum" NOT NULL DEFAULT 'PENDING', "llmUsed" boolean NOT NULL DEFAULT false, "fingerprint" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "auditedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5e18a3492ea9113ae784cac5013" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_461bdecf5208e924d94b9a8245" ON "milestone_audit" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5f9a6ee8b35b073632bc505d53" ON "milestone_audit" ("verdict") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f5abea3c2d0bb5370a84162533" ON "milestone_audit" ("milestoneId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_audit" ADD CONSTRAINT "FK_f5abea3c2d0bb5370a84162533b" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "milestone_audit" DROP CONSTRAINT "FK_f5abea3c2d0bb5370a84162533b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5abea3c2d0bb5370a84162533"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5f9a6ee8b35b073632bc505d53"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_461bdecf5208e924d94b9a8245"`,
    );
    await queryRunner.query(`DROP TABLE "milestone_audit"`);
    await queryRunner.query(`DROP TYPE "public"."milestone_audit_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."milestone_audit_proposedplatform_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."milestone_audit_verdict_enum"`,
    );
  }
}

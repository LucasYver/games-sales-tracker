import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminUser1788800000000 implements MigrationInterface {
  name = 'AddAdminUser1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_user" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "lastLoginAt" TIMESTAMP WITH TIME ZONE,
        "disabledAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_admin_user_email" UNIQUE ("email"),
        CONSTRAINT "PK_admin_user" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admin_user"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderCooldown1788810000000 implements MigrationInterface {
  name = 'AddProviderCooldown1788810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "provider_cooldown" (
        "provider" character varying(64) NOT NULL,
        "disabledUntil" TIMESTAMP WITH TIME ZONE NOT NULL,
        "reason" text,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_provider_cooldown" PRIMARY KEY ("provider")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "provider_cooldown"`);
  }
}

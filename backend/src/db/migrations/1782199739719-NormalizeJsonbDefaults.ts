import { MigrationInterface, QueryRunner } from "typeorm";

export class NormalizeJsonbDefaults1782199739719 implements MigrationInterface {
    name = 'NormalizeJsonbDefaults1782199739719'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" ALTER COLUMN "reconciliation" SET DEFAULT '[]'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "estimate_snapshot" ALTER COLUMN "reconciliation" SET DEFAULT '[]'`);
    }

}

import { MigrationInterface, QueryRunner } from "typeorm";

export class ReplaceLauncherProfileWithSteamShare1782636884692 implements MigrationInterface {
    name = 'ReplaceLauncherProfileWithSteamShare1782636884692'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "publisher" ADD "steamSharePctLow" double precision NOT NULL DEFAULT '100'`);
        await queryRunner.query(`ALTER TABLE "publisher" ADD "steamSharePctHigh" double precision NOT NULL DEFAULT '100'`);
        // Preserve previously curated profiles: map the dropped enum to the
        // equivalent Steam-share range (STEAM_DOMINANT keeps the 100/100 default).
        await queryRunner.query(`UPDATE "publisher" SET "steamSharePctLow" = 50, "steamSharePctHigh" = 71 WHERE "launcherProfile" = 'MULTI_STORE'`);
        await queryRunner.query(`UPDATE "publisher" SET "steamSharePctLow" = 14, "steamSharePctHigh" = 29 WHERE "launcherProfile" = 'LAUNCHER_PRIMARY'`);
        await queryRunner.query(`ALTER TABLE "publisher" DROP COLUMN "launcherProfile"`);
        await queryRunner.query(`DROP TYPE "public"."publisher_launcherprofile_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."publisher_launcherprofile_enum" AS ENUM('LAUNCHER_PRIMARY', 'MULTI_STORE', 'STEAM_DOMINANT')`);
        await queryRunner.query(`ALTER TABLE "publisher" ADD "launcherProfile" "public"."publisher_launcherprofile_enum" NOT NULL DEFAULT 'STEAM_DOMINANT'`);
        await queryRunner.query(`UPDATE "publisher" SET "launcherProfile" = 'LAUNCHER_PRIMARY' WHERE ("steamSharePctLow" + "steamSharePctHigh") / 2 < 35`);
        await queryRunner.query(`UPDATE "publisher" SET "launcherProfile" = 'MULTI_STORE' WHERE ("steamSharePctLow" + "steamSharePctHigh") / 2 >= 35 AND ("steamSharePctLow" + "steamSharePctHigh") / 2 < 85`);
        await queryRunner.query(`ALTER TABLE "publisher" DROP COLUMN "steamSharePctHigh"`);
        await queryRunner.query(`ALTER TABLE "publisher" DROP COLUMN "steamSharePctLow"`);
    }

}

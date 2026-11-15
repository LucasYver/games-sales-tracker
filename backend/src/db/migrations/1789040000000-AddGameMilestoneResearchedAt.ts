import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a game's sales figures were last researched by hand
 * (`ml/research_figures.py apply --commit`). The milestone harvest cron counts
 * it like one of its own harvests, so it does not re-search a game days after
 * a manual pass.
 */
export class AddGameMilestoneResearchedAt1789040000000 implements MigrationInterface {
  name = 'AddGameMilestoneResearchedAt1789040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "lastMilestoneResearchedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP COLUMN "lastMilestoneResearchedAt"`,
    );
  }
}

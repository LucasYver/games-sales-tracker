import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-game manual override of the genre profile used by the
 * estimation model (`game.genreProfileId` → `genre_profile`), and seeds
 * a new `streamer-buzz` profile.
 *
 * Motivation: some titles are commercial outliers no IGDB genre
 * captures — a casual game that goes viral via streamers a week after
 * launch sells far more than its genre's peak-CCU→sales ratio implies.
 * The override lets an admin pin such a game to a dedicated profile.
 *
 * The `streamer-buzz` profile encodes that dynamic: viral hits churn
 * hard (huge install base relative to concurrent players) so the
 * peak-CCU→week-1 ratio is high (6–12×) and the year-1 multiplier is
 * large (6.0).
 */
export class AddGameGenreProfileOverride1782396500000
  implements MigrationInterface
{
  name = 'AddGameGenreProfileOverride1782396500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "genre_profile"
         ("slug", "name", "description", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence", "lifecycleIndex", "firstWeekToYearOneMultiplier", "year2Retention", "lifecycleDriver", "peakCcuToWeekOneLow", "peakCcuToWeekOneHigh")
       VALUES ('streamer-buzz', 'Streamer buzz / viral', 'Outlier viral hit (manual override): huge sales relative to concurrent players due to heavy churn.', 0.58, 0.147, 0.126, 0.147, 'équilibré', 'LOW', 2.5, 6.0, 'MEDIUM_HIGH'::"public"."genre_profile_year2retention_enum", 'Pic viral streamer (override manuel)', 6.0, 12.0)
       ON CONFLICT (slug) DO NOTHING`,
    );

    await queryRunner.query(
      `ALTER TABLE "game" ADD "genreProfileId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "game" ADD CONSTRAINT "FK_game_genreProfileId" FOREIGN KEY ("genreProfileId") REFERENCES "genre_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game" DROP CONSTRAINT "FK_game_genreProfileId"`,
    );
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "genreProfileId"`);
    await queryRunner.query(
      `DELETE FROM "genre_profile" WHERE slug = 'streamer-buzz'`,
    );
  }
}

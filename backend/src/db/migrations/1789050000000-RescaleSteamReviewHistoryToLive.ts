import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Put the imported Steam review history (before 2026-09-01) on the same scale
 * as the live daily totals, which are the source of truth.
 *
 * The history comes from Steam's `appreviewhistogram`, which only counts
 * reviews from Steam purchases. The live total (`GetAppReviews`,
 * `purchase_type: 1`) also counts reviews from activated keys: bundles,
 * giveaways, press and retail keys. `backfillReviewsFromHistogram` rescales the
 * history to the live total, but skipped it whenever the histogram ran past
 * 2026-09-01, so for ~3,800 games the series jumps when the daily cron takes
 * over (median ×1.14, some ×0.7 to ×50). Checked on 72 games against Steam:
 * histogram ≈ Steam-purchase reviews, jump ≈ all-purchase ÷ histogram.
 *
 * Per game, factor = live value expected on the last history day ÷ last
 * history value:
 *  - last history point: a monthly bucket whose total runs to the end of its
 *    month (capped at 2026-09-01);
 *  - expected live value on that day: first live point after 2026-09-01, minus
 *    the game's own live pace (first live point → 28 days later) over the days
 *    in between, so real new reviews are not mistaken for keys.
 * Every real STEAM_REVIEWS row before 2026-09-01 is multiplied by it: the curve
 * keeps its shape and meets the live series. Assumes the key share is the same
 * at every date, which smooths out a bundle that landed at a precise month.
 *
 * Skipped: history already on the live scale (factor within 2%), a seam that is
 * not history→live (last point before 2026-07, first live point after
 * 2026-10, or less than 7 days apart: daily cron on both sides), an empty
 * history (last value 0), and the few games linked to more than one Steam app.
 *
 * The stored console curves of these games are rebuilt by the store-ratings
 * cron (their CONSOLE_CURVE state is forgotten), since their shape comes from
 * this history.
 *
 * Each factor is kept in `steam_review_rescale` for audit and for `down`. The
 * query only finds a seam that is still there, so the result does not depend
 * on when it runs.
 */
export class RescaleSteamReviewHistoryToLive1789050000000 implements MigrationInterface {
  name = 'RescaleSteamReviewHistoryToLive1789050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "steam_review_rescale" (
        "gameId" uuid PRIMARY KEY,
        "factor" double precision NOT NULL,
        "preAt" timestamptz NOT NULL,
        "preValue" integer NOT NULL,
        "postAt" timestamptz NOT NULL,
        "postValue" integer NOT NULL,
        "appliedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "steam_review_rescale"
        ("gameId", "factor", "preAt", "preValue", "postAt", "postValue")
      WITH seam AS (
        SELECT g."gameId",
               pre."capturedAt" AS "preAt", pre.value AS "preValue",
               post."capturedAt" AS "postAt", post.value AS "postValue",
               later."capturedAt" AS "laterAt", later.value AS "laterValue"
          FROM (SELECT "gameId" FROM "game_source" WHERE source = 'STEAM'
                 GROUP BY "gameId" HAVING COUNT(*) = 1) g
          CROSS JOIN LATERAL (
            SELECT "capturedAt", value FROM "signal_snapshot" r
             WHERE r."gameId" = g."gameId" AND r.metric = 'STEAM_REVIEWS'
               AND NOT r.synthetic AND r."capturedAt" < '2026-09-01'
             ORDER BY "capturedAt" DESC LIMIT 1) pre
          CROSS JOIN LATERAL (
            SELECT "capturedAt", value FROM "signal_snapshot" r
             WHERE r."gameId" = g."gameId" AND r.metric = 'STEAM_REVIEWS'
               AND NOT r.synthetic AND r."capturedAt" >= '2026-09-01'
             ORDER BY "capturedAt" ASC LIMIT 1) post
          LEFT JOIN LATERAL (
            SELECT "capturedAt", value FROM "signal_snapshot" r
             WHERE r."gameId" = g."gameId" AND r.metric = 'STEAM_REVIEWS'
               AND NOT r.synthetic
               AND r."capturedAt" >= post."capturedAt" + interval '28 days'
             ORDER BY "capturedAt" ASC LIMIT 1) later ON true
      ),
      measured AS (
        SELECT s.*,
               LEAST(date_trunc('month', s."preAt") + interval '1 month',
                     timestamptz '2026-09-01') AS "refAt"
          FROM seam s
         WHERE s."preValue" > 0
           AND s."preAt" >= '2026-07-01'
           AND s."postAt" < '2026-10-01'
           AND s."postAt" - s."preAt" >= interval '7 days'
      ),
      factors AS (
        SELECT m.*,
               GREATEST(
                 m."postValue" - COALESCE(
                   (m."laterValue" - m."postValue")
                     * EXTRACT(EPOCH FROM (m."postAt" - m."refAt"))
                     / NULLIF(EXTRACT(EPOCH FROM (m."laterAt" - m."postAt")), 0),
                   0),
                 0)::double precision / m."preValue" AS factor
          FROM measured m
      )
      SELECT "gameId", factor, "preAt", "preValue", "postAt", "postValue"
        FROM factors
       WHERE abs(factor - 1) >= 0.02
    `);

    await queryRunner.query(`
      UPDATE "signal_snapshot" s
         SET value = ROUND(s.value * r.factor)
        FROM "steam_review_rescale" r
       WHERE s."gameId" = r."gameId"
         AND s.metric = 'STEAM_REVIEWS'
         AND NOT s.synthetic
         AND s."capturedAt" < '2026-09-01'
    `);

    await this.forgetConsoleCurves(queryRunner);
  }

  /**
   * The stored PS / Xbox curves (`synthetic = true`) are shaped on the Steam
   * history this migration rescales. Forgetting their CONSOLE_CURVE state lets
   * the store-ratings cron rebuild them; it leaves a curve that did not change
   * as it is.
   */
  private async forgetConsoleCurves(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "game_ingestion_state"
       WHERE pipeline = 'CONSOLE_CURVE'
         AND "gameId" IN (SELECT "gameId" FROM "steam_review_rescale")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rounding makes the way back exact to about one review.
    await queryRunner.query(`
      UPDATE "signal_snapshot" s
         SET value = ROUND(s.value / r.factor)
        FROM "steam_review_rescale" r
       WHERE s."gameId" = r."gameId"
         AND s.metric = 'STEAM_REVIEWS'
         AND NOT s.synthetic
         AND s."capturedAt" < '2026-09-01'
    `);
    await this.forgetConsoleCurves(queryRunner);
    await queryRunner.query(`DROP TABLE "steam_review_rescale"`);
  }
}

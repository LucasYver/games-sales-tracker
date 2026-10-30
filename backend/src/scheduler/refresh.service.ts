import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game, GameRank } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { IngestionStateService } from '../ingestion/ingestion-state.service';
import { RankService } from '../reference-profiles/rank.service';
import { ReferenceProfileService } from '../reference-profiles/reference-profile.service';
import { cycleWindow } from '../ingestion/ingestion-cadence';
import { BlogService } from '../blog/blog.service';
import { AdminMailService } from '../admin/admin-mail.service';
import { isEligibleForAutomaticHarvest } from './harvest-eligibility';
import { isDueForRefresh } from './refresh-interval';

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(GameRank)
    private readonly gameRanks: Repository<GameRank>,
    private readonly ingestion: IngestionService,
    private readonly ingestionState: IngestionStateService,
    private readonly rank: RankService,
    private readonly referenceProfiles: ReferenceProfileService,
    private readonly blog: BlogService,
    private readonly mail: AdminMailService,
  ) {}

  // Wall-clock cap per invocation, with headroom under the 800s Vercel
  // `maxDuration` so the in-flight game can finish (and stamp its ingestion
  // state) before the function is killed mid-run.
  private static readonly RUN_BUDGET_MS = 11 * 60 * 1000;

  /**
   * Steam review counts (Boxleiter input). Reviewer playtime is a separate
   * monthly cron.
   */
  async pollAllSteamReviews() {
    try {
      const result = await this.ingestion.pollAllSteamReviews({
        budgetMs: RefreshService.RUN_BUDGET_MS,
      });
      this.logger.log(
        `Steam reviews poll done: ${result.polled} polled, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Steam reviews poll failed: ${error}`);
    }
  }

  /**
   * Daily email to the admins while the review signal is broken, repeated
   * until it recovers. A separate job so it still fires if the poll cron dies.
   */
  async checkSteamReviewsHealth() {
    try {
      const health = await this.ingestion.steamReviewsHealth();
      if (health.problems.length === 0) {
        this.logger.log('Steam reviews health: ok.');
        return;
      }
      this.logger.error(`Steam reviews health: ${health.problems.join(' ')}`);
      await this.mail.sendSteamReviewsAlert(health);
    } catch (error) {
      this.logger.error(`Steam reviews health check failed: ${error}`);
    }
  }

  async pollAllSteamReviewerPlaytime() {
    try {
      const result = await this.ingestion.pollAllSteamReviewerPlaytime({
        budgetMs: RefreshService.RUN_BUDGET_MS,
      });
      this.logger.log(
        `Steam reviewer playtime poll done: ${result.polled} polled, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Steam reviewer playtime poll failed: ${error}`);
    }
  }

  /** PlayStation/Xbox store ratings for console games. */
  async captureStoreRatings() {
    try {
      const result = await this.ingestion.captureAllStoreRatings({
        budgetMs: RefreshService.RUN_BUDGET_MS,
      });
      this.logger.log(
        `Store ratings done: ${result.scraped} scraped, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Store ratings capture failed: ${error}`);
    }
  }

  /** Exophase + Steam official achievement rarities. */
  async captureAchievements() {
    try {
      const result = await this.ingestion.captureAllAchievements({
        budgetMs: RefreshService.RUN_BUDGET_MS,
      });
      this.logger.log(
        `Achievements done: ${result.scraped} scraped, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Achievements capture failed: ${error}`);
    }
  }

  /** Estimate history rebuild, for games whose signals moved since last run. */
  async rebuildStaleEstimates() {
    try {
      const result = await this.ingestion.rebuildStaleEstimates({
        budgetMs: RefreshService.RUN_BUDGET_MS,
      });
      this.logger.log(
        `Estimate rebuild done: ${result.rebuilt} rebuilt, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Estimate rebuild failed: ${error}`);
    }
  }

  async harvestAllGameMilestones() {
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    const startedAt = Date.now();
    const [games, ranks] = await Promise.all([
      this.games.find({
        where: { isFree: false },
        order: {
          lastMilestoneHarvestedAt: {
            direction: 'ASC',
            nulls: 'FIRST',
          },
        },
      }),
      this.gameRanks.find({
        select: ['gameId', 'recentVelocityPercentile'],
      }),
    ]);
    const recentPercentileByGame = new Map(
      ranks.map((rank) => [rank.gameId, rank.recentVelocityPercentile]),
    );
    const now = new Date();
    const eligible = games.filter((game) => {
      const tierEligible = isEligibleForAutomaticHarvest(
        game.catalogTier,
        recentPercentileByGame.get(game.id),
      );
      return (
        tierEligible &&
        isDueForRefresh(game.releaseDate, game.lastMilestoneHarvestedAt, now)
      );
    });

    this.logger.log(
      `Harvesting up to ${eligible.length} due game(s) of ${games.length}, ` +
        `budget ${RUN_BUDGET_MS / 1000}s.`,
    );

    let processed = 0;
    for (const game of eligible) {
      if (Date.now() - startedAt >= RUN_BUDGET_MS) break;
      try {
        await this.ingestionState.track(game.id, 'MILESTONE_HARVEST', () =>
          this.ingestion.harvestGameMilestones(game.id),
        );
      } catch (error) {
        this.logger.warn(`Harvest failed for game ${game.id}: ${error}`);
      }
      processed += 1;
    }

    this.logger.log(`Harvest complete: ${processed} game(s) processed.`);
  }

  /**
   * Poll live Steam concurrent players for every tracked Steam game on a
   * short cadence (every 30 minutes) so intra-day peaks are captured. This is
   * intentionally separate from the nightly full refresh, which no longer
   * fetches CCU.
   */
  async refreshAllCcu() {
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    try {
      const result = await this.ingestion.pollAllSteamCcu({
        budgetMs: RUN_BUDGET_MS,
      });
      this.logger.log(
        `CCU poll done: ${result.polled} polled, ${result.failed} failed, ` +
          `${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`CCU poll failed: ${error}`);
    }
  }

  /**
   * Capture a daily Steam price point for every tracked Steam game so price
   * changes (sales, permanent drops) accumulate into a time series.
   */
  async captureSteamPrices() {
    try {
      const result = await this.ingestion.captureAllSteamPrices();
      this.logger.log(
        `Price capture done: ${result.captured} captured, ${result.skipped} skipped, ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.warn(`Price capture failed: ${error}`);
    }
  }

  async captureXboxPrices() {
    try {
      const result = await this.ingestion.captureAllXboxPrices();
      this.logger.log(
        `Xbox price capture done: ${result.captured} captured, ${result.skipped} skipped, ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.warn(`Xbox price capture failed: ${error}`);
    }
  }

  async capturePlaystationPrices() {
    try {
      const result = await this.ingestion.captureAllPlaystationPrices();
      this.logger.log(
        `PlayStation price capture done: ${result.captured} captured, ${result.skipped} skipped, ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.warn(`PlayStation price capture failed: ${error}`);
    }
  }

  /**
   * Daily refresh of Steam followers from games-popularity.com. Recent-window
   * only (the multi-year history is seeded once by the backfill script); a
   * wall-clock budget keeps the run under the Vercel `maxDuration`, and
   * stalest-first ordering drains any leftover on the next run.
   */
  async captureGamesPopularity() {
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    try {
      const result = await this.ingestion.syncAllGamesPopularity({
        fullHistory: false,
        budgetMs: RUN_BUDGET_MS,
      });
      this.logger.log(
        `Games-popularity capture done: ${result.processed} game(s), ` +
          `${result.followers} followers, ${result.failed} failed, ` +
          `${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Games-popularity capture failed: ${error}`);
    }
  }

  /**
   * Poll live Twitch viewers for every tracked game during US/EU prime
   * windows only (see vercel.json: every 30 min at 16–03 UTC — EU evening
   * + US East evening; quiet 04–15 UTC skipped). Mirrors the CCU poll but
   * is platform-agnostic. A wall-clock budget keeps the run under the
   * Vercel `maxDuration`, and stalest-first ordering drains leftovers.
   */
  async captureTwitchViewers() {
    const RUN_BUDGET_MS = 11 * 60 * 1000;
    try {
      const result = await this.ingestion.pollAllTwitchViewers({
        budgetMs: RUN_BUDGET_MS,
      });
      this.logger.log(
        `Twitch viewers poll done: ${result.polled} polled, ` +
          `${result.failed} failed, ${result.leftover} left.`,
      );
    } catch (error) {
      this.logger.warn(`Twitch viewers poll failed: ${error}`);
    }
  }

  /**
   * Weekly recompute of the home-grown review-velocity rank over the whole
   * tracked universe → `game_rank`. Read-heavy full recompute; scheduled after
   * the followers/rank capture so it sees fresh review data.
   */
  /**
   * Matcher anchors (`reference_profile`). Rebuilds every game that has (or
   * could have) an anchor when its figures changed since its last attempt
   * (a figure added or rejected), and every one of them once a UTC week, so
   * the matcher never misses a new reference game nor keeps one whose
   * figures were all rejected. Stalest first, within the run budget.
   */
  async rebuildReferenceProfiles() {
    try {
      const startedAt = Date.now();
      const rows = await this.games.query<Array<{ gameId: string }>>(
        `SELECT g.id AS "gameId"
           FROM game g
           LEFT JOIN game_ingestion_state st
             ON st."gameId" = g.id AND st.pipeline = 'REFERENCE_PROFILE'
          WHERE g."deletedAt" IS NULL
            AND (
              EXISTS (SELECT 1 FROM reference_profile rp WHERE rp."gameId" = g.id)
              OR (g."isFree" = false AND (
                EXISTS (SELECT 1 FROM milestone m
                         WHERE m."gameId" = g.id AND m."rejectedAt" IS NULL
                           AND m."isEngagement" = false AND m."reportedAt" IS NOT NULL)
                OR EXISTS (SELECT 1 FROM signal_snapshot s
                            WHERE s."gameId" = g.id AND s.metric = 'STEAM_PLAYERS_LEAK')))
            )
            AND (
              st."lastAttemptAt" IS NULL
              OR st."lastAttemptAt" < $1
              OR EXISTS (SELECT 1 FROM milestone m
                          WHERE m."gameId" = g.id
                            AND (m."capturedAt" > st."lastAttemptAt"
                                 OR m."rejectedAt" > st."lastAttemptAt"))
            )
          ORDER BY st."lastAttemptAt" ASC NULLS FIRST`,
        [cycleWindow('week').startedAt],
      );
      let kept = 0;
      let dropped = 0;
      let failed = 0;
      let attempted = 0;
      for (const { gameId } of rows) {
        if (Date.now() - startedAt >= RefreshService.RUN_BUDGET_MS) break;
        attempted += 1;
        try {
          const profile = await this.ingestionState.track(
            gameId,
            'REFERENCE_PROFILE',
            () => this.referenceProfiles.rebuildOne(gameId),
          );
          if (profile) kept += 1;
          else dropped += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`[anchors] rebuild failed for ${gameId}: ${error}`);
        }
      }
      this.logger.log(
        `Reference profiles done: ${kept} kept, ${dropped} dropped, ` +
          `${failed} failed, ${rows.length - attempted} left.`,
      );
    } catch (error) {
      this.logger.warn(`Reference profiles rebuild failed: ${error}`);
    }
  }

  async recomputeHomegrownRank() {
    try {
      const result = await this.rank.recomputeAll();
      this.logger.log(
        `Home-grown rank recomputed: ${result.charted} charted game(s) ` +
          `over ${result.rankedWeeks} week(s).`,
      );
    } catch (error) {
      this.logger.warn(`Home-grown rank recompute failed: ${error}`);
    }
  }

  /**
   * Sunday: write at most one draft if none is waiting — a refresh of a live
   * article whose figures changed first, else a new article — otherwise
   * remind admins about leftover drafts. Never publishes.
   */
  async generateWeeklyBlogDraft() {
    try {
      const result = await this.blog.runWeeklyDraftJob();
      if (
        (result.action === 'generated' || result.action === 'refreshed') &&
        result.postId
      ) {
        const post = await this.blog.getAdmin(result.postId);
        await this.mail.sendBlogDraftReady(post);
        await this.blog.markReviewEmailSent(post.id);
        this.logger.log(`Blog draft ${result.action} for ${result.gameName}.`);
      } else if (result.action === 'digest') {
        await this.mail.sendBlogDraftDigest(result.drafts);
        this.logger.log(
          `Blog draft skipped — ${result.drafts.length} draft(s) already waiting.`,
        );
      } else {
        this.logger.log(
          `Blog draft skipped${result.reason ? `: ${result.reason}` : '.'}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Weekly blog draft failed: ${error}`);
    }
  }

  /**
   * Nightly catalog discovery via IGDB (popularity-ranked + fresh releases,
   * admitted by IGDB rating or live Steam reviews). Runs at 2 AM, ahead of the
   * 3 AM per-app refresh.
   */
  async discoverNewGames() {
    try {
      const result = await this.ingestion.discoverIgdbGames();
      this.logger.log(
        `IGDB discovery done: ${result.discovered} found, ${result.ingested} ingested, ${result.skipped} skipped.`,
      );
    } catch (error) {
      this.logger.warn(`IGDB discovery failed: ${error}`);
    }
  }
}

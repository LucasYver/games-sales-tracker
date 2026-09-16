import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game, GameRank } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { IngestionStateService } from '../ingestion/ingestion-state.service';
import { RankService } from '../reference-profiles/rank.service';
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
   * Poll live Twitch viewers for every tracked game on a short cadence so
   * intra-day peaks are captured. Mirrors the CCU poll but is platform-
   * agnostic (Twitch viewership exists for console-only games too). A
   * wall-clock budget keeps the run under the Vercel `maxDuration`, and
   * stalest-first ordering drains any leftover on the next run.
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

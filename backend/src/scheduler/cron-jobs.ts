import type { RefreshService } from './refresh.service';

/**
 * Every scheduled job, keyed by the `<name>` in `/api/cron/<name>`.
 * Vercel calls them through `CronController`; the admin dashboard can start
 * them by hand through `AdminCronController`. The schedules live in
 * `vercel.json` only.
 */
export const CRON_JOBS = {
  'steam-reviews': (r) => r.pollAllSteamReviews(),
  'steam-reviews-health': (r) => r.checkSteamReviewsHealth(),
  'steam-reviewer-playtime': (r) => r.pollAllSteamReviewerPlaytime(),
  'reference-profiles': (r) => r.rebuildReferenceProfiles(),
  'estimate-rebuild': (r) => r.rebuildStaleEstimates(),
  'store-ratings': (r) => r.captureStoreRatings(),
  achievements: (r) => r.captureAchievements(),
  'milestone-harvest': (r) => r.harvestAllGameMilestones(),
  'steam-ccu': (r) => r.refreshAllCcu(),
  'twitch-viewers': (r) => r.captureTwitchViewers(),
  'steam-prices': (r) => r.captureSteamPrices(),
  'xbox-prices': (r) => r.captureXboxPrices(),
  'ps-prices': (r) => r.capturePlaystationPrices(),
  'game-discovery': (r) => r.discoverNewGames(),
  'steam-followers': (r) => r.captureGamesPopularity(),
  'game-rank': (r) => r.recomputeHomegrownRank(),
  'blog-draft': (r) => r.generateWeeklyBlogDraft(),
  'blog-news': (r) => r.generateDailyBlogDrafts(),
} satisfies Record<string, (refresh: RefreshService) => Promise<unknown>>;

export type CronJobName = keyof typeof CRON_JOBS;

export function isCronJobName(name: string): name is CronJobName {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, name);
}

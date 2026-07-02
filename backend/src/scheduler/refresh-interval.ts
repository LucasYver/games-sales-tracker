/**
 * Refresh cadence based on a game's age (days since release):
 *   - Unknown release date:                never (returns null)
 *   - Pre-release (date in the future):    every day
 *   - 0 to 180 days:                       every day
 *   - 180 days to 1 year:                  every 7 days
 *   - 1 year to 3 years:                   every 30 days
 *   - 3 years to 5 years:                  every 90 days
 *   - More than 5 years:                   every 180 days
 *
 * Older titles keep a slow cadence rather than stopping: some games still
 * sell meaningfully years after launch (long-tail catalog, sales spikes),
 * so freezing their signals past Y5 would freeze the estimate below reality.
 */
export function getRefreshIntervalDays(
  releaseDate: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!releaseDate) return null;

  const ageDays =
    (now.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < 0) return 1;
  if (ageDays <= 180) return 1;
  if (ageDays <= 365) return 7;
  if (ageDays <= 365 * 3) return 30;
  if (ageDays <= 365 * 5) return 90;
  return 180;
}

export function isDueForRefresh(
  releaseDate: Date | null | undefined,
  lastRefreshedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const interval = getRefreshIntervalDays(releaseDate, now);
  if (interval === null) return false;
  if (!lastRefreshedAt) return true;

  const daysSinceLastRefresh =
    (now.getTime() - lastRefreshedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLastRefresh >= interval;
}

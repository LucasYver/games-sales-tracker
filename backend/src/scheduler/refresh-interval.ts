/**
 * Refresh cadence based on a game's age (days since release):
 *   - Pre-release / unknown release date: every 7 days
 *   - 0 to 180 days:                       every 7 days
 *   - 180 days to 1 year:                  every 14 days
 *   - 1 year to 3 years:                   every 30 days
 *   - 3 years to 5 years:                  every 90 days
 *   - More than 5 years:                   never (returns null)
 */
export function getRefreshIntervalDays(
  releaseDate: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!releaseDate) return 7;

  const ageDays =
    (now.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < 0) return 7;
  if (ageDays <= 180) return 7;
  if (ageDays <= 365) return 14;
  if (ageDays <= 365 * 3) return 30;
  if (ageDays <= 365 * 5) return 90;
  return null;
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

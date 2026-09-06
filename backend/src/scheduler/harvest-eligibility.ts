import { CatalogTier } from '../entities';

export const EXTENDED_HARVEST_PERCENTILE = 0.1;

export function isEligibleForAutomaticHarvest(
  catalogTier: CatalogTier,
  recentVelocityPercentile: number | null | undefined,
): boolean {
  return (
    catalogTier === CatalogTier.CORE ||
    (recentVelocityPercentile !== null &&
      recentVelocityPercentile !== undefined &&
      recentVelocityPercentile <= EXTENDED_HARVEST_PERCENTILE)
  );
}

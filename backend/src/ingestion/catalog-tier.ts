import { CatalogTier } from '../entities';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_CATALOG_MIN_RATING_COUNT,
  IGDB_CORE_MIN_RATING_COUNT,
  STEAM_CATALOG_MIN_REVIEWS,
  STEAM_CORE_MIN_REVIEWS,
} from './discovery.constants';

export function classifyCatalogTier(
  totalRatingCount: number,
  steamReviews: number | null,
  releaseDate: Date | null,
): CatalogTier | null {
  if (releaseDate && releaseDate < DISCOVERY_RELEASE_FLOOR) {
    return totalRatingCount >= IGDB_CORE_MIN_RATING_COUNT
      ? CatalogTier.CORE
      : null;
  }
  if (
    totalRatingCount >= IGDB_CORE_MIN_RATING_COUNT ||
    (steamReviews ?? 0) >= STEAM_CORE_MIN_REVIEWS
  ) {
    return CatalogTier.CORE;
  }
  if (
    totalRatingCount >= IGDB_CATALOG_MIN_RATING_COUNT ||
    (steamReviews ?? 0) >= STEAM_CATALOG_MIN_REVIEWS
  ) {
    return CatalogTier.EXTENDED;
  }
  return null;
}

export function promoteCatalogTier(
  currentTier: CatalogTier,
  classifiedTier: CatalogTier | null,
): CatalogTier {
  return currentTier === CatalogTier.CORE || classifiedTier !== CatalogTier.CORE
    ? currentTier
    : CatalogTier.CORE;
}

export function needsLiveSteamReviewLookup(
  totalRatingCount: number,
  steamAppId: number | null | undefined,
  releaseDate: Date | null,
): boolean {
  if (!steamAppId) return false;
  if (releaseDate && releaseDate < DISCOVERY_RELEASE_FLOOR) return false;
  return totalRatingCount < IGDB_CATALOG_MIN_RATING_COUNT;
}

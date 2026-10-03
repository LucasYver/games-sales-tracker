import { CatalogTier } from '../entities';
import {
  DISCOVERY_RELEASE_FLOOR,
  IGDB_CATALOG_MIN_RATING_COUNT,
  IGDB_CORE_MIN_RATING_COUNT,
  STEAM_CATALOG_MIN_REVIEWS,
  STEAM_CORE_MIN_REVIEWS,
  UPCOMING_WINDOW_DAYS,
} from './discovery.constants';

const DAY_MS = 24 * 3600 * 1000;

function isUpcomingRelease(
  releaseDate: Date | null,
  now = new Date(),
): boolean {
  if (!releaseDate) return false;
  const releaseMs = releaseDate.getTime();
  const nowMs = now.getTime();
  return (
    releaseMs >= nowMs && releaseMs <= nowMs + UPCOMING_WINDOW_DAYS * DAY_MS
  );
}

export function classifyCatalogTier(
  totalRatingCount: number,
  steamReviews: number | null,
  releaseDate: Date | null,
): CatalogTier | null {
  if (releaseDate && releaseDate < DISCOVERY_RELEASE_FLOOR) {
    return null;
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
  if (isUpcomingRelease(releaseDate)) return CatalogTier.EXTENDED;
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
  if (isUpcomingRelease(releaseDate)) return false;
  return totalRatingCount < IGDB_CATALOG_MIN_RATING_COUNT;
}

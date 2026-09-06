// Catalog discovery is driven by IGDB (the only source that can rank games by
// cross-platform popularity and filter by release date / platform), with Steam
// used per-app as a fast-moving admission signal for very fresh releases that
// IGDB hasn't accumulated ratings for yet.

export const IGDB_CATALOG_MIN_RATING_COUNT = 20;
export const IGDB_CORE_MIN_RATING_COUNT = 80;

// Pre-2012 games are only admitted when they are landmark titles — i.e. they
// cleared a much higher IGDB rating bar (Skyrim, GTA IV, Mass Effect 2…).
// Everything else before this date is ignored as not worth tracking.
export const IGDB_PRE_FLOOR_MIN_RATING_COUNT = 500;

// Release-date floor: nothing before this is tracked unless it clears the
// pre-floor landmark threshold above.
export const DISCOVERY_RELEASE_FLOOR = new Date('2012-01-01T00:00:00Z');

// A fresh release with few IGDB ratings is still admitted when its live Steam
// review count is high — Steam ratings move far faster than IGDB's right after
// launch.
export const STEAM_CATALOG_MIN_REVIEWS = 500;
export const STEAM_CORE_MIN_REVIEWS = 2500;

// How far back the "recent releases" discovery query looks. These candidates
// skip the IGDB rating bar and are admitted via the Steam review signal.
export const RECENT_WINDOW_DAYS = 180;

// IGDB platform ids we track. Switch / mobile are intentionally excluded: we
// have no reliable sales signal for them.
//   6   PC (Microsoft Windows)
//   9   PlayStation 3
//   48  PlayStation 4
//   167 PlayStation 5
//   12  Xbox 360
//   49  Xbox One
//   169 Xbox Series X|S
export const IGDB_PLATFORM_IDS = [6, 9, 48, 167, 12, 49, 169];

// Pagination / volume guards for the IGDB discovery queries.
export const IGDB_DISCOVERY_PAGE_SIZE = 500;
export const IGDB_DISCOVERY_MAX_PAGES = 12;
export const IGDB_RECENT_LIMIT = 300;

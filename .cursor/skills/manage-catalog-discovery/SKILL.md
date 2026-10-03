---
name: manage-catalog-discovery
description: >-
  Change which games game-sales-tracker admits or promotes in the catalog.
  Use when editing discovery thresholds, IGDB or Steam review floors, CORE
  vs EXTENDED, the release floor, upcoming window, or discoverIgdbGames.
  Keeps catalog-tier.ts and discovery.constants.ts aligned and warns about
  cron volume.
---

# Manage catalog discovery

Thresholds live only in `backend/src/ingestion/discovery.constants.ts`.
Admission lives in `classifyCatalogTier`, `promoteCatalogTier`, and
`needsLiveSteamReviewLookup` (`ingestion/catalog-tier.ts`). The nightly
job is `IngestionService.discoverIgdbGames`, cron `/api/cron/game-discovery`.

Do not copy the numbers into `ARCHITECTURE.md`.

## What discovery does

IGDB lists candidates. The job then:

1. Skips an IGDB id or Steam app already stored. Soft-deleted games are
   loaded (`withDeleted`) so they are not inserted again.
2. Promotes `EXTENDED` → `CORE` when the new classification is `CORE`.
   Never demotes.
3. Inserts a stub at the classified tier. It does **not** poll reviews,
   CCU, ratings, or estimates. Later crons do that.
4. Writes `game_ingestion_state` pipeline `DISCOVERY` for the new stub only.
5. Backfills a bounded number of missing source links (`LINK_BACKFILL_LIMIT`).

Free-to-play is rejected later, on Steam ingest (`isFree`), not by the
IGDB rating bar.

## Tier rules

`classifyCatalogTier` returns `null` (do not track) when
`releaseDate < DISCOVERY_RELEASE_FLOOR` (2012-01-01).

Otherwise, first match wins:

| Tier | Condition |
| --- | --- |
| `CORE` | IGDB `total_rating_count >= IGDB_CORE_MIN_RATING_COUNT` (80) **or** Steam reviews `>= STEAM_CORE_MIN_REVIEWS` (5000) |
| `EXTENDED` | IGDB count `>= IGDB_CATALOG_MIN_RATING_COUNT` (5) **or** Steam reviews `>= STEAM_CATALOG_MIN_REVIEWS` (500) **or** release is inside `UPCOMING_WINDOW_DAYS` (90) and still in the future |
| drop | anything else |

A live Steam review lookup is paid only when
`needsLiveSteamReviewLookup` is true: Steam app present, release on or
after the floor, not upcoming, and IGDB count **below** the catalog
minimum. Do not call Steam for the whole candidate page.

Platforms are `IGDB_PLATFORM_IDS` (PC, PS3/4/5, Xbox 360/One/Series).
Switch and mobile stay excluded.

## Before changing a threshold

State the blast radius:

- Lower floors admit more games into **every** signal cron, not just discovery.
- `CORE` vs `EXTENDED` changes milestone harvest
  (`isEligibleForAutomaticHarvest`). Extended games are harvested only
  when `recentVelocityPercentile <= 0.1`.
- Upcoming games have no reviews yet. Admitting them without the upcoming
  exception makes `classifyCatalogTier` return null.
- `IGDB_DISCOVERY_PAGE_SIZE`, `IGDB_DISCOVERY_MAX_PAGES`,
  `IGDB_RECENT_LIMIT`, and `IGDB_UPCOMING_LIMIT` cap IGDB volume. Raising
  them can exceed the nightly window. Discovery does not use the
  11-minute per-game budget the same way signal polls do; it still must
  finish inside `maxDuration` 800s.

Ask before widening admission. A one-line constant change is a catalog
policy change.

## Check

- New game under the floor is skipped.
- Existing extended game crossing the core bar is promoted, not duplicated.
- A deleted game with the same IGDB id is not reinserted.
- A sub-threshold fresh Steam hit is admitted only after the live review lookup.
- No signal snapshots are written by the discovery pass itself.

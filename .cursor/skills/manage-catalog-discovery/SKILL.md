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

After discovery, the same cron re-reads IGDB for the games checked longest
ago (`IgdbRefreshService.refreshFromIgdb`, batches of 500 ids):

- series (`seriesSlug`, see `games/game-series.ts`), for the public pages.
- credited developer and publisher, written to `developer` / `publisher`
  (`resolveCompanies` in `games/game-companies.ts`): the one value the public
  pages, the matcher, the ML and the blog read. Order: an admin correction,
  else IGDB's credit, else the Steam store name kept in `steamDeveloper` /
  `steamPublisher`.
- release dates, for games not launched yet or with no date only
  (`games/release-date-refresh.ts`): `releaseDate` and the per-platform rows.
  A released game and an admin-set date are never moved.
- console store links from IGDB `external_games` (`syncStoreIds`, one
  request per 500 games): PlayStation Store concept ids in `igdbPsConceptIds`
  and Xbox Store product ids in `igdbXboxProductIds`, which the store lookup
  tries before searching (skill `console-store-matching`), plus the Epic and
  GOG pages (`igdbEpicUrl`, `igdbGogUrl`) and Game Pass cloud presence
  (`igdbGamePassCloud`).
- release type (`gameType`), parent game (`igdbParentGameId` / `Name`, read
  back to list a game's remakes) and game modes (`gameModes`), in the same
  request as the series; time to beat (`timeToBeat`, `syncTimeToBeat`, one
  request per 500 games). See `games/igdb-facts.ts`. Display only: nothing
  here feeds the matcher or the ML.

Last, the cron links games to their Instant Gaming page
(`InstantGamingLinksService.sync`, rules in `ingestion/instant-gaming-match.ts`).
It reads the store's public product sitemap (about 23,000 products, three
GETs) and keeps one `game_source` INSTANT_GAMING row per matched game, whole
catalog each night, so a game discovered tonight gets its link the same run:

- exact title only, after stripping the platform, store and region words of
  the product slug: an edition, DLC or sequel never links;
- a year in the store's title (`resident-evil-4-2023`) is matched against the
  release year; without one, two catalog games with the same name get none;
- region-locked keys (US, Latin America, Turkey, one country) and products on
  a platform the game lacks are dropped; free games get no link;
- Steam key first, then other PC launchers, Xbox, PlayStation, Switch;
- a sitemap under 10,000 products aborts the sync, so a broken page never
  deletes good links.

The front adds the affiliate code and the visitor's language
(`frontend/src/lib/affiliate.ts`) and sends each click to Vercel Analytics as
`instant_gaming_click` (`components/InstantGamingLink.tsx`). The same pass runs
by hand with `npm run sync:instant-gaming` (backend/).

Free-to-play is rejected later, on Steam ingest (`isFree`), not by the
IGDB rating bar.

## Editions are the base game

IGDB gives each commercial edition ("Deluxe Edition", "GOTY Edition") its own
record, with `game_type = 0` like a main game, pointing at the base game
through `version_parent`. One game, one catalog entry:

- discovery queries filter `version_parent = null`;
- `IgdbClient` lookups (`findBySteamAppId`, `findById`, `findBySlug`,
  `searchGames`, `findByName`) return the base game, with `editionOf` set to
  the matched edition's id;
- on Steam ingest, an edition's own Steam app is attached to the base game
  only when that game has no Steam app yet. Otherwise it is skipped.

The nightly IGDB refresh (`IgdbRefreshService.syncEditions`, one request per
500 games) lists each game's editions in `game_edition`. The game page lists
them in an "Editions" row of its tech sheet, noted as included in the sales, and `GET /games/:slug/redirect` sends the
URL of a soft-deleted edition game to its base game, matched on the edition's
IGDB id.

Remasters (`game_type = 9`) and expanded games (`10`) are separate products and
stay separate. The 2026-11-07 cleanup (`scripts/merge-igdb-editions.ts`) folded
the existing editions into their base games. It skipped five whose base IGDB id
belongs to a game deleted by hand (Persona 5 Royal, Rocket League, Anthem,
GTA V Legacy, Horizon Forbidden West).

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

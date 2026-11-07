---
name: console-store-matching
description: >-
  How game-sales-tracker decides that a PlayStation or Xbox store product is the
  catalog game, and what happens when a stored one is wrong. Use when a game has
  wrong or missing PS or Xbox ratings or prices, when lastError says "PlayStation
  concept not found", when changing store-ratings.client.ts, store-title-match.ts,
  xbox-catalog.client.ts, the PS_STORE or XBOX_STORE game_source link or the
  STORE_RATINGS pipeline, or when the user mentions store title recognition,
  reconnaissance des titres, or a game matched to another one (Wardogs).
---

# Console store matching

A wrong match is worse than no match: another game's ratings feed the estimate.
So a store product is accepted only on proof, and a stored one is checked again on
every pass.

## Where it lives

| What | Where |
| ---- | ----- |
| The decision (pure functions, both stores) | `backend/src/ingestion/store-title-match.ts` |
| Finding and reading store products | `backend/src/ingestion/store-ratings.client.ts` |
| Xbox catalog fields, release date included | `backend/src/ingestion/xbox-catalog.client.ts` |
| Saving, and removing a wrong product | `scrapeStoreRatings`, `forgetWrongStoreProduct` in `ingestion.service.ts` |
| Store ids IGDB links to a game | `IgdbClient.fetchStoreIds`, written nightly by `IgdbRefreshService.syncStoreIds` to `game.igdbPsConceptIds` / `igdbXboxProductIds` |

## How a product is accepted

Both titles become tokens: accents, ™ ® and platform names are dropped ("for PS5",
"Xbox Series X|S", "(PC)"), and roman numerals become digits, so "Alan Wake II"
equals "Alan Wake 2". Then `storeTitleRelation` gives one of four answers:

| Relation | Meaning | Accepted? |
| -------- | ------- | --------- |
| `exact` | Same tokens, also across spacing ("WarDogs" / "War Dogs") | Yes |
| `edition` | The extra words only name a packaging, a remaster or a Game Preview | Yes |
| `subtitle` | One title is the other plus other words | Only if the store release is within 45 days of the game's first, PlayStation or Xbox release date |
| `none` | Not a prefix, the extra words open with a number (a sequel), or they contain demo, beta, trial, artbook or soundtrack | No |

Examples:

- `Wardogs` / `WarDogs: Red's Return`: subtitle, 2021 against 2026, rejected.
- `Grand Theft Auto V` / `Grand Theft Auto VI`: not a prefix once numerals are
  digits, rejected.
- `Vampire Crawlers` / `Vampire Crawlers Demo`: rejected whatever the date.
- `RemiLore: Lost Girl in the Lands of Lore` / `RemiLore`: subtitle, same date,
  accepted.
- `The Witcher 3: Wild Hunt` / `... — Remastered`: edition, accepted.
- `Phasmophobia` / `Phasmophobia (Game Preview)`: edition, accepted.

Choices to keep:

- A remaster counts as the same game, because the store often sells only that
  listing, with the original's ratings. VR versions do not count.
- The store may name its edition with up to two free words ("Zombies Chronicles
  Edition"). A catalog title may add only one ("Jotunn Edition"), otherwise
  "Need for Speed Rivals: Complete Edition" would match "Need for Speed".
- A lone year on the catalog title ("Risk of Rain (2013)") is a `subtitle`, so the
  date decides. On the store title it counts as a sequel number, which keeps
  `Resident Evil 4` away from `resident evil 4 (2005)`.
- Date never overrides an `exact` title. Catalog dates are often a later PC port,
  so a large gap on an exact title is normal.
- Xbox release dates above year 2100 are placeholders (9998-12-30 on Game Preview)
  and read as no date.

## How a product is found

For games with no stored product, or whose stored one was rejected:

- **IGDB first, both stores:** the products IGDB lists for the game in
  `external_games` (source 36 = PlayStation Store US, uid = concept id;
  source 11 = Microsoft, uid = 12-character product id; source 31 and the
  Xbox 360 GUIDs under 11 are old Marketplace ids and are skipped). At most 3
  PlayStation concepts are opened. Up to 5 Xbox products go in one catalog
  call; the closest title wins, then the most ratings, because IGDB often lists
  one product per edition or console generation. An `exact` or `edition` match
  ends the lookup; a `subtitle` match is kept only if the portal and search
  find nothing, because IGDB links "World War Z" to "World War Z: Aftermath"
  alone while search finds the original. It still has to pass
  `storeProductMatchesGame`, because IGDB data is crowd-edited.
  The ids are only as fresh as the game's last nightly IGDB refresh.
- **PlayStation:** portal pages `playstation.com/en-us/games/{slug}` (at most 4
  slugs), then Chihiro search (at most 6 queries).
- **Xbox:** xbox.com search (at most 4 queries, top 5 products each), read through
  the Display Catalog in one batch per query.

Queries cover the name, the name without its edition or "- Full Game" suffix, and
the digit form of roman numerals. A search stops early only on an `exact` or `edition`
hit, because a `subtitle` hit may be a spin-off.

Every product must pass `storeProductMatchesGame`, whichever path found it. Search
filters only save requests.

## When a stored product is wrong

The game's ratings signals (synthetic ones too), price snapshots and `game_source`
for that store are deleted by `forgetWrongStoreProduct`. This runs only on proof that
the product is another game:

- **PlayStation:** the page loaded, and neither its `<title>` nor its schema.org
  product name matches. A 404, no title, the generic title "PlayStation" or no
  schema.org name changes nothing. Both names are required so that a change in
  Sony's `<title>` format cannot wipe the catalog. Keep that guard.
- **Xbox:** the catalog API returned the product with a title, and it does not match.
  A failed call or an absent product changes nothing.

`game_source` is unique on `(source, externalId)`, so a store product can link to one
game only. Two catalog entries for one product (a game and its edition entry) both
get the ratings, but the second has no store row and logs a warning. When a wrong
holder is removed, the right game takes the link at its next pass.

## State on 2026-11-01

Measured live against the stores. These numbers do not update: re-measure before
quoting them.

| Measure | PlayStation | Xbox |
| ------- | ----------- | ---- |
| Stored products | 3,089 | 3,080 |
| Rejected | 167 | 150 |
| ... with a correct product found instead | 92 | 43 |
| ... with nothing found, so no ratings | 75 | 107 |
| Games with no product (2017 on) | 412 | 254 |
| ... that now find one | 97 | 58 |

The PlayStation column predates the Game Preview, demo and year rules, which move
its rejected count to about 170 on the same pages.

## Known limits

- **No product reachable:** many remaining games are not on the store, are delisted,
  or are annual titles the search no longer returns (`F1 22`, `NBA 2K24`). On
  PlayStation `lastError` stays set for them. That is expected.
- **Search misses:** Resident Evil 4 (2023) is not reached on PlayStation, where
  search and the portal only find `resident evil 4 (2005)`. Search can miss titles
  that a store does sell, and Xbox only looks at the top 5 products per query.
- **Rejected real versions:** the only listing can carry a long subtitle and a late
  date, such as `H1Z1: Battle Royale` for `H1Z1`, `Dead Rising 4: Frank's Big Package`
  or `Guacamelee! Super Turbo Championship Edition`. These lose their ratings. Add a
  word to `EDITION_WORDS` only if it can never name a different game.
- **Lookalike letters:** `Raji: An Ancient Epiс` on Xbox has a Cyrillic letter and
  does not match.
- **Exact title, different game:** two games with the same name still match.

## Changing the rules

This project has no tests (skill `no-tests`). Check a rule change by running the pure
functions over all stored products in a scratch script, then read the full list of
rejected and accepted-by-subtitle titles for both stores. Do not judge from counts
alone: every rule here came from reading those lists.

Changes reach games through the daily `STORE_RATINGS` pass and the weekly estimate
rebuild. Do not run a backfill (skill `let-crons-catch-up`).

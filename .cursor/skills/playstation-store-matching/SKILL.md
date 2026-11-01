---
name: playstation-store-matching
description: >-
  How game-sales-tracker decides that a PlayStation Store concept is the catalog
  game, and what happens when a stored one is wrong. Use when a game has wrong or
  missing PS ratings or prices, when lastError says "PlayStation concept not
  found", when changing store-ratings.client.ts, playstation-title-match.ts, the
  PS_STORE game_source link or the STORE_RATINGS pipeline, or when the user
  mentions PS title recognition, reconnaissance des titres, or a game matched to
  another one (Wardogs).
---

# PlayStation Store matching

A wrong match is worse than no match: another game's ratings feed the estimate.
So a concept is accepted only on proof, and a stored one is checked again on every
pass.

## Where it lives

| What | Where |
| ---- | ----- |
| The decision (pure functions) | `backend/src/ingestion/playstation-title-match.ts` |
| Finding and reading store pages | `backend/src/ingestion/store-ratings.client.ts` |
| Saving, and removing a wrong concept | `scrapeStoreRatings`, `forgetWrongPlaystationConcept` in `ingestion.service.ts` |

Xbox still uses the older prefix check (`titleMatches`). It has the same weakness,
and none of this applies to it.

## How a concept is accepted

Both titles become tokens: accents, ™ ® and platform words are dropped, and roman
numerals become digits, so "Alan Wake II" equals "Alan Wake 2". Then
`psTitleRelation` gives one of four answers:

| Relation | Meaning | Accepted? |
| -------- | ------- | --------- |
| `exact` | Same tokens, also across spacing ("WarDogs" / "War Dogs") | Yes |
| `edition` | The extra words only name a packaging or a remaster | Yes |
| `subtitle` | One title is the other plus other words | Only if the store release is within 45 days of the game's first or PlayStation release date |
| `none` | Not a prefix, or the extra words open with a number (a sequel) | No |

Examples:

- `Wardogs` / `WarDogs: Red's Return`: subtitle, 2021 against 2026, rejected.
- `Attack on Titan` / `Attack on Titan 2: Final Battle`: sequel, rejected.
- `RemiLore: Lost Girl in the Lands of Lore` / `RemiLore`: subtitle, same date,
  accepted.
- `The Witcher 3: Wild Hunt` / `... — Remastered`: edition, accepted.

Three choices to keep:

- A remaster counts as the same game, because the store often sells only that
  listing, with the original's ratings. VR versions do not count.
- The store may name its edition with up to two free words ("Zombies Chronicles
  Edition"). A catalog title may add only one ("Jotunn Edition"), otherwise
  "Need for Speed Rivals: Complete Edition" would match "Need for Speed".
- Date never overrides an `exact` title. Catalog dates are often a later PC port,
  so a large gap on an exact title is normal.

## How a concept is found

For games with no stored concept, or whose stored one was rejected:

1. Portal pages `playstation.com/en-us/games/{slug}`, at most 4 slugs.
2. Chihiro search, at most 6 queries. They cover the name, the name without its
   edition or "- Full Game" suffix, and the digit form of roman numerals. The search
   stops early only on an `exact` or `edition` hit, because a `subtitle` hit may be
   a spin-off. Candidates are sorted closest first.

Every concept page must pass `psConceptMatchesGame`, whichever path found it. The
search filter only saves requests.

## When a stored concept is wrong

`playstationFromUrl` returns one of three outcomes:

- `match`: keep it.
- `unavailable`: 404, no title, the generic title "PlayStation", or no schema.org
  product name. Nothing changes.
- `mismatch`: neither the `<title>` nor the schema.org product name matches the
  game. `forgetWrongPlaystationConcept` then deletes the game's `PS_RATINGS`
  signals (synthetic ones too), its `PS_STORE` price snapshots and its `PS_STORE`
  `game_source`.

A mismatch deletes data, which is why it needs both names to disagree: a change in
Sony's `<title>` format alone must not wipe the catalog. Keep that guard.

`game_source` is unique on `(source, externalId)`, so a concept can link to one game
only. Two catalog entries for one concept (a game and its edition entry) both get
the ratings, but the second has no `PS_STORE` row and logs a warning. When a wrong
holder is removed, the right game takes the link at its next pass.

## State on 2026-11-01

Measured live against the store, before this code was deployed. Run on the 3,089
stored concepts and the 412 PlayStation games from 2017 on with no concept:

| Measure | Games |
| ------- | ----- |
| Stored concepts confirmed | 2,922 |
| Stored concepts rejected | 167 |
| ... of which a correct concept was found instead | 92 |
| ... of which nothing was found, so no PS ratings | 75 |
| Games with no concept that now find one | 97 |
| Games with no concept that still find none | 315 |

These numbers do not update. Re-measure before quoting them.

## Known limits

- **No store page reachable:** many of the 315 are not on the store, are delisted or
  are annual titles the search no longer returns (`F1 22`, `NBA 2K24`). `lastError`
  stays set for them. That is expected.
- **Resident Evil 4 (2023):** search and the portal only reach `resident evil 4
  (2005)`, so the remake has no PS ratings. Search misses some titles that the store
  does sell.
- **Rejected real versions:** the only PS listing can carry a long subtitle and a
  late date, such as `H1Z1: Battle Royale` for `H1Z1`, or `Dead Rising 4: Frank's
  Big Package`. These lose their ratings. Add a word to `EDITION_WORDS` only if it
  can never name a different game.
- **Exact title, different game:** two games with the same name still match.

## Changing the rules

This project has no tests (skill `no-tests`). Check a rule change by running the pure
functions over all stored concepts in a scratch script, then read the full list of
rejected and accepted-by-subtitle titles. Do not judge from counts alone: every rule
here came from reading those lists.

Changes reach games through the daily `STORE_RATINGS` pass and the weekly estimate
rebuild. Do not run a backfill (skill `let-crons-catch-up`).

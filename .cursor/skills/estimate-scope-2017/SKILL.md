---
name: estimate-scope-2017
description: >-
  Explains why game-sales-tracker publishes no sales estimate for games released
  before 2017, and what that rule covers. Use when a game shows "Not estimated",
  when a request touches old games, estimateOutOfScope, ESTIMATE_MIN_RELEASE or
  released_in_scope, when changing the public estimate or the ml/ training set,
  or when someone proposes estimating older games again.
---

# No estimate before 2017

The owner decided this on 2026-10-31. Our model is not reliable enough to give
a precise estimate for games released before 2017, and the mission is recent
games. The public site says exactly that, and shows "Not estimated" instead of
a figure.

## Why

Measured on unseen games (`ml/`, snapshot `2026-10-31T1059`, by PC release year):

| Released | Sales per Steam review | v1.2 error | Site formula error |
|---|---|---|---|
| Up to 2012 | 459 | ×1.82 | ×4.27 |
| 2013-2016 | 145 | ×1.65 | ×1.96 |
| 2017-2019 | 107 | ×1.42 | ×1.81 |
| 2020-2022 | 85 | ×1.50 | ×1.93 |
| 2023-2024 | 52 | ×1.43 | ×1.62 |
| 2025+ | 53 | ×1.44 | ×1.74 |

- The link between Steam reviews and sales changes far too much across these
  years. Older games also sold a lot outside Steam, and the data cannot separate
  that from players simply leaving more reviews today.
- The model stays stable from 2017 on and degrades before.
- Falling back on the site formula would be worse, so old games show nothing.
- Training on 2017+ only does not hurt recent games: on the same figures it gave
  ×1.432 against ×1.442, better in 80 % of draws. That gain is not yet solid, so
  do not present it as proof.

Most of the better score after the cut comes from removing harder games from the
judged figures. It is not an equivalent improvement of the model.

## What the rule covers

`game.releaseDate` is the reference, as displayed on the game page. A game with
no known date stays in scope.

- **Public API:** `games/estimate-scope.ts` owns the date. `getBySlug` returns
  `estimateOutOfScope: true` with no headline, platform lines or history. Listings
  return no figure, and these games rank last when sorting by sales.
- **Game page:** `outOfScopeTitle` and `outOfScopeNote` in `frontend/messages/`.
- **Lab:** `released_in_scope` in `ml/snapshot.py` limits the backtest, the benches,
  the catalog checks, the review lists and the neutral test.

## What stays

- Game pages, signals, prices and the sitemap.
- Published figures in the database: never reject or delete a milestone because
  the game is old.
- Series and studio track record: old figures still feed newer games, in
  `ml/features.py` and in `trackRecord` in `ml-estimate.service.ts`.
- The matcher corpus.
- Computed estimates and the admin view, which says the game is hidden.

## Before changing it

The frozen model in production decides nothing here: the scope is applied at the
API. Moving the date means changing `ESTIMATE_MIN_RELEASE` in the backend and
in `ml/snapshot.py` together, then rerunning the benches
on the same figures. Reopen the rule only with a bench that shows the older games
reach the accuracy of the recent ones, and ask the owner.

Visitor traffic on these pages was not measured when the rule was set.

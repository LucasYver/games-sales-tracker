# Data-driven profiles (matcher)

> Verified against commit `5f0cae0` (2026-10-03).
>
> **Current state.** The matcher is the only estimation profile.
> `USE_MATCHER_PROFILE` defaults to on. `GenreProfile` and
> `game.genreProfileId` were removed (`1782700000000-DropGenreProfile`).
> There is nothing left to "flip" or keep as a genre fallback.
>
> Weights below are the ones in `MatcherService`. The holdout file is a
> point-in-time measurement, not a live score.

A game's Boxleiter band, launch-CCU ratio, lifecycle curve, and platform
shares come from the observed behaviour of its nearest anchors in
`reference_profile`. Genre is a matching feature, never a stored profile.

```
signals + milestones ──► ReferenceProfileService ──► reference_profile
                                                          │
target features ──► MatcherService (kNN) ──► SalesProfileResolverService
                                                          │
                                                          ▼
                                               EstimationService
```

`SalesProfileResolverService` returns `null` only when the flag is off or
the anchor table is empty. Fewer than 3 neighbours falls through to a
play-mode mean, then a global mean, inside the matcher. The estimator
then uses the constants in `ESTIMATION.md`.

## Matching

Implementation: `backend/src/reference-profiles/matcher.service.ts`.

- k = `15`, minimum neighbours = `3`, aggregation weight =
  `similarity^2 × qualityScore`.
- `reviewsToUnits` neighbours beyond 2× the neighbourhood median are
  dropped before the log-space mean.
- Play-mode is a hard filter. Price is not a feature.
- Gameplay type is Jaccard on Steam community tags when both games have
  them, otherwise store genres.

Weights (sum = 1):

| Feature | Weight |
| ------- | ------ |
| `gameplayType` | `0.351` |
| `rank` | `0.1116` |
| `playtime` | `0.10` |
| `publisherMatch` | `0.081` |
| `developerMatch` | `0.081` |
| `platformsOverlap` | `0.0486` |
| `dlcTier` | `0.0486` |
| `releaseEra` | `0.0405` |
| `scaleBucket` | `0.0324` |
| `franchise` | `0.0324` |
| `liveService` | `0.0243` |
| `devTrackRecord` | `0.0243` |
| `annualIteration` | `0.0243` |

`rank` is the home-grown review-velocity rank. `playtime` is median
reviewer playtime and is neutral when either side lacks it. Change a
weight only in `SIMILARITY_WEIGHTS`, keep the sum at 1, and re-run the
holdout.

DLC tiers: NONE / FEW (1–4) / SOME (5–14) / MANY (15+). Contiguous tiers
score 0.6. `developerTrackRecord` is computed in memory and is leak-safe
(a game is never its own antecedent).

## Anchors

`ReferenceProfileService.rebuildOne` / `rebuildAll`.

An anchor needs a dated non-engagement milestone or a
`STEAM_PLAYERS_LEAK` snapshot. The leak is PC player counts from July 2018
and is the holdout ground truth. It is not a live estimate input.

`peakCcuRatio` uses the launch month plus the next month
(`LAUNCH_CCU_WINDOW_MONTHS`), the same window as the first-week estimate.
It drops a launch peak below 15 % of the all-time peak and caps the ratio
at 60.

`rebuildAll` only visits current candidates. A game that leaves that set
keeps its old `reference_profile` row; `rebuildOne` deletes a row only for
a game it actually visits.

## How to run

```bash
cd backend
npm run migration:run
npm run backfill:steam-metadata
npm run rebuild:reference-profiles
npm run diagnose:grouping
npm run validate:matcher-holdout
```

The holdout writes `scripts/.validate-matcher-holdout.json` at the repo
root (`backend/src/scripts` → `../../../scripts`). Disable the matcher
with `USE_MATCHER_PROFILE=false`.

## Latest captured holdout

`scripts/.validate-matcher-holdout.json`, generated 2026-07-26, k = 15.
Matcher only (no genre baseline in that run). Median absolute log-error,
as a factor `10^error`:

| Target | n | Median \|log error\| | ×off |
| ------ | - | -------------------- | ---- |
| `reviewsToUnits` | 297 | 0.360 | ×2.29 |
| `m1` | 303 | 0.182 | ×1.52 |
| `y2` | 305 | 0.079 | ×1.20 |

Re-run before quoting these numbers against the current corpus. Weights
have moved since the first genre-vs-matcher comparison (that older run
reported matcher ×1.53 / ×1.77 / ×1.22 on reviews, m1, and y2). Do not
mix the two tables.

## Still open

- Fit `k` and the weights on a fresh holdout instead of editing them by hand.
- Down-weight outlier anchors with leave-one-out, beyond the current
  `reviewsToUnits` median filter.
- Platform-share proxies are not validated by the PC-only leak.
- `rebuildAll` does not prune anchors that are no longer candidates.
- More post-2018 milestones reduce the leak's survivor bias. The leak is
  about 585 paid games, pre-2018, mostly above 500k players.

## Historical note

Phase 0 (`diagnose-grouping.ts`) showed hand-built `GenreProfile` buckets
explained about 1.3 % of leak variance. That result justified deleting
them. The original plan is `~/.cursor/plans/data-driven-profiles_42466fe6.plan.md`
and is not maintained.

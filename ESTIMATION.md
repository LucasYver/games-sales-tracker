# Estimation method — source of truth

> Verified against commit `5f0cae0` (2026-10-03).
>
> **Contract.** This file describes how sales are estimated. If a formula
> here changes, the code must change, and the reverse. Numeric constants
> live in `backend/src/games/sales-modeling.constants.ts`. Method weights
> live in the `estimation_method` table. Do not treat a removed design as
> still active just because an old migration created it.

We never know the real number of copies sold. We **guess** from public
signals and from the observed behaviour of similar games. Each guess is a
range. A dated declared figure is kept beside the guess as a cross-check.
It does not rewrite the guess.

```
signals ──► matcher profile (or global constants)
              │
              ├─ PC Boxleiter (reviews × band)
              ├─ PC first-week (launch CCU × curve)
              └─ console splits (share ratios) + store-rating Boxleiter
                                │
                                ▼
                    per-platform aggregate ──► estimatedToday
declared GLOBAL milestone ──► cross-check only (totalSales / reconciliation)
```

## Removed on purpose

Do not reintroduce these without an explicit product decision:

- Per-game `calibratedMultiplier*` / `calibrationSource*` (dropped by
  `1783780000000-DropCalibrationAndPureEstimate`).
- `estimate_snapshot.pureEstimatedToday*` (same migration). The headline
  **is** the model; there is no second "pure" column.
- `GenreProfile`, `game.genreProfileId`, `game.genreProfileManual`
  (dropped by `1782700000000-DropGenreProfile`). The matcher replaced them.
- Using a milestone as a floor or freshness cap on `estimatedToday`.

`freshnessCap` and the PC-marginality guardrail are still in
`GamesService.reconcile`, but per-platform declared milestones are no longer
loaded into that map, so neither path runs. Worldwide figures never enter
the headline.

## 1. Profile

> `SalesProfileResolverService.resolveForGame`
> (`backend/src/reference-profiles/sales-profile-resolver.service.ts`).

`USE_MATCHER_PROFILE` defaults **on**. Set it to `false` / `0` / `off` /
`no` to force global constants.

The matcher (`MatcherService`, k = 15, minimum 3 neighbours) returns a
`ResolvedGenreProfile`. The name is historical; the values come from
neighbour anchors in `reference_profile`, not from a genre row.

| Field | Source | Fallback |
| ----- | ------ | -------- |
| PC Boxleiter band | log-space blend of `reviewsToUnits` and `globalReviewsToUnits × pcShare`, then ±25 % | `25–65` |
| PS Boxleiter band | that PC midpoint × (PS default midpoint / PC default midpoint), then ±25 % | `40–100` |
| Xbox Boxleiter band | not derived from the matcher | `35–90` |
| `peakCcuToWeekOne` | `peakCcuRatio` ±30 % | `3–7` |
| `m1` | `1 / curve.s1` | `2.5` |
| `tailY2` / `tailY5` | `curve.a2` and `a2^1.5` | `1.25` / `1.5` |
| Platform shares | similarity-weighted neighbour shares | `0.50 / 0.25 / 0.15 / 0.10` (PC/PS/Xbox/Switch) |

`null` only when the flag is off or the corpus has zero anchors. A thin
neighbourhood falls through to the matcher's global mean inside
`MatcherService`, not to a genre bucket.

Similarity weights, play-mode hard filter, and anchor construction:
`DATA_DRIVEN_PROFILES.md` and `matcher.service.ts`. Weights are hand-set
in code and are **not** a database column.

## 2. Boxleiter

> `EstimationService.estimateForPlatform`.

```
units_low  = signal × multiplier_low
units_high = signal × multiplier_high
```

`signal` is the latest **non-synthetic** `SignalSnapshot` for that metric.

| Platform | Metric | Global low | Global high | Plausible min | Plausible max |
| -------- | ------ | ---------- | ----------- | ------------- | ------------- |
| PC | `STEAM_REVIEWS` | `25` | `65` | `5` | `500` |
| PlayStation | `PS_RATINGS` | `40` | `100` | `8` | `600` |
| Xbox | `XBOX_RATINGS` | `35` | `90` | `6` | `600` |

The method tag is always `boxleiter-default`,
`ps-ratings-boxleiter-default`, or `xbox-ratings-boxleiter-default`,
including when the matcher supplied the band. `multiplierSource` on the
breakdown trace says `matcher` or `global`.

Xbox ratings are the Display Catalog worldwide
`UsageData.AllTime.RatingCount`. `xbox-ratings-boxleiter-default` is
enabled (`1788760000000-XboxCatalogRatingsAndPrices`).

Legacy `*-calibrated*` rows stay in `estimation_method` so old
`sales_estimate` rows still resolve. Nothing new is written with those codes.

## 3. First-week extrapolation (PC)

> `EstimationService.estimateFirstWeekExtrapolationForPc`.
> Method code: `first-week-extrapolation-pc` (family `LIFECYCLE`, default
> weight `0.6`).

Independent of the review multiplier. Needs a PC release date and age > 0.

### Launch peak

Largest `STEAM_CONCURRENT` from the first day of the PC release month
through `LAUNCH_PEAK_CCU_WINDOW_MONTHS` (2) months later, capped at the
as-of date. Leak-era CCU is one point per calendar month, so a 14-day
window would miss it. `FIRST_WEEK_PEAK_CCU_WINDOW_DAYS` (14) is only the
rebuild downsampling window, not this peak.

```
weekOneLow  = peak × peakCcuToWeekOneLow
weekOneHigh = peak × peakCcuToWeekOneHigh
```

Launch reviews are not mixed in. Publisher Steam-share scaling is not
applied on this path.

### Projection to today

With a profile, `genreProjectionMultiplier(m1, tailY2, tailY5, ageDays)`:

```
day 7    → 1
day 30   → 1 + 0.425 × (m1 − 1)
day 90   → 1 + 0.661 × (m1 − 1)
day 180  → 1 + 0.847 × (m1 − 1)
day 365  → m1
day 730  → m1 × tailY2
day 1825 → m1 × tailY5
day 3650 → m1 × tailY5^(1.85/1.5)
```

Ages 0–7 ramp linearly from 0 to 1. Past the last anchor the curve clamps.

Without a profile, `firstWeekProjectionMultiplier` picks
`FIRST_WEEK_PROJECTION_CURVE_LARGE` (year-1 `2.68`) or `_SMALL`
(year-1 `3.77`) at `FIRST_WEEK_BUCKET_THRESHOLD` (100_000 week-1 units).
Both curves continue, decelerating, through year 15.

The estimate is dropped outside
`[FIRST_WEEK_ESTIMATE_MIN_UNITS, FIRST_WEEK_ESTIMATE_MAX_UNITS]` =
`[5_000, 200_000_000]`.

## 4. Console splits

> `EstimationService.aggregateResultsByPlatform` /
> `computeGenreSplit`.

```
target = sourceAggregate × (targetShare / sourceShare)
```

Skipped when the game is not released on the target, a share is 0, or
there is no profile.

1. Aggregate PC (Boxleiter + first-week).
2. `genre-console-split-from-pc-playstation` (weight `0.4`).
3. Aggregate PlayStation (PS Boxleiter + that split).
4. Prefer `genre-console-split-from-ps-xbox`; else
   `genre-console-split-from-pc-xbox` (weight `0.4`).
5. Aggregate Xbox (split + Xbox Boxleiter).

## 5. Aggregation

> `EstimationService.aggregateMethodsForPlatform`.
> `α = AGGREGATION_DISAGREEMENT_ALPHA = 0.5`.

Only enabled, non-aggregate methods with `defaultWeight > 0` contribute.
Weight is the static method weight. There is no per-estimate confidence.

```
weightedLow  = Σ (low_i  × w_i) / Σ w_i
weightedHigh = Σ (high_i × w_i) / Σ w_i
disagreement = (max(mid_i) − min(mid_i)) / weightedMid
aggLow       = max(0, weightedLow  × (1 − α × disagreement))
aggHigh      = weightedHigh × (1 + α × disagreement)
```

One input → the aggregate copies it. Disagreeing midpoints widen the band
on purpose. The `aggregated` row is what the headline reads. Inputs and
splits are kept beside it.

`GamesService.latestEstimatesByPlatform` prefers the latest `aggregated`
row per platform, then any other latest row if no aggregate exists.

Adding a method means a migration that inserts `estimation_method` **and**
a producer in `EstimationService`. A row with `isEnabled = false` is ignored
even if the code emits the tag.

## 6. Headline vs declared figure

> `GamesService.aggregateSales` / `reconcile` / `buildTotal`.

`milestonesAsOf` loads **GLOBAL**, non-engagement milestones only.

- `estimatedToday` = sum of per-platform aggregate ranges. This is
  `headline` on the public game payload and the value stored on
  `estimate_snapshot`. Listing cards use the same snapshot.
- `reconciliation` adds one GLOBAL entry comparing that sum to the
  **largest** declared units (`isMoreAuthoritative`). Agreement does not
  change the sum.
- `totalSales` is different: when any GLOBAL milestone exists it is the
  **latest-dated** figure (`isLater`), with confidence derived from
  `confidenceScore` and then nudged by agreement. It is the reported
  cross-check, not the chart.

Free-to-play games (`Game.isFree`) get no estimate.

## 7. Agreement label

> `GamesService.classifyAgreement`. Presentation only.

- Declared inside `[estLow, estHigh]` → **strong**.
- Declared above `estHigh`: within `AGREEMENT_OVERSHOOT_RATIO` (`1.5×`)
  → **weak**, else **conflict**.
- Declared below `estLow`: growth budget
  `1 + AGREEMENT_GROWTH_PER_YEAR × ageYears` with
  `AGREEMENT_GROWTH_PER_YEAR = 0.6`. Within budget → **weak**, within
  2× budget → **weak**, beyond → **conflict**.

## 8. Achievements

Exophase and Steam achievement snapshots are still collected. No
`SalesEstimate` is produced from them. Coverage constants
(`EXOPHASE_COVERAGE_*`) remain in `sales-modeling.constants.ts` for a
possible later method. There is no `BACKLOG.md`.

## 9. Time series and rebuild

| Entity | Timestamp | What it holds |
| ------ | --------- | ------------- |
| `SignalSnapshot` | `capturedAt` | Raw public counts. `synthetic = true` rows are display-only and never feed an estimate. |
| `AchievementSnapshot` | `capturedAt` | Unlock sample. Not an estimate input today. |
| `SalesEstimate` | `computedAt` | Per-method ranges plus one `aggregated` row per platform. Append-only. |
| `EstimationMethod` | registry | Code, family, `defaultWeight`, `isEnabled`. |
| `EstimateSnapshot` | `computedAt` | Frozen `estimatedToday` range and reconciliation JSON. |
| `Milestone` | `reportedAt` | Dated declared figure. Engagement rows are excluded from the headline. Undated rows are rejected at ingest. |
| `ReferenceProfile` | `observedAt` | Matcher anchor. Not an estimate row. |

`POST /admin/games/:id/rebuild` replays capture moments through
`computeAndStoreAt` + `snapshotReconcile` using **today's** matcher
profile and constants. It does not re-derive a historical profile per
point. `STEAM_REVIEWS` moments are downsampled after the launch window
(`REVIEWS_REBUILD_*` in the constants file).

## 10. Out of scope

- Nintendo Switch and mobile: no trusted unit signal, no estimate.
- Bundles, DLC, free weekends, and refunds are not removed from reviews.
- Revenue and regional price are collected for display, not converted into units.
- Free-to-play is skipped (`Game.isFree`).

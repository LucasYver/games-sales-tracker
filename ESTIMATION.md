# Estimation method — source of truth

> **Contract.** This file is the single source of truth for how we estimate
> game sales. If a formula here changes, the code must change (and vice
> versa). Every formula links to the file/symbol that implements it.

We never know the real number of copies a game has sold. We **guess** from
public signals (reviews, ratings, achievements) and **cross-check** with
declared figures (publisher IR, Wikipedia). Each guess comes with a range
and a confidence level.

```
public signal ──► per-platform estimate ─┐
                                         ├─► reconcile ─► "today" range
declared figure (with date) ─────────────┘
```

---

## 1. Per-platform estimate — Boxleiter

> Implemented in `EstimationService.estimateForPlatform`
> (`backend/src/estimation/estimation.service.ts`).

For each platform, "a public signal" (Steam reviews, PSN ratings, Xbox
ratings) is roughly proportional to units sold. Multiply the signal by a
**multiplier** to get units.

```
units_low  = signal × multiplier_low
units_high = signal × multiplier_high
```

`signal` is the most recent `SignalSnapshot` row for that game/metric:

| Platform | Signal metric                   |
| -------- | ------------------------------- |
| PC       | `SignalMetric.STEAM_REVIEWS`    |
| PS       | `SignalMetric.PS_RATINGS`       |
| Xbox     | `SignalMetric.XBOX_RATINGS`     |

`multiplier_low/high` comes from `resolveMultiplier`:

- If the game has a **calibrated multiplier** stored on `Game`
  (`calibratedMultiplier`, `calibratedPsMultiplier`,
  `calibratedXboxMultiplier`), use it with a per-source spread:
  - OFFICIAL-derived → ±20 %
  - ANNOUNCEMENT-derived → ±30 %
  - MEDIA-derived → ±45 %
  - WIKIPEDIA-derived → ±45 %
  The source of the record that produced the multiplier is stored on
  `Game.calibrationSource{Pc,Ps,Xbox}` and the spread is looked up in
  `CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE`. Method tag:
  `…-calibrated-{source}` (e.g. `boxleiter-calibrated-media`).
- Otherwise, use the platform's default range. Method tag: `…-default`.

| Platform | Default low | Default high | Plausible min | Plausible max |
| -------- | ----------- | ------------ | ------------- | ------------- |
| PC       | `25`        | `70`         | `5`           | `500`         |
| PS       | `40`        | `100`        | `8`           | `600`         |
| Xbox     | `35`        | `90`         | `6`           | `600`         |

Source: `sales-modeling.constants.ts` (`*_BOXLEITER_*`).
`CALIBRATED_MULTIPLIER_SPREAD = 0.2` (±20 %).

### How calibration learns the multiplier

> `EstimationService.recalibratePlatform`.

If we have at least one **declared figure with a date** for that platform
from a source in `CALIBRATION_SOURCES = [OFFICIAL, ANNOUNCEMENT, MEDIA]`
(in that priority order — OFFICIAL wins when both exist), we look for
the signal snapshot **closest in time** to that declared date. Then:

```
multiplier = declared.units / signal.value
```

We persist this multiplier on `Game.calibrated*Multiplier` **together
with the record's source** on `Game.calibrationSource*`, so the next
estimate read can pick the spread that matches the source's
trustworthiness. We only keep the multiplier if:

- the snapshot is within `CALIBRATION_WINDOW_DAYS = 365` days of the
  declared date (otherwise we'd mix points from different times), and
- `multiplier` is inside the platform's plausible range (otherwise we
  treat it as a data error and fall back to defaults).

WIKIPEDIA is deliberately **not** in `CALIBRATION_SOURCES`: it is
secondhand by nature (it cites other sources) so we'd be calibrating on
re-reported numbers without the original context.

### Fallback: calibration from a worldwide figure

> `EstimationService.recalibrateFromGlobal`.

In practice, the press almost always quotes a worldwide total ("X
million copies sold across all platforms") rather than per-platform
breakdowns. Without a fallback, those `platform = GLOBAL` records can't
calibrate anything and we stay on defaults forever.

The fallback splits the GLOBAL figure proportionally to each platform's
**proxy estimate** (signal × default-multiplier midpoint), then
calibrates each platform with its allocated share. Per-platform
calibration always takes precedence — GLOBAL split only fills the
platforms that pass 1 left untouched.

```
proxy_p          = signal_p × midpoint(default_mult_p)
share_p          = proxy_p / Σ proxy
allocated_p      = declared.global × share_p
multiplier_p     = allocated_p / signal_p           // = global × midpoint(default_p) / Σ proxy
```

Crucially we use the **static defaults** (not the calibrated values) as
weights — otherwise calibration would feed back on itself.

Guards (same spirit as the per-platform pass):

- Platform's signal must exist within `CALIBRATION_WINDOW_DAYS = 365`
  days of the declared date.
- Platform's share must be at least
  `GLOBAL_SPLIT_MIN_PLATFORM_SHARE = 5 %`. Splitting a worldwide figure
  over a marginal platform (e.g. Xbox at 1 %) yields volatile
  multipliers we don't trust.
- Resulting multiplier still has to land inside
  `[plausibleMin, plausibleMax]`.

The persisted `calibrationSource*` is the GLOBAL record's source, so
the per-source spread (OFFICIAL ±20 %, ANNOUNCEMENT ±30 %, MEDIA
±45 %) applies normally at read time.

---

## 2. Per-platform estimate — Achievement-based (dormant)

> `EstimationService.estimateFromAchievementsForPlatform`. **Currently
> disabled** at the call site: the method is kept intact and
> `AchievementSnapshot` rows keep flowing in (Exophase + Steam official
> percentages, scraped on every refresh), but no `SalesEstimate` is
> produced from them today. Reactivation is a one-line change once the
> coverage constants below have been calibrated against publisher IR —
> see `BACKLOG.md`.
>
> When re-enabled, this adds a second `SalesEstimate` per platform
> (different `method`); it never replaces the Boxleiter one.

The "most common achievement" of a game is a strong proxy for "players who
actually launched the game". Exophase exposes:

- `playersTracked` — how many Exophase users own the game on that platform
  (a **sample** of the real playerbase),
- `mostCommonPercent` — % of that sample who unlocked the easiest
  achievement.

**Step 1 — sample players who launched the game:**

```
exo_players = playersTracked × mostCommonPercent / 100
```

**Step 2 (PC only) — remove Exophase's completionist bias.**
Steam's public API gives us the same `mostCommonPercent` but over the
**entire** Steam playerbase. Exophase users unlock things faster, so:

```
bias = exo.mostCommonPercent / steam.mostCommonPercent     # ~1.15–1.30
exo_players /= bias                                        # PC only
```

Method tag becomes `achievements-exophase-pc-steam-corrected` instead of
`achievements-exophase-pc` when this correction applies.

**Step 3 — scale Exophase sample to the whole platform:**

```
units_low  = exo_players × coverage_low
units_high = exo_players × coverage_high
```

| Platform | coverage_low | coverage_high |
| -------- | ------------ | ------------- |
| PC       | `12`         | `30`          |
| PS       | `10`         | `28`          |
| Xbox     | `8`          | `22`          |

Source: `sales-modeling.constants.ts` (`EXOPHASE_COVERAGE_*`).

> **Status of these coverage numbers.** They are *defaults*, not
> calibrated. They will be fitted per-game once the publisher IR pipeline
> lands (see `BACKLOG.md`). Until then, every achievement-based estimate
> is forced to `ConfidenceLevel.LOW`.

**Step 4 — sanity check.** The estimate is dropped if:

- `playersTracked < ACHIEVEMENT_MIN_PLAYERS_TRACKED` (`500`) — sample too
  small,
- `units_low < ACHIEVEMENT_ESTIMATE_MIN_UNITS` (`1_000`) — implausibly
  low,
- `units_high > ACHIEVEMENT_ESTIMATE_MAX_UNITS` (`500_000_000`) —
  implausibly high.

---

## 3. Confidence

> `EstimationService.resolveConfidence`.

For Boxleiter estimates:

- `LOW` if released less than `RECENT_RELEASE_DAYS = 14` days ago.
- Otherwise based on signal size:
  - PC (Steam reviews dense): `< 50` LOW, `< 500` MEDIUM, else HIGH.
  - PS / Xbox (ratings sparser): `< 10` LOW, `< 100` MEDIUM, else HIGH.

For achievement-based estimates: always `LOW` (coverage is uncalibrated).

---

## 2bis. Per-platform estimate — First-week extrapolation (PC)

> Implemented in `EstimationService.estimateFirstWeekExtrapolationForPc`.
> Method code: `first-week-extrapolation-pc` (family `LIFECYCLE`).
> Active by default with `defaultWeight = 0.6` in the aggregation.

A second, **independent** PC estimate that does not rely on a calibrated
Boxleiter multiplier. Empirically grounded on an industry observation:

> Games with > 100k week-1 PC sales reach a median year-1 of **2.68×**
> their week-1; games with ≤ 100k week-1 reach **3.77×** (smaller
> launches have a longer tail proportionally). Both follow a
> **degressive** curve — most of the additional sales accrue in the
> first month.

### Step 1 — estimate week-1 units

From the all-time Steam peak CCU snapshot
(`SignalSnapshot.STEAM_PEAK_CCU`, ordered by `value DESC` because the
historical-import path stores peaks with the SteamCharts month as
`capturedAt`):

```
weekOneFromCcuLow  = peak × FIRST_WEEK_PEAK_CCU_LOW  × launcherCcuFactor.low
weekOneFromCcuHigh = peak × FIRST_WEEK_PEAK_CCU_HIGH × launcherCcuFactor.high
```

When a `STEAM_REVIEWS` snapshot was captured within ±
`FIRST_WEEK_REVIEWS_WINDOW_DAYS = 10` days of `releaseDate + 7 days`,
we combine it with the CCU estimate:

```
weekOneFromReviewsLow  = reviewsT7 × FIRST_WEEK_REVIEWS_LOW  × launcherReviewsFactor.low
weekOneFromReviewsHigh = reviewsT7 × FIRST_WEEK_REVIEWS_HIGH × launcherReviewsFactor.high

weekOneMid    = (mid_ccu + mid_reviews) / 2
weekOneSpread = max(spread_ccu, spread_reviews)        // floor uncertainty
weekOneLow    = weekOneMid − weekOneSpread / 2
weekOneHigh   = weekOneMid + weekOneSpread / 2
```

Method tag flips to `first-week-extrapolation-pc+reviews-corrected` so
admins can tell the two combos apart in the time series.

### Step 2 — bucket on launch size + degressive projection to today

```
bucket    = weekOneMid > FIRST_WEEK_BUCKET_THRESHOLD (100_000)
            ? FIRST_WEEK_PROJECTION_CURVE_LARGE   // hits 2.68 at day 365
            : FIRST_WEEK_PROJECTION_CURVE_SMALL   // hits 3.77 at day 365
multiplier(age) = piecewise-linear interpolation over the chosen curve
                  (`firstWeekProjectionMultiplier`)

projectedLow  = weekOneLow  × multiplier(age)
projectedHigh = weekOneHigh × multiplier(age)
```

Curves (multiplier of week-1 sales):

| Age (days)         | LARGE bucket | SMALL bucket |
| ------------------ | ------------ | ------------ |
| 7 (week 1)         | `1.00`       | `1.00`       |
| 30 (month 1)       | `1.70`       | `2.20`       |
| 90 (Q1)            | `2.10`       | `2.85`       |
| 180 (half-year)    | `2.45`       | `3.30`       |
| 365 (year 1)       | `2.68`       | `3.77`       |
| 730 (year 2)       | `3.00`       | `4.50`       |
| 1825 (year 5+)     | `3.40`       | `5.50`       |

Ages between 0 and 7 days ramp linearly from 0 to week-1 (pre-launch
returns 0).

### Step 3 — sanity check

The estimate is dropped if it falls outside
`[FIRST_WEEK_ESTIMATE_MIN_UNITS, FIRST_WEEK_ESTIMATE_MAX_UNITS] =
[5_000, 200_000_000]`. Tightens against peak-CCU outliers and
date-of-release glitches.

### Confidence

- `LOW` if released less than `RECENT_RELEASE_DAYS = 14` days ago, OR
  if peak CCU < 10k (sample too small to project from).
- `HIGH` only when peak CCU ≥ 50k **and** we have a launch-week reviews
  snapshot (both signals agree).
- `MEDIUM` otherwise.

All capped by `LAUNCHER_CONFIDENCE_CAP[publisher.launcherProfile]`
identically to the Boxleiter path.

### Why a separate method (vs. patching `LIFETIME_SALES_CURVE`)

The existing `LIFETIME_SALES_CURVE` says `year1/week1 ≈ 0.58/0.13 ≈
4.46×`, larger than both empirical buckets. Rather than retrofit one
curve to two regimes (large vs small launches), the lifecycle method
encodes the empirical buckets directly and lets the aggregator average
it with Boxleiter — the two methods disagree precisely where the
existing curve was a poor fit, so the aggregate's disagreement
inflation surfaces the uncertainty rather than hiding it.

---

## 3bis. Method registry and aggregation

> Source of truth: the `estimation_method` table, cached in memory by
> `EstimationMethodService`. Inputs are wired in
> `EstimationService.persistEstimates`, output is computed by
> `EstimateService.aggregateMethodsForPlatform`.

Every `SalesEstimate` row is linked to a canonical method through
`SalesEstimate.methodId` (FK to `estimation_method.id`). The free-form
`SalesEstimate.method` string survives for backward compatibility and
carries dynamic modifier suffixes (`+ccu-intersect`, `+ccu-conflict`,
`+multi-store`, `+launcher-primary`) that aren't yet first-class
methods. It will be dropped in a follow-up migration once nothing reads
it.

### Method codes (seeded by migration `AddEstimationMethodRegistry`)

| Code                                            | Family       | Default weight | Enabled |
| ----------------------------------------------- | ------------ | -------------- | ------- |
| `boxleiter-default`                             | BOXLEITER    | `0.5`          | ✅      |
| `boxleiter-calibrated-official`                 | BOXLEITER    | `1.0`          | ✅      |
| `boxleiter-calibrated-announcement`             | BOXLEITER    | `0.7`          | ✅      |
| `boxleiter-calibrated-media`                    | BOXLEITER    | `0.5`          | ✅      |
| `boxleiter-calibrated-wikipedia`                | BOXLEITER    | `0.4`          | ✅      |
| `ps-ratings-boxleiter-default`                  | BOXLEITER    | `0.5`          | ✅      |
| `ps-ratings-boxleiter-calibrated-official`      | BOXLEITER    | `1.0`          | ✅      |
| `ps-ratings-boxleiter-calibrated-announcement`  | BOXLEITER    | `0.7`          | ✅      |
| `ps-ratings-boxleiter-calibrated-media`         | BOXLEITER    | `0.5`          | ✅      |
| `ps-ratings-boxleiter-calibrated-wikipedia`     | BOXLEITER    | `0.4`          | ✅      |
| `xbox-ratings-boxleiter-default`                | BOXLEITER    | `0.5`          | ✅      |
| `xbox-ratings-boxleiter-calibrated-official`    | BOXLEITER    | `1.0`          | ✅      |
| `xbox-ratings-boxleiter-calibrated-announcement`| BOXLEITER    | `0.7`          | ✅      |
| `xbox-ratings-boxleiter-calibrated-media`       | BOXLEITER    | `0.5`          | ✅      |
| `xbox-ratings-boxleiter-calibrated-wikipedia`   | BOXLEITER    | `0.4`          | ✅      |
| `achievements-exophase-pc`                      | ACHIEVEMENTS | `0.3`          | ⛔ dormant |
| `achievements-exophase-pc-steam-corrected`      | ACHIEVEMENTS | `0.3`          | ⛔ dormant |
| `achievements-exophase-playstation`             | ACHIEVEMENTS | `0.3`          | ⛔ dormant |
| `achievements-exophase-xbox`                    | ACHIEVEMENTS | `0.3`          | ⛔ dormant |
| `first-week-extrapolation-pc`                   | LIFECYCLE    | `0.6`          | ✅      |
| `aggregated`                                    | AGGREGATE    | `1.0`          | ✅ (output) |

Adding a new method = inserting a row in `estimation_method` (via a
migration) and producing `SalesEstimate` rows that reference it. The
aggregator picks it up automatically as soon as `isEnabled = true` and
`defaultWeight > 0`.

### Aggregation formula

`aggregateMethodsForPlatform` combines every input method for a single
`(gameId, platform, computedAt)` tuple into one synthetic
`method = 'aggregated'` row. It is **append-only**: the inputs are kept
as-is alongside the aggregate so we can inspect each method's
contribution after the fact.

```
weightedLow  = Σ (low_i  × w_i) / Σ w_i
weightedHigh = Σ (high_i × w_i) / Σ w_i
disagreement = (max(mid_i) − min(mid_i)) / weightedMid
aggLow  = max(0, weightedLow  × (1 − α × disagreement))
aggHigh = weightedHigh × (1 + α × disagreement)
```

with `α = AGGREGATION_DISAGREEMENT_ALPHA = 0.5`. Aggregate confidence
is the **lowest** confidence among contributing methods.

Properties:
- **One method active** (today's reality) → `disagreement = 0`, the
  aggregate copies the input band byte-for-byte. The refactor is a no-op
  on the headline range.
- **Multiple methods, agreeing midpoints** → near-zero `disagreement`,
  the aggregate is a weighted average that narrows the band relative to
  the constituents.
- **Multiple methods, conflicting midpoints** → spread inflates
  proportionally so the headline range honestly reflects the model's
  internal uncertainty rather than picking a winner.

### How the reconcile step picks an estimate

`GamesService.latestEstimatesByPlatform` prefers the latest
`aggregated` row per platform. If no aggregate exists (historical row
predating this refactor, or future platform with no enabled method),
it falls back on whatever non-aggregate row is most recent so the
headline never goes blank. Rebuilding history with
`POST /admin/games/:id/rebuild-estimates` regenerates aggregates for
every capture point.

---

## 4. Reconcile to one "today" range

> `GamesService.reconcile`.

For each platform we have at most one declared figure (`bestByPlatform`)
and one estimate (the Boxleiter one — achievement estimates are stored
side-by-side but not used here yet). We pick a `[low, high]` per platform:

- **Both declared + estimate** →
  `low = max(declared, min(estimate.low, freshnessCap))`,
  `high = max(declared, min(estimate.high, freshnessCap))`.
  Declared is a floor (sales only grow); `freshnessCap` is an age-aware
  ceiling (see §5).
- **Declared only** → `low = high = declared`.
- **Estimate only** → use it raw, except the PC guardrail below.
- **Neither** → platform skipped.

**PC dominance guardrail** (`isPcMarginal`). If a game has declared
console figures but only a PC estimate, and the PC estimate represents
less than `PC_DOMINANCE_RATIO_THRESHOLD = 20 %` of the cross-checked
total, we **drop** the PC estimate (PS-exclusive with a tiny PC port,
Switch port with rounding-error Steam sales, etc.). Without this,
Boxleiter PC on its own would set the headline number for those games and
be very wrong.

**Sum to today.** We sum the per-platform `[low, high]` to a global
`todayLow / todayHigh`. If a **worldwide** declared figure exists, we
clamp the sum to it: floor at `globalDeclared`, ceiling at the freshness
cap of `globalDeclared`.

---

## 5. Freshness cap

> `GamesService.freshnessCap`.

A declared figure dated 6 months ago doesn't allow infinite growth today.
Sales follow a **front-loaded curve** stored in `LIFETIME_SALES_CURVE`
(cumulative % of lifetime revenue at age in days):

```
[0,0] [7,0.13] [90,0.33] [365,0.58] [730,0.75]
[1095,0.87] [1460,0.95] [1825,1.0]
```

With release date known:

```
declaredPct  = lifetimeSalesPct(ageInDays(release, declared.date))
todayPct     = lifetimeSalesPct(ageInDays(release, now))
expectedRatio = todayPct / declaredPct
cap          = declared.units × (1 + (expectedRatio - 1) × FRESHNESS_VARIANCE_BUFFER)
cap          = max(cap, declared.units × FRESHNESS_MIN_HEADROOM)
```

`FRESHNESS_VARIANCE_BUFFER = 1.5` (50 % above median growth, covers the
~95th percentile of long-tail outliers).
`FRESHNESS_MIN_HEADROOM = 1.01` (floor so the cap is never *below* the
declared figure due to rounding).

Fallback when release date is unknown:

```
cap = declared.units × (1 + FALLBACK_ANNUAL_GROWTH × ageYears)
```

with `FALLBACK_ANNUAL_GROWTH = 0.6` and no cap once
`ageYears >= FALLBACK_GROWTH_CAP_YEARS = 3`.

---

## 6. Agreement label (declared vs estimate)

> `GamesService.classifyAgreement`. Pure presentation: doesn't change any
> number, just labels the cross-check `strong | weak | conflict` with a
> human-readable detail.

- `declared` inside `[estLow, estHigh]` → **strong**.
- `declared > estHigh`:
  - within `AGREEMENT_OVERSHOOT_RATIO = 1.5×` of `estHigh` → **weak**
    (model undershoots a bit);
  - beyond → **conflict** (figure or estimate is likely wrong).
- `declared < estLow`: we expect growth since `declared.date`. Allowed
  budget = `1 + AGREEMENT_GROWTH_PER_YEAR × ageYears` with
  `AGREEMENT_GROWTH_PER_YEAR = 0.6`. Within budget → **weak**, within 2×
  budget → **weak with caution**, beyond → **conflict**.

---

## 7. Constants index

All numbers live in `backend/src/games/sales-modeling.constants.ts`.

| Constant                          | Value      | Used in                                |
| --------------------------------- | ---------- | -------------------------------------- |
| `LIFETIME_SALES_CURVE`            | (8 points) | freshness cap                          |
| `FRESHNESS_VARIANCE_BUFFER`       | `1.5`      | freshness cap                          |
| `FRESHNESS_MIN_HEADROOM`          | `1.01`     | freshness cap                          |
| `FALLBACK_ANNUAL_GROWTH`          | `0.6`      | freshness cap fallback, agreement      |
| `FALLBACK_GROWTH_CAP_YEARS`       | `3`        | freshness cap fallback                 |
| `AGREEMENT_OVERSHOOT_RATIO`       | `1.5`      | agreement classifier                   |
| `AGREEMENT_GROWTH_PER_YEAR`       | `0.6`      | agreement classifier                   |
| `PC_BOXLEITER_DEFAULT_LOW/HIGH`   | `25 / 70`  | Boxleiter PC default range             |
| `PC_BOXLEITER_PLAUSIBLE_MIN/MAX`  | `5 / 500`  | Boxleiter PC calibration sanity        |
| `PS_BOXLEITER_DEFAULT_LOW/HIGH`   | `40 / 100` | Boxleiter PS default range             |
| `PS_BOXLEITER_PLAUSIBLE_MIN/MAX`  | `8 / 600`  | Boxleiter PS calibration sanity        |
| `XBOX_BOXLEITER_DEFAULT_LOW/HIGH` | `35 / 90`  | Boxleiter Xbox default range           |
| `XBOX_BOXLEITER_PLAUSIBLE_MIN/MAX`| `6 / 600`  | Boxleiter Xbox calibration sanity      |
| `CALIBRATED_MULTIPLIER_SPREAD`    | `0.2`      | legacy default (OFFICIAL spread)       |
| `CALIBRATED_MULTIPLIER_SPREAD_BY_SOURCE` | `OFFICIAL 0.2 / ANNOUNCEMENT 0.3 / MEDIA 0.45 / WIKIPEDIA 0.45` | spread around calibrated value, by source |
| `PC_DOMINANCE_RATIO_THRESHOLD`    | `0.2`      | reconcile PC marginality guardrail     |
| `EXOPHASE_COVERAGE_PC_LOW/HIGH`   | `12 / 30`  | achievement-based PC range             |
| `EXOPHASE_COVERAGE_PS_LOW/HIGH`   | `10 / 28`  | achievement-based PS range             |
| `EXOPHASE_COVERAGE_XBOX_LOW/HIGH` | `8 / 22`   | achievement-based Xbox range           |
| `ACHIEVEMENT_MIN_PLAYERS_TRACKED` | `500`      | achievement sanity (sample size)       |
| `ACHIEVEMENT_ESTIMATE_MIN/MAX_UNITS` | `1_000 / 500_000_000` | achievement sanity (range)  |
| `RECENT_RELEASE_DAYS`             | `14`       | confidence (recent → LOW)              |
| `CALIBRATION_WINDOW_DAYS`         | `365`      | recalibration (max age delta)          |
| `GLOBAL_SPLIT_MIN_PLATFORM_SHARE` | `0.05`     | min share to calibrate from a GLOBAL record |
| `DISCREPANCY_RATIO_HIGH`          | `2.0`      | discrepancy detector (under-estimate)  |
| `DISCREPANCY_RATIO_LOW`           | `0.5`      | discrepancy detector (over-estimate)   |

---

## 8. Time series — what is persisted vs computed live

Three layers, each with a different timestamp:

| Entity | Timestamp | Written by | What it holds |
| --- | --- | --- | --- |
| `SignalSnapshot` | `capturedAt` | scrapers (Steam, IGDB, store ratings) | raw public counts (reviews, ratings) |
| `AchievementSnapshot` | `capturedAt` | Exophase / Steam API scrapers | per-achievement unlock % + sample size |
| `SalesEstimate` | `computedAt` | `EstimationService.computeAndStore` | per-platform per-method ranges, FK to `estimation_method` via `methodId`. Includes the synthetic `aggregated` row (one per platform per `computedAt`). |
| `EstimationMethod` | `createdAt` / `updatedAt` | seeded by migration | registry of canonical method codes, default weights, enabled flag |
| `EstimateSnapshot` | `computedAt` | `GamesService.snapshotReconcile` (called after every `computeAndStore`) | the reconciled headline `[estimatedTodayLow, estimatedTodayHigh]` + serialized `ReconciliationEntry[]` |
| `SalesRecord` | `reportedAt` + `capturedAt` | scrapers (Wikipedia, articles, official IR) | dated declared figures, never overwritten |

`SalesEstimate` and `EstimateSnapshot` are **append-only** time series: every
refresh inserts a new row, none are updated in place. That's what makes a
sales-over-time chart possible without replaying everything from scratch.

The freshness cap, agreement classifier and `isPcMarginal` guardrail are
**re-evaluated live** on every public read in `GamesService.compose`, but
their *combined output* — the headline range and per-platform
reconciliation — is **also frozen** into `EstimateSnapshot` so the
historical view is consistent without recomputing.

`SalesEstimate.computedAt` and `EstimateSnapshot.computedAt` are plain
timestamp columns (no `@CreateDateColumn`) so historical rebuilds can
backfill them to past dates.

## 9. Historical rebuild

> `GamesService.rebuildEstimateHistory(gameId)`, exposed at
> `POST /admin/games/:id/rebuild-estimates`.

When constants in `sales-modeling.constants.ts` change, or a fresh
publisher figure recalibrates a multiplier, **past** estimates become
stale (they were computed with the old parameters). The rebuild replays
the entire history against the current parameters:

1. Collect every distinct `capturedAt` across `SignalSnapshot` and
   `AchievementSnapshot` for the game, deduped at **minute** granularity
   (one cron run writes several signals in the same second; we want one
   rebuild point per refresh, not one per signal).
2. `DELETE` all `SalesEstimate` and `EstimateSnapshot` rows for the
   game (estimates are derivatives — never primary data, always safe to
   regenerate).
3. For each capture moment `T` (ascending):
   - `EstimationService.computeAndStoreAt(gameId, T)` — uses signals
     ≤ T, current multipliers, writes `SalesEstimate` rows with
     `computedAt = T`.
   - `GamesService.snapshotReconcile(gameId, T)` — re-runs `aggregateSales`
     filtering declared figures by `reportedAt <= T || reportedAt IS NULL`,
     writes one `EstimateSnapshot` with `computedAt = T`.

The rebuild **does not** re-derive the calibrated multiplier per
historical point: it uses the multiplier as it currently stands on
`Game`. That's deliberate — "today's best knowledge applied to past
signals" is the cleanest mental model for the chart. Re-deriving the
multiplier per point would chase its own tail (each rebuild moment
would shift the multiplier, which would shift the next moment…).

Declared figures with no `reportedAt` are always kept in the
reconciliation regardless of `T` (it's knowledge we have, just undated).

## 10. Estimation discrepancy detector — model error tracking

> `GamesService.evaluateDiscrepanciesForGame(gameId)`, called after every
> `snapshotReconcile` in `IngestionService` and once again at the end of
> `rebuildEstimateHistory`. Persisted in the `EstimationDiscrepancy`
> table, surfaced in `/admin/issues` under "Estimation misses".

When a new `SalesRecord` lands, we compare its `units` to the **prior**
estimate band that pre-dated the record:

```
referenceMoment = record.reportedAt ?? record.capturedAt
priorBand       = latest estimate for (gameId, record.platform) with
                  computedAt < referenceMoment
                  ├── GLOBAL platform → EstimateSnapshot (aggregated headline)
                  └── per-platform   → SalesEstimate row
ratio           = record.units / midpoint(priorBand)
```

If `ratio` falls outside `[DISCREPANCY_RATIO_LOW, DISCREPANCY_RATIO_HIGH]
= [0.5, 2.0]`, we insert one `EstimationDiscrepancy` row. The detector
is **idempotent** thanks to a unique index on `recordId`: each record
produces at most one miss, and re-running the evaluation is a no-op for
records already evaluated.

Crucially the row is **frozen** at insertion:

- `priorEstimateLow/High/At` capture what the model said at the time the
  evidence arrived;
- a later recalibration that aligns the live estimate with the figure
  won't delete or rewrite the miss — the historical error stays as
  evidence of model behaviour at that point in time.

This is intentional vs. the alternative ("just surface live
`agreement = conflict` from the current reconcile"): the live conflict
disappears the moment we recalibrate, which would visually erase the
miss without it actually being explained.

### Constants

| Constant                 | Value | Meaning                                |
| ------------------------ | ----- | -------------------------------------- |
| `DISCREPANCY_RATIO_HIGH` | `2.0` | declared ≥ 2× mid prior estimate → log |
| `DISCREPANCY_RATIO_LOW`  | `0.5` | declared ≤ 0.5× mid prior estimate → log |

---

## 11. What we explicitly don't model (yet)

- **Nintendo Switch** and **Mobile** have no achievement signal and no
  rating signal we trust enough; no estimation runs for them.
- **Bundles / DLC / free weekends** inflate Steam reviews and Exophase
  samples without selling copies; not corrected for.
- **Refunds** are ignored — Steam reports gross.
- **Regional pricing** and **revenue** are out of scope; we estimate
  copies sold, not money earned.
- **Free-to-play** games are skipped entirely (`Game.isFree`).

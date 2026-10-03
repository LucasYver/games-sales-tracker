---
name: diagnose-estimate-divergence
description: >-
  Diagnose why a game's sales estimate diverges from its declared worldwide
  milestone in game-sales-tracker. The headline (estimatedToday) is the
  matcher-driven model sum and is never adjusted by that milestone. Given one
  or more games, recompute Boxleiter, first-week PC, console splits, and the
  aggregate, locate the shared parameter or anchor at fault, and propose a
  fix. Use when the user says an estimate is wrong / "on diverge" / "on est
  loin", passes games to validate against a declared figure, or asks to
  audit/recompute the first-week or Boxleiter estimate.
---

# Diagnose estimate vs declared milestone

Read `ESTIMATION.md` first. It is the contract. This skill is the workflow.

## What the headline is

`estimate_snapshot.estimatedTodayLow/High` is the sum of per-platform
**aggregated** estimates. Declared milestones do **not** floor, cap, or
calibrate it.

There is no `pureEstimatedToday*`, no `calibratedMultiplier*`, and no
`genreProfileId`. Those columns were dropped. Do not query them and do not
propose restoring per-game calibration to "fix" a divergence.

The declared **GLOBAL** milestone (largest `units`, `isEngagement = false`,
`rejectedAt IS NULL`) is the validation truth. The fix target is a **shared**
knob: a constant in `sales-modeling.constants.ts`, a matcher weight, or bad
anchor data. Never a one-game multiplier.

## Inputs

One or more games, ideally the same gameplay family. Each needs a dated
worldwide milestone.

## Workflow

```
- [ ] 1. Pull the stored headline, the declared milestone, and the live breakdown
- [ ] 2. Read the resolved matcher profile (neighbours, shares, ratios)
- [ ] 3. Recompute PC Boxleiter and first-week from that profile
- [ ] 4. Recompute console splits and aggregates
- [ ] 5. Sum platforms and compare to the declared milestone
- [ ] 6. Walk the checklist to locate the fault
- [ ] 7. Propose a shared fix and ask before changing it
```

## Step 1 — Pull data

Read `DATABASE_URL` from `backend/.env`. Never hardcode it.

Prefer `EstimationService.computeBreakdown` (admin
`GET /admin/games/:id/estimate-breakdown`). It already traces signals,
multiplier source (`matcher` or `global`), first-week inputs, splits, and
aggregates. Use SQL when the API is down.

```sql
SELECT "estimatedTodayLow", "estimatedTodayHigh", "computedAt", reconciliation
FROM estimate_snapshot
WHERE "gameId" = '<id>'
ORDER BY "computedAt" DESC
LIMIT 1;

SELECT units, source, platform, "reportedAt", "isEstimate"
FROM milestone
WHERE "gameId" = '<id>'
  AND "rejectedAt" IS NULL
  AND "isEngagement" = false
  AND platform = 'GLOBAL'
ORDER BY units DESC
LIMIT 5;
```

Also fetch `releaseDate`, `platforms`, `genres`, `steamTags`, `developer`,
`franchiseSlug`, `liveService`, `isAnnualIteration`, `dlc`, and the publisher
row. Latest non-synthetic signals: `STEAM_REVIEWS`, `PS_RATINGS`,
`XBOX_RATINGS`.

Launch peak is **not** `STEAM_PEAK_CCU` and **not** a 14-day window. It is
`max(STEAM_CONCURRENT)` from the first day of the PC release month through
`LAUNCH_PEAK_CCU_WINDOW_MONTHS` (2) months later, capped at the as-of date.
See `estimateFirstWeekExtrapolationForPc`.

## Step 2 — Resolve the matcher profile

`SalesProfileResolverService.resolveForGame` is the only profile source.
`USE_MATCHER_PROFILE` defaults to on. `GET /admin/games/:id/matcher` shows
neighbours and feature contributions.

Record: `neighboursUsed`, `reviewsToUnits`, `globalReviewsToUnits`,
`peakCcuRatio`, platform shares, curve `s1` / `a2`, and the resulting
`pcDefaultBoxleiter*`, `psDefaultBoxleiter*`, `peakCcuToWeekOne*`,
`firstWeekToYearOneMultiplier`, `tailFactorY2`, `tailFactorY5`.

`null` profile means the corpus is empty or the flag is off. The estimator
then uses global constants (`PC 25–65`, `PS 40–100`, `Xbox 35–90`, peak-CCU
`3–7`, size-bucket projection).

## Step 3 — Recompute PC

Boxleiter (`estimateForPlatform`). `synthetic = false` only.

```
reviewsLow/High = latest STEAM_REVIEWS × multiplierLow/High
```

`multiplier*` comes from the matcher band when present
(`reviewsToUnits` blended in log space with `globalReviewsToUnits × pcShare`,
then ±25 %). Otherwise `PC_BOXLEITER_DEFAULT_LOW/HIGH` (25 / 65). The method
tag stays `boxleiter-default` either way.

First-week (`estimateFirstWeekExtrapolationForPc`):

```
peak        = max STEAM_CONCURRENT in the launch-month window
weekOne     = peak × peakCcuToWeekOne{Low,High}
projection  = genreProjectionMultiplier(m1, tailY2, tailY5, ageDays)   # matcher
              or firstWeekProjectionMultiplier(weekOneMid, ageDays)    # no profile
projected   = weekOne × projection
abstain outside [5_000, 200_000_000]
```

Below day 7 the projection ramps `ageDays / 7`. Show every intermediate.

## Step 4 — Console and aggregate

Order matters (`aggregateResultsByPlatform`):

1. Aggregate PC (Boxleiter weight `0.5`, first-week weight `0.6`, from
   `estimation_method.defaultWeight`).
2. Split PC → PlayStation: `pc × (playstationShare / pcShare)`.
3. Aggregate PS (PS Boxleiter + that split).
4. Split PS → Xbox when a PS aggregate exists, else PC → Xbox.
5. Aggregate Xbox (split + `xbox-ratings-boxleiter-default` when enabled).

Aggregation (`α = 0.5`):

```
weightedLow/High = Σ(value × weight) / Σ(weight)
disagreement     = (maxMid − minMid) / weightedMid
aggLow           = max(0, weightedLow × (1 − α × disagreement))
aggHigh          = weightedHigh × (1 + α × disagreement)
```

A large gap between Boxleiter and first-week inflates `aggHigh` past both
inputs. That inflation is often the visible overshoot.

Headline high = PC agg + PS agg + Xbox agg. No freshness cap, no declared floor.

## Step 5 — Compare

```
ratio = estimatedTodayHigh / bestGlobalMilestone.units
```

About ×1 is the target. ×0.5–×1.5 can be normal uncertainty. Well above ×2
or below ×0.5 means a shared parameter or a bad anchor, not a display bug.

`totalSales` on the public payload is a different number: the latest-dated
GLOBAL milestone when one exists. Do not compare the UI "reported" total
to the model. Compare `headline` / `estimatedToday`.

## Step 6 — Checklist

```
- [ ] PC release date correct? (wrong age skews the launch window and the projection)
- [ ] Launch-month STEAM_CONCURRENT present? (monthly leak points count; a 14-day window does not)
- [ ] Matcher neighbours actually similar? (gameplay tags, franchise, live-service)
- [ ] peakCcuRatio realistic for this concurrency? (a generic ~30× ratio inflates week-1)
- [ ] reviewsToUnits band realistic versus this genre's known copies-per-review?
- [ ] Platform shares realistic? (wrong shares cascade through both splits)
- [ ] m1 / tails too high or too low for the lifecycle?
- [ ] Disagreement inflation between Boxleiter and first-week?
- [ ] Stale reference_profile row the current gates never rebuilt?
```

Invert a suspicious PC multiplier only as a diagnostic, not as a stored fix:

```
implied = declaredUnits × expectedPcShare / latestReviews
```

## Step 7 — Propose, then ask

State the factor, the observed vs expected value, and the blast radius.

- Matcher weights, `k`, or constants in `sales-modeling.constants.ts` affect
  every similar or uncalibrated game. **Ask before editing.**
- A bad anchor is a data fix (`rebuild:reference-profiles` for that game),
  not a constant tweak.
- After a constant or profile change, rebuild the game
  (`POST /admin/games/:id/rebuild`) before judging the new headline.

## Output template

```markdown
## <Game> — model vs declared

**Declared (truth):** GLOBAL <units> (<source>, <date>)
**Model:** estimatedTodayHigh = <value> → ratio ×<high/declared>
**Profile:** matcher (<n> neighbours) | global constants

### Recompute
peak(launch window) = … ; peakCcu band = … ; weekOne = … ; projection(age=…d, m1=…) = …
first-week = [low, high]
Boxleiter: reviews × [low, high] = [low, high] (source: matcher | global)

PC aggregate (disagreement=…, inflate=…): [low, high]
PS = boxleiter [low, high] + split [low, high] → [low, high]
Xbox split → [low, high]

Model high = PC + PS + Xbox = …

### Diverging factor(s)
- <factor>: <observed> vs <expected>, contributes ×<n>

### Proposed fix
<change> (scope: <family | global | one anchor>) → new high ≈ <…>
```

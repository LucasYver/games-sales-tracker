---
name: diagnose-estimate-divergence
description: >-
  Diagnose why a game's pure-algo sales estimate diverges from its declared
  milestone in the game-sales-tracker model. The pure algo (pureEstimatedTodayLow/High)
  is the model running without any data derived from milestones — it is the
  true measure of model quality. Given one or more games of the same genre
  (PC-only or PC+console), each with a declared milestone, recompute every
  pure-algo factor step by step, quantify the divergence vs the declared figure,
  locate which default parameter is at fault, and propose a fix. Use when the
  user says an estimate is wrong / "on diverge" / "on est loin", passes games
  to validate against a declared figure, or asks to audit/recompute the
  first-week or Boxleiter estimate.
---

# Diagnose pure-algo estimate divergence

## What "pure algo" means — read this first

`pureEstimatedTodayLow/High` (stored in `estimate_snapshot`) is the estimate
computed with **all calibrated multipliers disabled** (`ignoreCalibration: true`
in `computePureAggregatesByPlatform`). It is a raw sum of per-platform
aggregates with **no declared-figure floor, no freshness cap, no reconcile
step** applied.

This is the **only metric that tells us whether the model itself is good**. If
the pure algo lands close to the milestone, the model is sound and the
calibrated + reconciled headline will also be good. If it diverges, the default
parameters must be fixed — never by adjusting `calibratedMultiplier` (that
would make the pure algo circular, defeating its purpose).

The declared milestone is the **validation truth**. The fix target is always a
**shared parameter** (default Boxleiter range, genre profile value, global
constant) — never a per-game calibrated multiplier.

## Inputs

One or more games of the **same genre**. Each must have at least one declared
milestone (the ground truth). Games may be PC-only or PC+console.

## Workflow

```
- [ ] 1. Pull all data for each game from the prod DB
- [ ] 2. Resolve the active genre profile (override vs genre-name)
- [ ] 3. Recompute pure first-week extrapolation step by step
- [ ] 4. Recompute pure Boxleiter + console (default ranges only — NO calibratedMultiplier)
- [ ] 5. Aggregate pure per platform, sum to total (NO reconcile / floor / cap)
- [ ] 6. Compare pureEstimatedTodayLow/High vs declared milestone
- [ ] 7. If diverging, walk the default-parameter checklist to locate the fault
- [ ] 8. Propose a fix on shared/global defaults; ask before changing them
```

## Step 1 — Pull data (read DB)

Read `DATABASE_URL` from `backend/.env` (never hardcode it). Query, per game:
`releaseDate`, `platforms`, `genres`, `genreProfileId`, `genreProfileManual`,
and the signals + milestones + latest `estimate_snapshot`.

Do **not** pull `calibratedMultiplier` — it plays no role in pure-algo
diagnosis. Fetching it just for reference is fine, but never use it in the
pure recomputation.

Key rows to fetch:
- Peak CCU in the launch window: `max(value)` of `STEAM_CONCURRENT` where
  `capturedAt BETWEEN releaseDate AND releaseDate + FIRST_WEEK_PEAK_CCU_WINDOW_DAYS`.
- Reviews near launch: `STEAM_REVIEWS` closest to `releaseDate + 7d` within
  `±FIRST_WEEK_REVIEWS_WINDOW_DAYS`.
- Latest signals: `STEAM_REVIEWS`, `STEAM_PEAK_CCU`, `PS_RATINGS` at `max(capturedAt)`.
- Declared milestones: `milestone WHERE rejectedAt IS NULL` (the validation truth).
- Latest `estimate_snapshot`: `pureEstimatedTodayLow/High` at `max(computedAt)`.

## Step 2 — Resolve the genre profile

The profile is **persisted** on the game (single profile, no blending). It is
auto-assigned at ingestion from the **first** genre (in `genres` order) that
maps to a profile — `GenresService.applyAutoGenreProfile` /
`resolveFirstProfileId` — and stored in `game.genreProfileId`. An admin can pin
a different profile, which sets `genreProfileManual = true` and protects the
value from being overwritten on the next refresh.

`GenresService.resolveProfileForGame` (`backend/src/genres/genres.service.ts`)
reads `game.genreProfileId` first; only when it is null does it fall back to
resolving the first matching genre on the fly. Either way it yields a single
profile via `buildResolvedProfile([profile])`.

Fetch the active profile's: `peakCcuToWeekOneLow/High`, `firstWeekToYearOneMultiplier`
(m1), `year2Retention`, `pcShare`, `playstationShare`, `xboxShare`. Confirm it
is the genre the user expects — if not, check whether `genreProfileManual` is
set (admin pin) or whether the first matching genre is the wrong one.

## Step 3 — Pure first-week extrapolation (recompute)

Source: `estimateFirstWeekExtrapolationForPc`
(`backend/src/estimation/estimation.service.ts`). Constants:
`backend/src/games/sales-modeling.constants.ts`.

This method uses **only CCU and early reviews** — it never touches
`calibratedMultiplier`, so it is naturally pure.

```
peak        = max STEAM_CONCURRENT in [release, release + FIRST_WEEK_PEAK_CCU_WINDOW_DAYS], capped at asOf
ccuScale    = LAUNCHER_CCU_FACTOR[launcherProfile]      (STEAM_DOMINANT = ×1.0)
ccuLow/High = peak × peakCcuToWeekOne{Low,High} × ccuScale{low,high}

reviews     = findReviewsNearLaunch (null if none near launch → reviews branch OFF)
revScale    = LAUNCHER_REVIEWS_FACTOR[launcherProfile]
revLow/High = reviews × FIRST_WEEK_REVIEWS_{LOW,HIGH} × revScale{low,high}

if reviews present:
  combinedMid = (ccuMid + reviewsMid) / 2
  halfSpread  = max(ccuHalfSpread, reviewsHalfSpread)   # widest of the two
  weekOne{Low,High} = combinedMid ∓ halfSpread          # CAN push low below either input's low
else:
  weekOne{Low,High} = ccu{Low,High}

projection  = genreProjectionMultiplier(m1, tailY2, tailY5, ageDays)
projected{Low,High} = weekOne{Low,High} × projection
abstain if outside [FIRST_WEEK_ESTIMATE_MIN_UNITS, FIRST_WEEK_ESTIMATE_MAX_UNITS]
```

Projection curve (`genreProjectionMultiplier` / `buildGenreProjectionCurve`):
anchors `[7,1.0]`, `[30,..]`, `[90,..]`, `[180,..]` (from `GENRE_INTRA_YEAR_SHAPE`),
`[365, m1]`, `[730, m1×tailY2]`, `[1825, m1×tailY5]`, linearly interpolated at
`ageDays`. `tailY2/tailY5` come from `YEAR2_TAIL_FACTOR[year2Retention]`
(`backend/src/genres/genres.service.ts`). Below day 7 it ramps `ageDays/7`.

Show every intermediate number.

## Step 4 — Pure Boxleiter + console (default ranges only)

In pure mode (`ignoreCalibration: true`) `resolveMultiplier` always falls back
to `cfg.defaultLow / cfg.defaultHigh`. **Never use `calibratedMultiplier` here**
— that is what makes this "pure".

Constants from `backend/src/games/sales-modeling.constants.ts`:
```
PC  Boxleiter default: [PC_BOXLEITER_DEFAULT_LOW, PC_BOXLEITER_DEFAULT_HIGH]   (25 / 65)
PS  Boxleiter default: [PS_BOXLEITER_DEFAULT_LOW, PS_BOXLEITER_DEFAULT_HIGH]   (40 / 100)
Xbox Boxleiter default: [XBOX_BOXLEITER_DEFAULT_LOW, XBOX_BOXLEITER_DEFAULT_HIGH] (35 / 90)
```

PC Boxleiter pure (no CCU intersection — peak CCU only feeds the first-week
lifecycle estimate, see Step 3):
```
reviewsLow/High = latest STEAM_REVIEWS × default{Low,High}
finalLow/High   = reviewsLow/High × launcherReviewsFactor{low,high}
```

Console:
- PS Boxleiter pure: `PS_RATINGS × [PS_BOXLEITER_DEFAULT_LOW, PS_BOXLEITER_DEFAULT_HIGH]`
- Genre-console-split (PC → PS, PS → Xbox): uses `playstationShare/pcShare` and
  `xboxShare/playstationShare` from the resolved profile.

## Step 5 — Pure aggregate (no reconcile, no floor, no cap)

Aggregation (`aggregateMethodsForPlatform`) is a **weighted average with
disagreement inflation** (α = `AGGREGATION_DISAGREEMENT_ALPHA = 0.5`).
Effective weight = `method.defaultWeight × AGGREGATION_CONFIDENCE_WEIGHT[confidence]`
where `AGGREGATION_CONFIDENCE_WEIGHT = {LOW: 0.3, MEDIUM: 0.55, HIGH: 1.0}`.

```
weightedLow/High = Σ(result × effectiveWeight) / Σ(effectiveWeight)
disagreement     = (maxMid − minMid) / weightedMid
inflate          = 0.5 × disagreement
aggHigh          = weightedHigh × (1 + inflate)   ← can be >> any individual method's high
aggLow           = max(0, weightedLow × (1 − inflate))
```

**The disagreement inflation is a major amplifier when two methods produce very
different mids** (e.g. Boxleiter default vs first-week). The wider the spread,
the more the aggregate high overshoots.

Pure total = Σ per-platform aggHigh (PC + PS + Xbox, **excluding GLOBAL**).
`pureEstimatedTodayHigh` = this sum.

There is **no reconcile step**, no milestone floor, no freshness cap in the pure
path.

## Step 6 — Compare pure algo vs declared milestone

```
ratio = pureEstimatedTodayHigh / bestDeclaredMilestone
```

Target: ratio ≈ 1 (±30–50% is acceptable given model uncertainty). A ratio
well above 2 or below 0.5 signals a default-parameter problem.

Also check the stored value directly:
```sql
SELECT "pureEstimatedTodayLow", "pureEstimatedTodayHigh", "computedAt"
FROM estimate_snapshot WHERE "gameId" = '<id>'
ORDER BY "computedAt" DESC LIMIT 1;
```

## Step 7 — Locate the fault (default-parameter checklist)

For each game, quantify divergence = `pureHigh / declared`, then test factors
top-down. The fault is always in a **default parameter**, never in
`calibratedMultiplier` (fixing that would make pure algo circular).

```
- [ ] releaseDate correct? (wrong age skews window AND projection)
- [ ] Launch peak CCU captured? (daily STEAM_CONCURRENT present in window;
      CSV import not zeroed/missing; window = FIRST_WEEK_PEAK_CCU_WINDOW_DAYS = 14d)
- [ ] Right genre profile persisted? (`genreProfileId` = expected genre;
      manual pin vs first-matched genre; stale value from before a genre change)
- [ ] peakCcuToWeekOne ratio realistic for this genre's concurrency?
      (if CCU-derived week-1 is already off, everything downstream is off)
- [ ] Launcher factor correct? (STEAM_DOMINANT vs MULTI_STORE/LAUNCHER_PRIMARY
      inflates ×1.4–7 — only fix if publisher is truly multi-store)
- [ ] Reviews-near-launch present & sane? combination dragging the band?
- [ ] Projection multiplier (m1 + tails) — too high/low for the lifecycle?
      (front-loaded viral hits over-project; heavy-tail live-service under-project)
- [ ] PC_BOXLEITER_DEFAULT_LOW/HIGH too wide? (default 25/65 is a broad prior;
      if calibrated games of this genre consistently land at lower multipliers,
      the default range for that genre needs tightening)
- [ ] PS/Xbox default Boxleiter range too wide? same logic as PC
- [ ] Genre platform shares (pcShare/psShare/xboxShare) realistic?
      (wrong shares skew the console splits and cascade into the total)
- [ ] Disagreement inflation cascade: large gap between Boxleiter default
      and first-week? That gap × α = 0.5 inflates the aggregate high beyond
      both individual highs. Narrowing the default range reduces disagreement.
```

Compute the implied "correct" default multiplier by inverting the formula:
```
requiredDefaultHigh = declaredTotal × targetPlatformShare / latestReviews
```
Then compare to the current `PC_BOXLEITER_DEFAULT_HIGH` and the calibrated
multiplier (×1.3) to understand how far off the default is.

## Step 8 — Propose a fix on shared/global defaults

State which default parameter diverges, by how much, and the proposed change.

**Never fix pure-algo divergence by adjusting `calibratedMultiplier`.** That
multiplier is derived from the milestone itself — using it in the pure algo
would mean the milestone is both the input and the validation target, making
the diagnostic meaningless.

Scope rules:
- **Per-game** knob: `genreProfileId` override → safe to set for a specific
  game (assigns a different genre profile whose defaults better fit this title).
- **Shared** knobs (genre profile `m1`/tails/`peakCcuToWeekOne`/shares, global
  constants `PC_BOXLEITER_DEFAULT_*` in `sales-modeling.constants.ts`) → impact
  every game using that profile or every uncalibrated game. **Ask the user** for
  scope (one genre vs all) and target level before editing.

Ship genre-profile changes as a TypeORM migration when persisted in the DB
(`.cursor/rules/typeorm-migrations.mdc`), or note they are admin-editable.
Global constant changes go in `backend/src/games/sales-modeling.constants.ts`
and require a backend redeploy.
After any change, the game must be **rebuilt** (`snapshotReconcile`) to see
new pure snapshots.

## Output template

```markdown
## <Game> — pure algo vs declared

**Declared (truth):** <platform> <units> (<source>, <date>)
**Pure algo:** pureHigh = <value>  → ratio ×<pureHigh/declared>

### Pure recompute (step by step)
peak(window) = … ; ccuBand = … ; reviews = … ; weekOne = … ; projection(age=…d) = … ;
firstWeek projected = [low, high]

Boxleiter default: reviews × [defaultLow, defaultHigh] = […, …]

PC aggregate (weighted, disagreement=…, inflate=…%): [low, high]
PS Boxleiter default: ratings × [defaultLow, defaultHigh] = [low, high]
PS genre-split from PC: [low, high]
PS aggregate: [low, high]
Xbox genre-split from PS: [low, high]

Pure total high = PC + PS + Xbox = …

### Diverging factor(s)
- <factor>: <observed> vs <expected>, contributes ×<n>

### Proposed fix
<change> (scope: <genre | global>) → new pure estimate ≈ <…>
⚠ Do NOT adjust calibratedMultiplier — that would make the pure algo circular.
```

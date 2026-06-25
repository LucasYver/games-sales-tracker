---
name: diagnose-estimate-divergence
description: >-
  Diagnose why a game's sales estimate diverges from its declared figure
  (milestone = ground truth) in the game-sales-tracker model. Given one or
  more games of the same genre (PC-only or PC+console), each with a declared
  milestone, recompute every estimation factor step by step, quantify the
  divergence vs the declared figure, locate which factor is at fault, and
  propose a fix. Use when the user says an estimate is wrong / "on diverge" /
  "on est loin", passes games to validate against a declared figure, or asks
  to audit/recompute the first-week or Boxleiter estimate.
---

# Diagnose estimate divergence

The declared milestone is the **validation truth**. Goal: find if/why our
estimate diverges from it, explain every calculation, and propose an
improvement. The fault can come from **any** factor — check them all.

## Inputs
One or more games of the **same genre**. Each must have at least one declared
milestone (the ground truth). Games may be PC-only or PC+console.

## Workflow

```
- [ ] 1. Pull all data for each game from the prod DB
- [ ] 2. Resolve the active genre profile (override vs genre-name)
- [ ] 3. Recompute first-week extrapolation step by step
- [ ] 4. Recompute Boxleiter + console methods (if relevant)
- [ ] 5. Recompute the reconcile / headline
- [ ] 6. Compare each method + headline vs the declared milestone
- [ ] 7. If diverging, walk the factor checklist to locate the fault
- [ ] 8. Propose a fix; ask before changing shared (genre/global) values
```

## Step 1 — Pull data (read DB)

Read `DATABASE_URL` from `backend/.env` (never hardcode it). Query, per game:
`releaseDate`, `platforms`, `genres`, `genreProfileId`, `calibratedMultiplier`
(+ Ps/Xbox), and the signals + milestones + latest estimates/snapshot.

Key rows to fetch:
- Peak CCU in the launch window: `max(value)` of `STEAM_CONCURRENT` where
  `capturedAt BETWEEN releaseDate AND releaseDate + FIRST_WEEK_PEAK_CCU_WINDOW_DAYS`.
- Reviews near launch: `STEAM_REVIEWS` closest to `releaseDate + 7d` within
  `±FIRST_WEEK_REVIEWS_WINDOW_DAYS`.
- Declared milestones: `milestone WHERE rejectedAt IS NULL` (the validation truth).
- Latest stored estimates: `sales_estimate` at `max(computedAt)`.

## Step 2 — Resolve the genre profile

`GenresService.resolveProfileForGame` (`backend/src/genres/genres.service.ts`):
- If `game.genreProfileId` is set → that profile wins (manual override).
- Else genre-name match → blended via `buildResolvedProfile`.
Fetch the active profile's: `peakCcuToWeekOneLow/High`, `firstWeekToYearOneMultiplier`
(m1), `year2Retention`. Confirm it is the genre the user expects.

## Step 3 — First-week extrapolation (recompute)

Source: `estimateFirstWeekExtrapolationForPc`
(`backend/src/estimation/estimation.service.ts`). Constants:
`backend/src/games/sales-modeling.constants.ts`.

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

Show every intermediate number, then compare `projected{Low,High}` to the
declared PC figure.

## Step 4 — Boxleiter + console (if relevant)

- PC Boxleiter: `calibratedMultiplier × latest STEAM_REVIEWS` (method
  `boxleiter-calibrated…`); `resolveMultiplier` falls back to defaults if not
  calibrated. CCU intersect/conflict adjusts the band.
- Console: `genre-console-split-from-pc-*` (uses genre platform shares) and
  `ps/xbox-ratings-boxleiter-calibrated` (ratings × calibrated multiplier).

## Step 5 — Reconcile / headline

Source: `aggregateSales` + `reconcile` (`backend/src/games/games.service.ts`):
- `bestByPlatform` = highest declared per platform (`isMoreAuthoritative`,
  monotonic — sales only grow).
- Declared figure = floor; `freshnessCap` = upper bound (lifetime-curve aware).
- GLOBAL worldwide milestone anchors the headline (floor + cap).
- PC-marginal guardrail: `isPcMarginal` vs `consoleEvidence` (PS/XBOX declared
  only) with `PC_DOMINANCE_RATIO_THRESHOLD`.
- `classifyAgreement` → strong / weak / conflict per platform.

## Step 6/7 — Locate the fault (check ALL factors)

For each game, quantify divergence = estimate ÷ declared, then test factors
top-down. Any one can be the culprit:

```
- [ ] releaseDate correct? (wrong age skews window AND projection)
- [ ] Launch peak CCU captured? (daily STEAM_CONCURRENT present in window;
      CSV import not zeroed/missing; window 7 vs 14 days)
- [ ] Right genre profile resolved? (override vs genre-name; expected genre)
- [ ] peakCcuToWeekOne ratio realistic for this genre's concurrency?
- [ ] Launcher factor correct? (publisher launcherProfile; STEAM_DOMINANT vs
      MULTI_STORE/LAUNCHER_PRIMARY inflates ×1.4–7)
- [ ] Reviews-near-launch present & sane? combination dragging the low down?
- [ ] Projection multiplier (m1 + tails) — too high/low for the lifecycle?
      (front-loaded viral hits over-project; see action-rpg recalibration)
- [ ] Plausibility caps clipping the result?
- [ ] Boxleiter calibratedMultiplier sane? reviews snapshot current?
- [ ] Console split shares / ratings multipliers reasonable?
- [ ] Reconcile: floor/cap, GLOBAL anchor, PC-marginal guardrail behaving?
```

Compute the implied "correct" value of the suspect factor by inverting the
formula against the declared figure (e.g. required projection = declared ÷
launch-window mid), to size the fix.

## Step 8 — Propose a fix

State which factor diverges, by how much, and the change. Respect scope:
- **Per-game** knobs (genreProfileId override, calibratedMultiplier) → safe to
  set for the specific game.
- **Shared** knobs (genre profile m1/tails/ratios, global constants in
  `sales-modeling.constants.ts`) → impact many games. **Ask the user** for
  scope (one genre vs all) and target level before editing.

Ship genre-profile / constant changes as a TypeORM migration when persisted in
the DB (`.cursor/rules/typeorm-migrations.mdc`), or note they are admin-editable.
After any change, the game must be **rebuilt** to see new snapshots.

## Output template

```markdown
## <Game> — divergence vs declared

**Declared (truth):** <platform> <units> (<source>, <date>)
**Our estimate:** <method/headline> <low>–<high>  → ratio ×<estimate/declared>

### Recompute (step by step)
peak(window) = … ; ccu = … ; reviews = … ; weekOne = … ; projection(age=…) = … ; projected = …

### Diverging factor(s)
- <factor>: <observed> vs <expected>, contributes ×<n>

### Proposed fix
<change> (scope: <per-game | genre | global>) → new estimate ≈ <…>
```

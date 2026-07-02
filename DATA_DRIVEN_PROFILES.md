# Data-driven profiles (Forme C) — working memo

> **Status.** Active: the matcher is the sole profile source
> (`USE_MATCHER_PROFILE` on by default) and the legacy `GenreProfile` has
> been removed. Latest additions: Steam-tags gameplay axis, DLC-tier axis,
> and review-series anchoring. A holdout re-run on the enriched features is
> still recommended to quantify the gain.

This memo tracks the migration from hand-typed `GenreProfile` buckets to
a **similarity-based model (Forme C)**: a game's behaviour is derived
from the observed behaviour of its nearest real neighbours, not assigned
to a predefined genre bucket.

---

## 1. Why we did this

The legacy `GenreProfile` conflates three concerns (platform split,
lifecycle, Boxleiter multipliers), is keyed on **genre** (noisy,
redundant, misleading for sports/annual titles), and was **seeded by
hand and never validated**.

The open question was: *can we even group games correctly?* We made it
**measurable** using the **July 2018 Steam leak** (~585 paid games with
a known PC player count) as ground truth.

### Verdict from the diagnostic (Phase 0)

`GenreProfile` explains only **1.3 %** of the observed variance
(R² = 0.013, rank 15/17) — barely better than random. The best
structural partition, `platforms × playMode`, explains ~7× more. This
empirically justified dropping the discrete genre buckets.

### Verdict from the holdout (Phase 3, first run)

Leave-one-out on the leak, matcher vs `GenreProfile` baseline, median
absolute log-error converted to "×off" (10^logErr):

| Target | Matcher | GenreProfile | Coverage (matcher / baseline) |
|--------|---------|--------------|-------------------------------|
| **reviewsToUnits** (Boxleiter ratio, most important) | **×1.53** | ×3.85 | 320 / 230 games |
| **m1** (S1→A1 curve) | **×1.77** | ×1.96 | 328 / 326 |
| **y2** (year-2 retention) | **×1.22** | ×1.36 | 329 / 327 |

The matcher wins on all three targets **and** covers more games. Note:
MAPE for `reviewsToUnits` is nearly tied (0.70 vs 0.71) because MAPE is
dominated by outliers — we trust the robust median log-error.

---

## 2. Architecture

```
signals + milestones ──► ReferenceProfileService (ETL) ──► reference_profile (observed vectors, anchors)
                                                                    │
target game features ──► MatcherService (kNN) ──────────────────────┤
                                                                    ▼
                        SalesProfileResolverService (matcher-only, flag-gated)
                                                                    ▼
                                                       EstimationService
```

- **Observed vector** (`reference_profile`): only measured quantities,
  **no genre**. `curveS1..A2` (normalised to A1 = 1.0), `reviewsToUnits`,
  `peakCcuRatio`, `platformShare*` (proxy, nullable), `scaleUnits`,
  `qualityScore`.
- **Matching features** (inputs): **gameplay type** (Steam community tags
  when available, else store genres), publisher identity, developer
  identity, scale bucket, platform overlap, **DLC tier** (lifecycle-tail
  proxy), release era, franchise, annual flag, live-service flag, developer
  track-record. Play-mode is a hard filter. **Price was dropped** (no
  reliable per-game coverage).
- **Resolver**: `SalesProfileResolverService` produces the estimation
  profile **solely from the matcher** (the legacy `GenreProfile` has been
  removed). When the corpus yields no anchor (empty/cold-start) it returns
  `null` and the estimator falls back to its global-constant defaults.

---

## 3. What was built

### Phase 0 — Diagnostic (read-only)
- `backend/src/scripts/diagnose-grouping.ts` — computes intra-group
  variance R² per candidate partition vs the genre baseline, on the leak
  targets. `npm run diagnose:grouping`.

### Phase 1 — Reference corpus
- Entity `ReferenceProfile` (`backend/src/entities/reference-profile.entity.ts`).
- Migration `1782670000000-AddReferenceProfile`.
- `ReferenceProfileService` (`backend/src/reference-profiles/reference-profile.service.ts`):
  `rebuildOne(gameId)` / `rebuildAll(limit?)`. Anchor = latest accepted
  worldwide milestone, else leak snapshot, else dropped. Eligibility
  gate + composite `qualityScore`. `npm run rebuild:reference-profiles`.

### Phase 2 — Matcher (kNN)
- `MatcherService` (`backend/src/reference-profiles/matcher.service.ts`):
  hard filter on play-mode + platform overlap, soft similarity weights,
  quality-weighted aggregation (log-space for `reviewsToUnits`), 2-level
  cold-start (relax platforms → global mean).

### Phase 3 — Integration + validation
- `SalesProfileResolverService` (`backend/src/reference-profiles/sales-profile-resolver.service.ts`):
  drop-in replacement for `GenresService.resolveProfileForGame`, gated by
  env `USE_MATCHER_PROFILE`.
- Wired into `EstimationService` at 3 call sites (genre split, PC
  Boxleiter, first-week extrapolation).
- `backend/src/scripts/validate-matcher-holdout.ts` — leave-one-out
  matcher vs baseline. `npm run validate:matcher-holdout`.

### Enrichment — per-game features (latest batch)
- Columns on `game`: `franchiseSlug`, `isAnnualIteration`,
  `iterationNumber`, `liveService`.
  Migration `1782680000000-AddGameFranchiseAndLiveService`.
- Pure derivation helpers `backend/src/games/game-features.ts`
  (`deriveFranchise`, `deriveLiveService`), shared by ingestion
  (`applyDerivedFeatures`, 4 Steam save paths) and the backfill.
- `developerTrackRecord`: computed in the matcher (in-memory index
  `developer → prior >5M / >1M hit`, HIT/MID/NONE/UNKNOWN tiers).
  **Leak-safe** (a game is never its own antecedent; only siblings
  released before it count).
- New diagnostic partitions: `annual`, `liveService`, `franchise`,
  `annual × platforms`, `liveService × playMode`,
  `platforms × playMode × liveService`.

### Enrichment — gameplay type, Steam tags, DLC axis (latest batch)
- **Legacy `GenreProfile` removed** — the matcher is the sole profile
  source; `USE_MATCHER_PROFILE` is **on by default** (set to `false`/`off`
  to emit no profile). `priceTier` and `publisherTier` were dropped.
- **Publisher / developer identity**: replaced the coarse `publisherTier`
  with exact-id publisher match + case-insensitive developer match.
- **Gameplay-type axis** (`gameplayType`): Jaccard over **Steam community
  tags** when both games carry them (finest signal), else store `genres`.
  Column `Game.steamTags` (migration `1782710000000-AddGameSteamTags`),
  scraped from the store page (`SteamClient.getStoreTags`, `InitAppTagModal`).
  SteamSpy was rejected — it returns empty tags for recent/low-traffic games.
- **DLC axis** (`dlcTier`): DLC-count bucket (NONE / FEW 1-4 / SOME 5-14 /
  MANY 15+), a lifecycle-tail proxy — heavily-DLC'd games (Paradox, Sims)
  keep selling for years. Contiguous tiers are close (0.6), UNKNOWN neutral.
- Current similarity weights (sum = 1.0): `gameplayType 0.30`,
  `publisherMatch 0.14`, `developerMatch 0.14`, `scaleBucket 0.09`,
  `platformsOverlap 0.08`, `dlcTier 0.05`, `releaseEra 0.05`,
  `franchise 0.05`, `liveService 0.04`, `devTrackRecord 0.03`,
  `annualIteration 0.03`.

### Data quality — review-series anchoring
- The `STEAM_REVIEWS` reconstruction (`appreviewhistogram`) counts on a
  narrower filter than the daily cron's `getTotalReviews`
  (`purchase_type=all`), so the backfilled history sat below the live
  values (e.g. app 236850: ~101k vs ~137k) — a step up at the
  backfill→cron junction that inflated the calibrated Boxleiter multiplier.
- Fix: `anchorReviewSeriesToLive` rescales the reconstructed series so its
  last point equals the live total (curve **shape** kept, **magnitude**
  aligned). Applied in both review backfill paths (histogram + API).

### Unified Steam backfill
- Single `backfill:steam-metadata` (`backend/src/scripts/backfill-steam-metadata.ts`)
  re-fetches Steam `appdetails` + tags and upserts every Steam-derived
  `Game` column (incl. `steamTags`, `dlc`) plus the re-derived
  franchise / live-service features. Replaces the per-field backfills
  (`backfill-steam-tags`, `backfill-game-features`, both removed).

### First-week `peakCcuRatio` — launch-window fix
- The anchor's `peakCcuRatio = week1Units / launchPeakCCU` used a 14-day
  launch window, but leak-era CCU is stored as one point **per calendar
  month** — so every pre-live-tracking anchor (incl. the whole
  grand-strategy family: EU4, HoI4, Stellaris) silently got `launchPeak = 0`
  → `null` ratio. High-retention targets (EU5) then had no genre-relevant
  neighbour and inherited a corpus-generic ratio ~30, inflating week-1 by
  ~5×.
- Fix in `computePeakCcuRatio` (`reference-profile.service.ts`):
  - **Launch window = launch month + the following one**
    (`LAUNCH_CCU_WINDOW_MONTHS`), aligned to the monthly leak granularity;
    works for daily live series too. Family now anchors (EU4 0.73, HoI4 1.10,
    Stellaris 3.37).
  - **Representativeness gate**: drop when `launchPeak < 15%` of the game's
    all-time peak (re-releases / late-blooming free titles whose launch never
    captured the real peak — e.g. The Descendant 18 CCU at launch vs 126k
    later).
  - **Physical cap** `MAX_PEAK_CCU_RATIO = 60`: guards against
    franchise-contaminated `scaleUnits` (e.g. a GOTY edition inheriting 14M
    units over a 200-CCU re-release).
- The reviews-based `week1Units` is a **within-game shape ratio**
  (`week1Reviews / reviewsAtMilestone`) in which the review-rate era cancels,
  so — unlike Boxleiter's `reviewsToUnits` — `peakCcuRatio` is **not**
  era-normalised.
- Result: EU5 resolved `peakCcuToWeekOne` 30 → **6.76**, first-week estimate
  3.67–6.82M → **0.94–1.75M**, aggregate 0.96–1.72M (real ≈ 980k), method
  disagreement 1.7%.
- Known gap: `rebuildAll` only visits current candidates (milestone w/
  `reportedAt` or leak signal); anchors that fell out of that set keep a
  **stale** row the new gate/cap never re-applies (6 rows, incl. Borderlands
  GOTY at 66097). Pruning non-candidate rows in `rebuildAll` is a follow-up.

---

## 4. File map

| File | Role |
|------|------|
| `backend/src/entities/reference-profile.entity.ts` | Observed vector table |
| `backend/src/entities/game.entity.ts` | + franchise / annual / liveService / steamTags columns |
| `backend/src/games/game-features.ts` | Pure franchise + live-service derivation |
| `backend/src/ingestion/steam.client.ts` | Steam client (+ `getStoreTags` tag scrape) |
| `backend/src/reference-profiles/reference-profile.service.ts` | ETL (anchor build) |
| `backend/src/reference-profiles/matcher.service.ts` | kNN matcher + track-record index |
| `backend/src/reference-profiles/sales-profile-resolver.service.ts` | Matcher-only profile facade (flag-gated) |
| `backend/src/reference-profiles/reference-profiles.module.ts` | DI wiring |
| `backend/src/scripts/diagnose-grouping.ts` | Phase 0 diagnostic |
| `backend/src/scripts/rebuild-reference-profiles.ts` | Corpus batch rebuild |
| `backend/src/scripts/backfill-steam-metadata.ts` | Unified Steam metadata + tags backfill |
| `backend/src/scripts/validate-matcher-holdout.ts` | Holdout validation |
| `backend/src/db/migrations/1782670000000-AddReferenceProfile.ts` | reference_profile table |
| `backend/src/db/migrations/1782680000000-AddGameFranchiseAndLiveService.ts` | game feature columns |
| `backend/src/db/migrations/1782710000000-AddGameSteamTags.ts` | game.steamTags column |

---

## 5. How to run (order matters)

```bash
cd backend
npm run migration:run                          # apply all migrations (incl. steamTags)
npm run backfill:steam-metadata                # refetch Steam appdetails+tags, upsert all Steam columns (+ derived features)
npm run rebuild:reference-profiles             # materialise anchors (reads the fresh tags/dlc)
npm run diagnose:grouping                      # R² of partitions
npm run validate:matcher-holdout               # Forme C holdout on the leak
```

`USE_MATCHER_PROFILE` is **on by default** — set it to `false`/`off` in the
backend env to disable the matcher (estimator then uses global constants).

---

## 6. Decisions & assumptions

- `iterationNumber`: best-effort from the title, `null` otherwise. Not a
  matching key.
- `developerTrackRecord`: computed on the fly (not stored) to avoid
  staleness when milestones change.
- `liveService`: conservative (explicit MMO category + curated name set)
  to avoid false positives from heavy-DLC packaged games. Extensible.
- Similarity weights: hand-set from the Phase 0 diagnostic. **Not yet
  fitted** on the leak.
- Platform split (`platformShare*`): proxy from cross-platform rating
  counters, **not validated by the leak** (PC-only). Least trustworthy
  part of the vector.

---

## 7. What's left to do

**Immediate (this iteration)**
- [ ] Run the sequence in §5 and capture the new
      `scripts/.validate-matcher-holdout.json`.
- [ ] Compare enriched matcher vs the numbers in §1 — expect the biggest
      gain on `m1` (franchise/annual) and `y2` (live-service).

**Data enrichment (agreed direction: sourcing over time)**
- [ ] Source post-2018 milestones progressively (IR reports, GameDiscoverCo,
      Wikipedia). Feeds the ETL automatically at the next rebuild — no
      code change. This is the single biggest lever (neutralises the leak's
      survivor bias + the `releaseEra` observation bias).
- [x] Steam fine-grained tags — done (gameplay-type axis).
- [ ] Optional later feature: launch price (vs current price).

**Model hardening (later)**
- [ ] Fit similarity weights + neighbourhood `k` on the leak (supervised
      light step) instead of hand-setting them.
- [ ] Leave-one-out outlier detection to down-weight suspicious anchors.
- [ ] Monitor the platform-split proxy separately (not leak-validated).

**Activation**
- [ ] Flip `USE_MATCHER_PROFILE=true` only after a measured holdout gain.
- [ ] Keep `GenreProfile` as the cold-start fallback for several months.

---

## 8. Known limitations

- **Survivor bias**: the leak is ~585 paid hits ≥ 500k players, all
  pre-2018. The matcher generalises well on the mid-to-high market; obscure
  / sub-500k / post-2018 / console-only games fall back to cold-start.
- **`releaseEra`** looks powerful on `m1`/`y2` but is largely an artefact
  of the fixed 2018 observation window — treated as a low-weight soft
  feature.
- **`scaleBucket`** leaks information in the diagnostic (computed from
  leak players); in production it needs a `scaleHint` from a first
  estimation pass, otherwise its contribution is lost.
- R² ceiling is low (~0.15) — there's real irreducible per-game noise;
  the continuous kNN is expected to beat any hard partition.

---

## 9. Reference

Plan file: `~/.cursor/plans/data-driven-profiles_42466fe6.plan.md`
(do not edit — historical record of the agreed plan).

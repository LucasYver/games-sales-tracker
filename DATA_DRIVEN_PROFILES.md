# Data-driven profiles (Forme C) — working memo

> **Status.** Code complete and type/lint clean. Not yet activated in
> production (`USE_MATCHER_PROFILE` off by default). Awaiting the
> enriched-features holdout re-run before deciding to switch on.

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
                        SalesProfileResolverService (overlay on GenreProfile baseline)
                                                                    ▼
                                                       EstimationService
```

- **Observed vector** (`reference_profile`): only measured quantities,
  **no genre**. `curveS1..A2` (normalised to A1 = 1.0), `reviewsToUnits`,
  `platformShare*` (proxy, nullable), `scaleUnits`, `qualityScore`.
- **Matching features** (inputs): platforms, play-mode, price tier,
  publisher tier, release era, scale bucket, **franchise, annual flag,
  live-service flag, developer track-record**. Genre survives only if it
  proves useful — the diagnostic decides.
- **Overlay**: the resolver keeps the `GenreProfile` value for fields the
  observed vector doesn't measure (peak-CCU ratio, lifecycle index, PS
  Boxleiter), and overrides the rest when a non-cold-start match exists.

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
- Similarity weights rebalanced: `platformsOverlap 0.26`,
  `scaleBucket 0.16`, `franchise 0.14`, `liveService 0.09`,
  `devTrackRecord 0.08`, `priceTier 0.08`, `annualIteration 0.07`,
  `publisherTier 0.06`, `releaseEra 0.06`.
- New diagnostic partitions: `annual`, `liveService`, `franchise`,
  `annual × platforms`, `liveService × playMode`,
  `platforms × playMode × liveService`.
- Backfill script `backend/src/scripts/backfill-game-features.ts`
  (`npm run backfill:game-features`, supports `--dry-run` / `--limit`).

---

## 4. File map

| File | Role |
|------|------|
| `backend/src/entities/reference-profile.entity.ts` | Observed vector table |
| `backend/src/entities/game.entity.ts` | + franchise / annual / liveService columns |
| `backend/src/games/game-features.ts` | Pure franchise + live-service derivation |
| `backend/src/reference-profiles/reference-profile.service.ts` | ETL (anchor build) |
| `backend/src/reference-profiles/matcher.service.ts` | kNN matcher + track-record index |
| `backend/src/reference-profiles/sales-profile-resolver.service.ts` | Overlay facade (flag-gated) |
| `backend/src/reference-profiles/reference-profiles.module.ts` | DI wiring |
| `backend/src/scripts/diagnose-grouping.ts` | Phase 0 diagnostic |
| `backend/src/scripts/rebuild-reference-profiles.ts` | Corpus batch rebuild |
| `backend/src/scripts/backfill-game-features.ts` | Franchise/live-service backfill |
| `backend/src/scripts/validate-matcher-holdout.ts` | Holdout validation |
| `backend/src/db/migrations/1782670000000-AddReferenceProfile.ts` | reference_profile table |
| `backend/src/db/migrations/1782680000000-AddGameFranchiseAndLiveService.ts` | game feature columns |

---

## 5. How to run (order matters)

```bash
cd backend
npm run migration:run                          # apply both migrations
npm run backfill:game-features -- --dry-run    # sanity-check franchise/annual/liveService counts
npm run backfill:game-features                 # write features
npm run rebuild:reference-profiles             # materialise anchors
npm run diagnose:grouping                      # R² of new partitions
npm run validate:matcher-holdout               # Forme C vs baseline
```

To activate in production once the holdout confirms a gain:
set `USE_MATCHER_PROFILE=true` in the backend env.

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
- [ ] Optional later features: launch price (vs current price), Steam
      fine-grained tags.

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

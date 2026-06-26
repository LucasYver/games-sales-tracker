# Backlog

Roadmap of improvements not yet implemented, in rough priority order.

## Cross-game calibration (cluster-level priors)

Today, calibration is strictly per-game: a `calibratedMultiplier` is only
derived when *this title* has its own OFFICIAL/MEDIA declared figure with a
contemporaneous signal snapshot. Games without a declared figure fall back
to the static default range, which is the widest one.

Vendors like Alinea Analytics get tighter estimates by also calibrating
*across* comparable games (cluster-level priors): a fresh indie strategy
game at $19.99 doesn't have its own milestone yet, but the average
review-to-sales multiplier across other indie strategy games at $19.99 is a
much better prior than the generic 25-70× band.

Implementation sketch:
1. Materialize per-game features already on `Game` (genre, price tier, age
   band, platform mix, publisher tier) as queryable columns/indices.
2. For each (signal_metric × platform), fit a multiplier prior from the
   distribution of calibrated multipliers observed in the most relevant
   cluster (start with `genre × price_tier × platform_mix`, extend with a
   GBM/regression once enough OFFICIAL rows are available).
3. Use the cluster prior instead of the static default range when a per-
   game OFFICIAL figure is missing. Per-game calibration still wins when
   available — clusters fill the gap, they do not override.
4. Same treatment for the first-week peak-CCU → week-1 ratio (currently the
   genre-profile `peakCcuToWeekOne{Low,High}`, falling back to
   `FIRST_WEEK_PEAK_CCU_LOW/HIGH` in `sales-modeling.constants.ts`).

Pre-requisite: enough OFFICIAL data points to fit each cluster prior,
which mostly depends on the publisher IR pipeline below landing first.

## Publisher IR / Earnings parsers — calibration ground truth

Parse the official quarterly sales numbers that publishers release. Each
parsed figure lands in `SalesRecord` with `source = OFFICIAL`, which is
already the highest-confidence tier used by `EstimationService` for
multiplier recalibration. This is what will let us turn the
achievement-based estimation from "rough" to "actually accurate" by
pinning the Exophase coverage and sample-bias constants to real numbers.

### Tier 1 — Japanese publishers (very predictable formats)

These all publish on a quarterly cadence, in stable formats, often as the
same page updated every quarter.

- **Capcom — Platinum Titles**. HTML table at
  <https://www.capcom.co.jp/ir/english/finance/million.html>. Lifetime
  units sold for every title that has crossed 1M.
- **Square Enix — Top Selling Titles**. PDF in each quarterly results,
  listed on <https://www.hd.square-enix.com/eng/ir/library/index.html>.
- **Bandai Namco — IP franchise sales**. PDF in each quarterly IR pack.
- **Sega Sammy — full-game IP sales**. PDF in quarterly results.

### Tier 2 — Western publishers (less structured)

Numbers appear in earnings call transcripts / decks rather than as a
stable table. Will likely need an LLM extraction pass on the IR PDFs.

- Take-Two (GTA / RDR / NBA 2K series)
- Electronic Arts (FIFA / Apex / Battlefield)
- Ubisoft (Assassin's Creed / Far Cry / Rainbow Six)
- Embracer (deeply nested — each sub-group reports separately)

### Implementation notes

- New `SalesSource` already exists (`OFFICIAL`); no schema change needed.
- Need a name → `gameId` resolver (same heuristics as the Wikipedia
  pipeline, plus IGDB name fallback).
- Probably a new cron `discover-earnings` running monthly (IR is
  quarterly but staggered between publishers).
- Once one publisher pipeline works end-to-end, the rest mostly differs
  by parser (HTML / PDF) and naming heuristics.

## Re-enable achievement-based estimation (currently dormant)

The achievement-based estimate (`EstimationService.estimateFromAchievementsForPlatform`)
is intentionally **not called** from `estimateAllPlatforms` today: the
coverage constants are uncalibrated guesses and produce too much noise
against the Boxleiter estimate. The scraping pipeline still runs on
every refresh, so `achievement_snapshot` keeps accumulating per-game
data ready to be used.

Reactivation plan:
1. Land the publisher IR / earnings pipeline above so we have OFFICIAL
   ground truth.
2. Calibrate `EXOPHASE_COVERAGE_*_LOW/HIGH` per game (and per platform)
   against the declared figures, exactly the way `calibratedMultiplier`
   works today for the Boxleiter signals — extend
   `EstimationService.recalibrate*` accordingly.
3. Uncomment the `estimateFromAchievementsForPlatform` call in
   `estimateAllPlatforms` and remove the dormant marker from `ESTIMATION.md` §2.

## Other achievement sources to consider later

- **Steam Achievement Stats** (steamachievementstats.com) — sometimes
  exposes absolute counts but currently times out on direct fetch; might
  be revisited if Exophase coverage gets shaky.
- **TrueAchievements** (Xbox) — Cloudflare-protected (HTTP 402 on direct
  fetch), would require a headless browser; not worth the runtime cost
  while Exophase covers Xbox.
- **PSNProfiles** (PS) — partially scrapable (`/trophies/` works,
  `/game/` returns 403); Exophase already covers PSN well enough.

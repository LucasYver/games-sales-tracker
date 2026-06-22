# Backlog

Roadmap of improvements not yet implemented, in rough priority order.

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

## Calibrate Exophase coverage / bias from publisher figures

Today the achievement-based estimation uses **rough default coverage
constants** in `sales-modeling.constants.ts`
(`EXOPHASE_COVERAGE_*_LOW/HIGH`). Once the earnings pipeline above feeds
`SalesRecord(source = OFFICIAL)` rows, extend `EstimationService.recalibrate*`
to also fit the Exophase coverage per game (and per platform) against the
declared figures, exactly the way `calibratedMultiplier` works today for
the Boxleiter signals.

## Other achievement sources to consider later

- **Steam Achievement Stats** (steamachievementstats.com) — sometimes
  exposes absolute counts but currently times out on direct fetch; might
  be revisited if Exophase coverage gets shaky.
- **TrueAchievements** (Xbox) — Cloudflare-protected (HTTP 402 on direct
  fetch), would require a headless browser; not worth the runtime cost
  while Exophase covers Xbox.
- **PSNProfiles** (PS) — partially scrapable (`/trophies/` works,
  `/game/` returns 403); Exophase already covers PSN well enough.

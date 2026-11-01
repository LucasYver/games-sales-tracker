---
name: research-sales-figures
description: >-
  Research missing game sales figures by hand, verify every one, and write them
  to the game-sales-tracker database, tier by tier. Use when the user says
  "continue", "reprends", "tranche suivante", or asks to search for sales
  figures, chiffres de ventes, milestones or worldwide and per-platform figures
  for CORE games without one. Holds the progress table, which must be updated
  after every tier or wave. Not for the harvest cron (see
  debug-ingestion-pipeline).
---

# Research missing sales figures by hand

The owner wants real worldwide figures, and per-platform ones too, for CORE paid
games released since 2017 that have no worldwide figure. Research happens in the
conversation, without waiting for the harvest cron.

**A missing figure is better than a doubtful one.** The owner said so explicitly.

## Progress

Update this table at the end of every wave, before reporting. It is how the next
session knows where to resume.

| Tranche | Steam reviews | Games searched | Games with a figure | Figures written | Status |
|---|---|---:|---:|---:|---|
| `essai-20` | largest, no figure at all | 20 | 8 | 12 | Done, without platform searches |
| `t1-50k` | 50,000+ | 105 | 21 | 31 | Done, few platform searches |
| `t2-20k-50k-a` | 29,000 to 50,000 | 105 | 15 | 20 | Cut off at 200 searches, 22 games not searched |
| `t2-20k-50k-b` | 20,000 to 50,000 | 50 | 4 | 4 | Done, 166 searches, no cutoff; 2 of the 4 games were already in base |
| `t2-20k-50k-c` | 20,000 to 50,000 | 0 | 0 | 0 | **Next: run `prepare`. 159 left: 139 never searched, 20 searched too few times** |

After that tier: 10,000 to 20,000 reviews (366 games), then the rest.

## Resume

From `ml/`, with `<tranche>` as the next name in the table.

1. **Check the quota** with `mcp__ccd_session_mgmt__get_usage`. A wave of 50 games
   took 20% of the 5-hour limit and 4% of the weekly limit on Pro (`t2-20k-50k-b`,
   review included). Do not
   start one that would cross either limit: running agents would stop midway. Say
   when the window resets and stop.
2. **Prepare the batches.** Skip this if the table says they are ready.

   ```bash
   .venv/bin/python research_figures.py prepare <tranche> --min-reviews 20000 --max-reviews 50000
   ```

   It picks games never searched, or searched fewer times than needed (4 on
   console, 2 on PC only), most reviewed first, in 5 batches of 10.
3. **Launch one agent per batch**, in the background, `general-purpose` with
   `model: sonnet`. The prompt is `agent-prompt.md`, with `{FOLDER}` set to the
   absolute path of `ml/reports/research/<tranche>` and `{N}` to the batch number.
   Wait for all of them.
4. **Re-check every quote outside the model.** This re-fetches each page and flags
   a missing quote, number or game, or a blocked host.

   ```bash
   .venv/bin/python research_figures.py check <tranche>
   ```

5. **Review every figure yourself** against the traps below. Read the text around
   any doubtful one. A flag can be a false alarm (Japanese or Polish number
   formats, sites that refuse scripts), so confirm with `WebFetch` before dropping.
6. **Record the review** in `ml/reports/research/<tranche>/decisions.json`, using
   the format in the docstring of `apply` in `research_figures.py`: figures to
   skip with a reason, and platform or date corrections.
7. **Dry-run, then write.**

   ```bash
   .venv/bin/python research_figures.py apply <tranche>
   ```

   ```bash
   .venv/bin/python research_figures.py apply <tranche> --commit
   ```

   This also updates `searched_games.csv`.
8. **Update the Progress table and report**: what was added, what was skipped and
   why, the quota used, and how far the search got.

## Review traps

All of these happened on real figures:

- **Thresholds, not figures.** "11 games sold over 10 million" says nothing precise
  about any one game.
- **Mobile or DLC inside a total.** A game with a mobile version needs a source that
  lists its platforms. DayZ's 5.8 M counted DLC, so its 4 M was used instead.
- **Another game's number.** A Famitsu caption about Backpack Battles looked like a
  MiSide figure. Check the sentence names this exact title.
- **Pre-launch or partial counts.** Phantom Blade 0's 850,000 was an Alinea estimate
  before launch, with no WeGame sales.
- **Retracted or spam figures.** Battlefield 2042's 4.23 M was walked back by its
  own source, and its 20.5 M came from a content farm.
- **Period figures.** A sentence "over the year" is cumulative only if the game
  launched within that year.
- **Sell-in.** Take-Two's "sold in" means shipped to retailers. It is official and
  accepted; say so in the report.
- **Weak relays.** An unattributed figure can come from an estimator: Last Epoch's
  2.5 M matches a VG Insights figure reported elsewhere.

## Rules for writing

- **Platform.** A figure tied to Steam or PC goes on `PC`. A total that names no
  store goes on `GLOBAL` only if the game was on PC alone at that date; check it. A
  combined "PS4 and Xbox" figure is refused.
- **Never set `isEstimate`.** Only sourced figures get written. Alinea and Rhys
  Elliott count as data (`alinea-milestones`), other estimators are refused.
- **Blocked hosts stay blocked**: `trusted_source` rows with `active=false`, and
  `TAVILY_EXCLUDED_DOMAINS`. `prepare` writes the list and `apply` refuses them.
- **Players and downloads are not written** by this workflow. They stay in the
  `engagement` field of the results.
- **No backfill or rebuild** afterwards: `let-crons-catch-up`. Estimates pick up the
  figures at their next pass.
- **No bench or retraining** as part of this. The ML work is a separate decision.
- **The catalog date is often a Steam port or a 1.0 date.** Early-access figures
  and console-era figures can predate it. Keep them, and flag games really released
  before 2017 (`estimate-scope-2017`) in the report. Do not change the catalog here.

## Limits measured

- **Web search stopped at exactly 200 searches** shared across 5 agents in one wave,
  while an earlier wave reported 202. The cause is unknown. This is why a wave is 50
  games, not 105. The 50-game wave `t2-20k-50k-b` used 166 searches and was not cut off.
- **Yield** falls as games get smaller: 40% of the first 20, 20% at 50,000+ reviews,
  18% of those really searched at 29,000 to 50,000, then 8% (4 of 50) at 20,000 to
  50,000, where most finds were old console games (Heavy Rain, Beyond: Two Souls).
- **Platform figures are rare**: 4 console figures in 230 games, then 2 PlayStation
  figures in `t2-20k-50k-b`, where 39 of 50 games got all their searches. Console
  searches mostly surface Alinea relays or nothing.
- **Games with one console family** (Heavy Rain, AI Limit: no Xbox version) can only
  reach 3 searches, so `prepare` keeps picking them again. Agents also sometimes
  search PlayStation and Xbox in one query, which counts as one search.

## Files

| File | Role |
|---|---|
| `ml/research_figures.py` | `prepare`, `check` and `apply` |
| `agent-prompt.md` | Prompt for the research agents |
| `searched_games.csv` | One row per game searched, tracked in git |
| `ml/reports/research/<tranche>/` | Batches, results, review, `applied.csv` (ignored by git) |

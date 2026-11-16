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
| `t2-20k-50k-c` | 20,000 to 50,000 | 50 | 6 | 5 | Done, 167 searches, no cutoff; UBoat skipped (blocked host) |
| `t2-20k-50k-d` | 20,000 to 50,000 | 50 | 10 | 12 | Done, 157 searches, no cutoff; Squad 44 skipped (figures were for Squad) |
| `t2-20k-50k-e` | 20,000 to 50,000 | 50 | 10 | 12 | Done, 161 searches, no cutoff; Hardspace and one Townscaper figure skipped |
| `t2-20k-50k-f` | 18,955 to 50,000 (last 19 of the tier + 31 of the next) | 50 | 7 | 9 | Done, 130 searches; rate limits (`too_many_requests`) on some, those games come back; SAO Fatal Bullet and Battlefield 3 (2011) skipped |
| `t3-10k-20k-a` | 10,000 to 20,000, most reviewed first | 50 | 3 | 3 | Done, 116 searches; 15 games got only 1 search (agents skipped the platform searches); CrossCode and 911 Operator skipped |
| `t3-10k-20k-b` | 10,000 to 20,000, most reviewed first | 50 | 2 | 2 | Done, 108 searches; rate limits again, 14 games got 1 search; Magicraft skipped (mobile may be included) |
| `t3-10k-20k-c` | 10,000 to 20,000, most reviewed first | 50 | 5 | 5 | Done, 180 searches, no rate limit; The Culling (2016) skipped; SAO Fatal Bullet and The Culling marked done |
| `t3-10k-20k-d` | 10,000 to 20,000, most reviewed first | 30 | 2 | 2 | Done, 96 searches, reduced to 30 games to stay under the 5-hour limit |
| `t3-10k-20k-e` | 10,000 to 50,000, most reviewed first | 50 | 8 | 7 | Done, 92 searches; rate limits again, 19 games got 1 search and most console searches were skipped; Absolver skipped (unattributed) |
| `t3-10k-20k-f` | 10,000 to 50,000, retries first | 50 | 3 | 1 | Done, 96 searches, no rate limit: agents given only the prompt's path did shallow passes (20 games at 1 search); Nova Drift and Road Redemption skipped |
| `t3-10k-20k-g` | 10,000 to 50,000, retries first | 50 | 3 | 2 | Done, 177 searches, 38 games got their full budget once the full prompt was pasted in with the "run the full budget" line; Absolver skipped a third time |
| `t3-10k-20k-h` | 10,000 to 50,000, retries first | 50 | 4 | 4 | Done, 154 searches, every game got its full budget, no rate limit |
| `t3-10k-20k-i` | 10,000 to 50,000, retries first | 50 | 5 | 5 | Done, 165 searches, no rate limit; Everspace 2 M skipped (series or first game, ambiguous) |
| `t3-10k-20k-j` | 10,000 to 50,000, retries first | 20 | 2 | 2 | Done, 58 searches, reduced to 20 games to stay under the 5-hour limit |
| `t4-5k-50k-a` | 5,000 to 50,000 (last 39 above 10,000 first) | 50 | 6 | 5 | Done, 157 searches, no rate limit; West of Loathing skipped (unattributed) |
| `t4-5k-50k-b` | 5,000 to 50,000, retries first | 50 | 5 | 4 | Done, 156 searches, no rate limit; Berry Bury Berry already in base |
| `t4-5k-50k-c` | 5,000 to 50,000, retries first | 50 | 1 | 0 | Done, 147 searches, no rate limit; the only figure (INDIKA) was already in base |
| `t4-5k-50k-d` | 5,000 to 50,000, retries first | 30 | 0 | 0 | Done, 98 searches, no rate limit; nothing citable, reduced to 30 games to stop at 80% |
| `t4-5k-50k-e` | 5,000 to 50,000, retries first | 50 | 6 | 7 | Done, 162 searches, no rate limit; Dragonwilds 1.5M (rejected before), Gorn (weak relay, blocked host) and Dragon Age II (2011, marked done) skipped |
| `t4-5k-50k-f` | 5,000 to 50,000, retries first | 50 | 2 | 2 | Done, 158 searches, no rate limit; Gorn skipped again and marked done, Unfortunate Spacemen (2016) marked done |
| `t4-5k-50k-g` | 5,000 to 50,000, retries first | 50 | 4 | 5 | Done, 155 searches, no rate limit; Passpartout 1M skipped (also on iOS and Android) |
| `t4-5k-50k-h` | 5,000 to 50,000, retries first | 50 | 4 | 4 | Done, 157 searches, no rate limit; batches 2, 3 and 5 found nothing; Airships (early access 2015) kept |
| `t4-5k-50k-i` | 5,000 to 50,000, retries first | 50 | 1 | 1 | Done, 150 searches, no rate limit; Halo: Reach (2010) marked done |
| `t4-5k-50k-j` | 5,000 to 50,000, retries first | 50 | 1 | 1 | Done, 160 searches, no rate limit; Unravel (2016) marked done |
| `t4-5k-50k-k` | 5,000 to 50,000, retries first | 50 | 3 | 4 | Done, 166 searches; Mr. Prepper found in review (PlayWay via spidersweb.pl); Spilled! skipped (only relays on blocked hosts); Battlefield Hardline (2015) marked done |
| `t4-5k-50k-l` | 5,000 to 50,000, last 46 | 46 | 5 | 5 | Done, 156 searches; the 5,000 to 50,000 tier is exhausted |
| `t5-0-5k-a` | every game under 5,000 reviews, plus 17 with no Steam review count (`--include-unreviewed`) | 35 | 6 | 4 | Done, 127 searches, no rate limit; College Football 27 and Little Witch in the Woods already in base; Halo 4, The Unfinished Swan, Titanfall (pre-2017), Honkai: Star Rail, Dauntless, Goals, Morimens, Age of Empires III: DE (free to play) marked done |
| `t6-retry-a` | the first waves' games still short of their searches, most reviewed first | 50 | 2 | 2 | Done, 186 searches, no rate limit; Battlefront II 7 M (EA earnings call, added in review) and Golf With Your Friends; Sea of Thieves skipped (2 M was players), CarX skipped (blocked host) |
| `t6-retry-b` | the last 23 of them | 23 | 0 | 0 | Done, 82 searches; They Are Billions skipped (unattributed), Graveyard Keeper 4 M only on a blocked host. **Every game without a worldwide figure has now had its full budget or is marked out of scope (pre-2017, free to play)** |
| `src-pilot-a` | source-first pilot: Polish stock-exchange reports, developer postmortems, Western indie publishers | 35 matched | 23 | 24 | Done, 48 searches and about 67 page opens for 3 agents, about 17% of the 5-hour quota with the review; 18 more figures were already in base. Mostly 5,000 to 50,000 reviews: published figures are for hits, true small games stay rare |
| `src-b` | source-first: deeper dev case studies, listed publishers (CI Games, Remedy, Creepy Jar), milestone press releases | 48 matched | 25 | 27 | Done, 52 searches; 31 more were already in base (mostly Alinea posts, already imported). Half the new figures went to games with 10,000 to 30,000 reviews. Skipped: Stacklands ('about'), Balatro (mobile), Abiotic Factor (scope unclear). |
| `src-c` | social-network test: studio posts on LinkedIn, X, Bluesky | 0 | 0 | 0 | Done, 7 searches. A public LinkedIn post reads without login, and its exact date is `(activity id >> 22)` in ms. But web search returns profiles, never posts, so posts cannot be found. X answers 402 without login and Bluesky renders nothing: do not retry. Their figures arrive only through press relays, or as links the owner pastes |
| `x-pilot-a` | X official API (pay-per-use, `ml/x_search.py`), 20 indie games with no figure, 3,000 to 15,000 reviews | 20 | 2 | 0 | 132 posts read, about $0.67. Found Friends vs Friends 150,000 in 5 days (Raw Fury CEO) and Everhood over 600,000 (its PR agency). Not written: x.com is in the excluded domains (`ingestion.service.ts`), waiting for the owner. Most posts are noise (giveaways, physical editions, unrelated words): about $0.30 per figure. Without `start_time` the API only searches the last 30 days |

After that: every game without a worldwide figure has had its full search budget. New games enter through discovery; rerun `prepare` with `--min-reviews 0 --include-unreviewed` now and then.

## Resume

From `ml/`, with `<tranche>` as the next name in the table.

1. **Check the quota** with `mcp__ccd_session_mgmt__get_usage`. A wave of 50 games
   took 19 to 20% of the 5-hour limit and 2 to 4% of the weekly limit on Pro
   (`t2-20k-50k-b` and `-c`, review included). Do not
   start one that would cross either limit: running agents would stop midway. Say
   when the window resets and stop.
2. **Prepare the batches.** Skip this if the table says they are ready.

   ```bash
   .venv/bin/python research_figures.py prepare <tranche> --min-reviews 20000 --max-reviews 50000
   ```

   It picks games searched fewer times than needed (4 on console, 2 on PC only)
   first, so games cut off by a rate limit come back in the next wave, then games
   never searched, most reviewed first, in 5 batches of 10.
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

## Source-first harvest

Game by game, yield fell to about 2% (2 figures in 73 big games). Starting from
sources that publish many figures, then matching them to the catalog, gave 24 new
figures for 48 searches in `src-pilot-a`, CORE and EXTENDED alike.

1. Make the folder `ml/reports/research/<tranche>/`, copy `blocked_hosts.txt` from
   the last wave, and write `catalog_titles.txt` (every paid game since 2017, one
   name per line).
2. Launch one agent per source family with `source-prompt.md`, the full text
   pasted in, `{SOURCE}` describing the family, `{FOLDER}` and `{N}` filled. Each
   writes `harvest_<N>.json`.
3. `research_figures.py import-harvest <tranche>` matches each title to one
   catalog game and writes `batch_1.json` and `result_1.json`.
4. Then `check`, the review, `decisions.json` and `apply` as for a wave.

Families that worked: Polish ESPI reports relayed by parkiet.com (exact units per
platform; add it to `official_hosts`), How To Market A Game case studies
(Steamworks screenshots), the GameDiscoverCo newsletter quoting developers, and
gamespress.com press releases (Hooded Horse, tinyBuild, Fireshine), CI Games and
Creepy Jar ESPI reports, Remedy reports on mfn.se. Alinea's Substack posts are
mostly already imported: skip them. Most of their
figures are for games with 5,000 to 50,000 reviews.

## Review traps

All of these happened on real figures:

- **Thresholds, not figures.** "11 games sold over 10 million" says nothing precise
  about any one game.
- **Mobile or DLC inside a total.** A game with a mobile version needs a source that
  lists its platforms. DayZ's 5.8 M counted DLC, so its 4 M was used instead.
- **Another game's number.** A Famitsu caption about Backpack Battles looked like a
  MiSide figure. Squad's 3 M was proposed for Squad 44 (ex Post Scriptum), same
  publisher. Check the sentence names this exact title.
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
- **Not doubtful, audited 2026-11-16.** Agents sometimes flag these known figures;
  leave them. `PLAYSTATION_LEAK` rows are the Insomniac leak's SIE shipment table
  (sell-in, PlayStation only, as of 2022-02-27), relayed by a VGChartz forum thread.
  Alinea per-platform figures computed from a stated share of a stated total
  (Townfall PS5 70.9% of 404,000, Mortal Shell II, Star Wars Zero Company) are house
  practice.
- **Blocked hosts stay blocked**: `trusted_source` rows with `active=false`, and
  `TAVILY_EXCLUDED_DOMAINS`. `prepare` writes the list and `apply` refuses them.
- **The harvest cron skips researched games.** `apply --commit` sets
  `game.lastMilestoneResearchedAt` to today for every game searched in the
  tranche, figure or not. The milestone harvest counts it like one of its own
  harvests (`refresh-interval.ts`), so it waits its normal interval (3 to 180
  days, by game age) before searching that game again. `stamp --commit` copies
  the journal's dates into that column; it was run once for the tranches written
  before the column existed.
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
  18% of those really searched at 29,000 to 50,000, then 8%, 10%, 18% and 18% (4, 5,
  9 and 9 of 50) at 20,000 to 50,000. Below 10,000 reviews it falls to almost nothing:
  0 new figures in the 80 games of `t4-5k-50k-c` and `-d`. At that size, most finds are developer quotes relayed by
  the GameDiscoverCo newsletter or Game Developer, not estimates.
- **Platform figures are rare**: 4 console figures in 230 games, then 2 PlayStation
  figures in `t2-20k-50k-b`, where 39 of 50 games got all their searches. Console
  searches mostly surface Alinea relays or nothing. Polish publishers' ESPI filings
  (PlayWay, Movie Games) are the exception: they give exact Xbox and PS5 units.
- **Four waves fit in one 5-hour window** on Pro (3% to 85%), not five. On 2026-11-15 a wave cost 15 to 19% of the 5-hour limit and about 2% of the weekly one.
- **Paste the full prompt into each agent.** Agents told only to read
  `agent-prompt.md` did shallow passes (`t3-10k-20k-f`: 20 games at 1 search, no
  rate limit). With the full text and the "run the full budget" line, most games
  got all their searches (`-g` to `-j`).
- **Rate limits came from bursts**: 5 agents each sending all their searches at once.
  At most 2 searches per message, with a retry instead of a skip, removed them from
  `-g` onward.
- **Games out of scope** (really released before 2017, such as Battlefield 3) are marked done by setting `needed` to 0 in `searched_games.csv`, otherwise `prepare` picks them again.
- **Games with one console family** (Heavy Rain, AI Limit: no Xbox version) can only
  reach 3 searches, so `prepare` keeps picking them again. Agents also sometimes
  search PlayStation and Xbox in one query, which counts as one search.

## Files

| File | Role |
|---|---|
| `ml/research_figures.py` | `prepare`, `check`, `apply`, `import-harvest` and `stamp` |
| `source-prompt.md` | Prompt for source-first agents |
| `ml/x_search.py` | Capped X API search (`pick`, `search`), needs `X_BEARER_TOKEN` in `backend/.env` |
| `agent-prompt.md` | Prompt for the research agents |
| `searched_games.csv` | One row per game searched, tracked in git |
| `ml/reports/research/<tranche>/` | Batches, results, review, `applied.csv` (ignored by git) |

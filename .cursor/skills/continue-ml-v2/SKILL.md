---
name: continue-ml-v2
description: >-
  Resume the game-sales-tracker sales model V2 (the `ml2/` lab) in a new
  conversation: where it stands, how it works, the owner's rules, how to run
  it, what was tried and what is next. Use when the user says "reprends la
  V2", "continue le modèle", "on continue ml2", or asks about the V2 model,
  the bench, hypotheses (H1…), anchoring, the console rule, or the lab UI.
  MUST be updated at the end of every step that changes the lab.
---

# Continue the sales model V2 (`ml2/`)

The V2 is a from-scratch rebuild of the sales estimation model, started on
2026-11-09, in `ml2/`. The v1 lab (`ml/`) and the production model (v1.5) are
untouched: **nothing of the V2 is in production**.

Read this file first, then `ml2/README.md` (every result, by step) and
`ml2/history.py` (every hypothesis, what it changed, its verdict).

## Rules set by the owner

- **Answer in French**, in plain words. Code, comments and commits in English.
- **One step at a time.** Propose, wait for the go, do it, report with numbers.
- **Never compare with the existing**: not with the estimates online, not with
  the site formula, not with v1.5. Only published sales figures judge a model.
- **A change is kept only if the bench says so**: it must hold in
  cross-validation and in the test in time, and win in about 9 game resamples
  out of 10. Otherwise it is rejected and recorded as such.
- **The locked test was run once, on 2026-11-12, on the owner's go** (H27, after
  the EA Sports exclusion): totals ×1.47, bias ×0.97, range 80 % (110 games); PC
  ×1.35; small PC games ×1.24. It matches the development bench (×1.49). It is
  spent: do not run `bench.py --final` again, and say plainly that any later
  change to the model can no longer be judged on these games without bias.
- **Never drop a game because its error is large.** Exclude only for a reason
  independent of the model (as for Call of Duty).
- Published figures never include mobile sales (the owner checks this).
- Owner's knowledge of the market: players review more and more since
  2015-2017 (on Steam and on consoles), and large expensive games tend to get
  more reviews per sale than cheap indie games. The data agrees (PC-only: 62
  sales per review in 2018-2019, 34 to 47 since 2020; 64 under $10, 30 above
  $45). Keep it in mind when reading the 2018 leak or old figures.
- No commit unless asked. The lab only reads the database (`ml2/db.py`).
- The owner finds the vocabulary obscure: say what is concretely changed
  (a column added, a value computed differently, rows added, a rule after the
  model), not only the name of a result slice such as "the first week".

## How it works

```
database ──export.py──▶ raw tables ──dataset.py──▶ figures.parquet (one published figure per row,
                                                    with what was known at its date) + catalog.parquet
figures ──learned.py (BEST)──▶ model: sales per Steam review, gradient boosting
model ──bench.py──▶ judged on published figures (CV by game ×8, test in time, locked test)
model + anchor.py + consoles.py ──estimate_catalog.py──▶ every game estimated today
```

- **Model** (`learned.BEST`, currently H27 = H8 + monotonic constraints (H24) + a range width per group of games): one gradient-boosted model for
  every type of figure. It predicts sales per Steam review; inputs are the
  families of `features.py` (signals at the date, time, platforms, type of
  figure, game traits, track record of series and studio). Leak players of
  2018 are extra training rows for small games.
- **Anchoring** (`anchor.py`): a game that published a total is estimated from
  it (last total × growth of its reviews, never below it), not by the model.
- **Consoles** (`consoles.py`): console sales = store ratings today × a
  coefficient; estimate = max(model total, consoles + model PC); under 10
  Steam reviews the consoles stand alone; no signal at all → not estimated.

## Run it

All commands from `ml2/`, with the v1 environment (`../ml/.venv/bin/python`).

| Command | What it does |
| ------- | ------------ |
| `export.py` | New snapshot of the database (read-only, about 45 s). |
| `dataset.py` | Rebuild `figures.parquet` and `catalog.parquet`. |
| `bench.py [model …]` | Judge models (`REGISTRY` in `models.py`). About 1 to 2 min each. |
| `compare.py a b …` | Compare models on the figures they share; the first is the reference. |
| `anchor.py`, `consoles.py`, `estimate_catalog.py`, `diagnose.py` | Anchoring test, console test, whole catalog, error diagnosis. |
| `check_monotony.py a b …` | Share of catalog games whose estimate drops when a signal is raised by 20 %. |
| `freeze.py` | Freeze `BEST` for the backend into `models/<snapshot>/v2.json` (refuses to overwrite). `frozen.py` reads it back without scikit-learn. |
| `../ml/.venv/bin/streamlit run app.py` | The UI (or the `ml2` entry of `.claude/launch.json`, port 8512). |

After changing `dataset.py`, rerun `dataset.py`, then `bench.py` for the models
compared, then `anchor.py`, `consoles.py`, `estimate_catalog.py`, `diagnose.py`.
Restart the UI server after changing a Python module.

To try a hypothesis: add a small subclass of `BEST` in `learned.py` (see
`H19LaunchPeak`, `H27WidthBySignals`), register it in `VARIANTS`, run `bench.py <key>` and
`compare.py <BEST_KEY> <key>`. Then add an entry to `history.py`, kept or not.

## Where it stands (2026-11-12)

**Resume here (2026-11-13, deployed):** the V2 switch is live since 2026-11-13
(commits `f1376c5` lab freeze, `00bc3f9` switch, pushed to `master`; branch
`ml-v2-switch` holds the same commits). The owner skipped the parallel run and chose
"Not estimated" for the games the V2 does not estimate. What the switch is:
`ESTIMATION.md` §6 and step 14 of `ml2/README.md`.
- Checked after the deploy: the migration `AddMlV2Estimate1788980000000` ran (method
  `ml-v2`, column `sales_estimate.estimatedUnits`), the home page and game pages
  answer and still show their current figure.
- NOT checked yet: no game has been rebuilt since the deploy, so no `ml-v2` row
  exists and the write path (`persistV2Estimate`) and the public page on a V2 row
  have never run. First real test: the owner rebuilds two games from the admin (asked
  on 2026-11-13: Assassin's Creed Odyssey, anchored, and Maxon Petting Simulator, not
  estimated), or the daily cron at 04:45 UTC does it. Then read the `ml-v2` rows
  (`SELECT method, count(*) FROM sales_estimate WHERE platform = 'GLOBAL' GROUP BY 1`)
  and the public pages.
- Asked by the owner, NOT done, to do only after that test passes and with his go:
  set the rebuild cron "back to 0", i.e. clear `lastAttemptAt` of the
  `ESTIMATE_REBUILD` rows of `game_ingestion_state` so every game is due again and
  the admin crons page shows the V2 rollout from 0. It is a production write (7,586
  rows); the cron still does about 300 games per run (11 min, once a day), so a full
  pass takes about 25 runs unless he reruns it by hand from `/admin/crons`.
- Left for later: the v1.5 code (`estimation/ml/`, `backfill-ml-estimates.ts`) is
  still there for the admin explanation; the methodology page text was not reviewed;
  the lab UI was not restarted.

**The model is frozen (owner's decision, 2026-11-12): H27, snapshot
`2026-11-09T1952`.** No new hypothesis on the model; the next step is the backend
port. Asked once by the owner when freezing, as an exception to his own rule, the
comparison with v1.5 on the 575 published totals both cover: model alone ×1.45
against ×1.41 for v1.5 (no difference that holds, v1.5 ahead in 71 % of
resamples); with anchoring ×1.32 against ×1.41 (V2 ahead in 100 %); and V2 answers
for 312 more totals. The gain of the V2 is the anchoring, the coverage and the
range, not the learned model. The rule "never compare with the existing" still
stands for everything else.

**Backend port, agreed with the owner on 2026-11-12, one step at a time:**
1. done: `freeze.py` wrote `models/2026-11-09T1952/v2.json` (v2.0, trained on every
   kept figure, locked games included; read back identical to scikit-learn);
   `catalog_reference.parquet` and `catalog_features.parquet` beside it (not in git)
   are what the backend must return and from which inputs;
2. done: `backend/src/estimation/ml2/` holds `v2-frozen.json`, `v2-model.ts`
   (reader), `v2-features.ts` (the 94 columns from a game's raw values) and
   `v2-inputs.ts` (`loadV2Inputs`: those raw values read in the base, six queries
   for any number of games). Two checks, to rerun after any change there
   (`freeze.py --install` first): `backend/src/scripts/check-ml2-parity.ts`
   (8,790 rows, 0 difference) and `check-ml2-inputs.ts` (read-only on the base, at
   the snapshot's date: 4,207 of 4,395 games identical, the 188 others are rows
   changed in the base since the snapshot, mostly the day's Twitch row). Nothing
   calls these files yet; the Nest service around them comes with step 5;
3. done (2026-11-13): `v2-estimate.ts` (`estimateV2`: anchoring, console rule,
   platform floor, not estimated, ranges), pure. `check-ml2-parity.ts` part 3: on
   the 4,395 catalog games, given the lab's raw values, the backend returns the
   lab's basis, estimate and range (0 difference);
4. done (2026-11-13): `v2-inputs.ts` (`V2World`, `loadV2Signals`,
   `v2ReviewsAtDate`) and `v2-catalog.ts` (`estimateV2Games`) read everything in the
   base. `check-ml2-estimates.ts` (read-only, at the snapshot's date): 4,367 of
   4,395 games exactly as the lab, 4,389 within 10 %; the 28 others are rows changed
   in the base since, plus 3 games with two totals on the same day, where the
   backend takes the higher one on purpose (the lab takes whichever comes last: to
   align at the next freeze). Rerun the three checks after any change there;
5. skipped by the owner (2026-11-13);
6. coded on 2026-11-13, not deployed (see "Resume here").
Never edit a frozen file; a new freeze needs a new snapshot. The frozen model answers
9 % higher than the lab's catalog in the median (it learned from 184 more games).

Typical error = factor between estimate and published figure for the middle game.

| Test | Result |
| ---- | ------ |
| Model alone, totals, cross-validation | ×1.49 |
| Model alone, totals, test in time | ×1.47 (14 % too high on recent games) |
| Model alone, PC figures | ×1.44 (×1.59 in time) |
| Small PC games (2018 Steam leak players) | ×1.36, no bias |
| Anchoring, games that had an earlier total | ×1.14 (model alone ×1.43) |
| Whole system on all development totals | ×1.47 → ×1.38 |
| Games raised by console ratings | ×1.61 → ×1.53 |
| Locked test (once, 2026-11-12), totals | ×1.47, bias ×0.97, range holds 80 % |

Catalog today: 4,395 released games estimated (50 excluded by hand); 537
anchored, 3,346 by the model, 205 raised by console ratings, 116 by console
ratings alone, 2 floored by a platform figure, 189 not estimated (no signal).

What was learned:

- 79 % of the remaining error is a per-game offset no signal explains; more
  figures of the same kind no longer help the model (flat learning curve), but
  each new figure moves its game from ×1.45 to ×1.14 through anchoring.
- What moved the score: learning on signals at the date, game traits, reviews
  rebuilt at the date. What did not: other algorithms, console structure,
  neighbours, publisher, other stores, age cap, launch peak, the era the
  reviews were written in (H20: the year of the figure already carries it).
- Five more leads tested alone against H8 on 2026-11-11, all rejected (totals
  CV / time, H8 is ×1.47 / ×1.54): H21 boosting on the absolute error ×1.47 /
  ×1.57 (PC in time ×1.99); H22 / H23 training weight halved every 3 or 5
  years ×1.47 / ×1.52 and ×1.48 / ×1.55; H24 monotonic constraints ×1.48 /
  ×1.53; H25 the 1,528 figures of games released before 2017 as training-only
  rows ×1.49 / ×1.61; H26 IGDB type in detail, number in the series, parent
  game ×1.48 / ×1.52. None wins in 9 resamples out of 10.
- H24 was adopted all the same by the owner on 2026-11-11, for consistency:
  with H8, 37 % of catalog games got a lower estimate when their peak players,
  console ratings or followers were raised by 20 % (drops of 1 to 5 % mostly);
  with H24, none. It costs ×0.01 in CV and nothing in time (first week in time
  ×1.59 → ×1.65). This is an exception to the rule, decided by the owner; it
  does not make "no gain" changes acceptable in general.
- Side effect of H24, found after the switch: same bias as H8 on published
  figures at every size, but the model answers 15 % lower on the catalog in
  the median (×0.77 from 100 to 1,000 reviews, ×0.82 from 1,000 to 10,000,
  ×0.95 to ×0.98 above). The drop goes with the follower count, known for 95 %
  of catalog games but only 52 % of published figures at their date. Published
  figures cannot say which level is right (README, last section). The owner
  kept H24 knowing this.
- H27 (2026-11-12), **adopted by the owner, now `BEST`**; anchoring, consoles,
  catalog and diagnosis were rerun, with the same scores and the same estimates (2,909
  catalog games get a wider range, 624 a narrower one). The estimate is unchanged, only the range moves: its width, one value per type
  of figure until now (×2.22 for totals), is multiplied by a factor per group of games
  (no Steam review, under 10,000, 10,000 and more; then peak players known; then
  console ratings known; 50 games minimum per group). Totals inside the range, CV /
  time: under 10,000 reviews 77 → 81 % / 80 → 82 %; 10,000 and more 86 → 83 % /
  89 → 84 %; no review 56 → 62 % / 57 → 57 % (too few games per split to learn the
  factor); all 80 → 80 % / 80 → 79 %. Learned widths: ×2.32, ×2.07, ×3.28.
- H28 (2026-11-12, asked by the owner), rejected: games released from 2014 to 2016
  as training-only rows (1,101 figures, 924 games) give ×1.48 / ×1.50 against ×1.48 /
  ×1.53, won in 55 % / 56 % of resamples. `old_games_since` (read by `bench._extra`)
  stays. Aside: the reference model estimates the 184 totals of these games within
  ×1.67 and 27 % too low, so extending the estimates to 2014 would need more than
  dropping the 2017 floor.
- EA Sports yearly series (2026-11-12, owner's decision): ea-sports-fc, fifa,
  madden-nfl, ea-sports-nhl, ncaa-football, nba-live, ufc (33 games, 15 figures on 9
  games) are excluded by hand like Call of Duty: out of the model, no estimate. The
  owner first asked to anchor those with a published figure, then dropped it: the
  anchor prolonged by Steam reviews was absurd there (FC 24: 6.8 M → 136 M), and he
  did not want the published figure shown as is either. The plumbing stays unused
  (`anchor` column of `exclusions.csv`, `anchorOnly`). Side effect: open point 8.
- The plumbing of H25 stays: `figures.parquet` has a `trainOnly` column
  (status unchanged), `bench.load_figures(train_only=True)` returns those rows
  and only a model with `old_games = True` learns from them.
- The first week after release stays at ×1.54: 38 first-week totals have no
  review count at their date, 23 because the base has no Steam review reading
  before 2026-09-12 for games released earlier in 2026.

## Open points

1. Level of small games: 48 to 66 sales per review for PC-only games from 100
   to 10,000 reviews with H24 (56 to 82 with H8); known figures say about 65; almost no recent small
   game has published sales to check.
2. Missing review history for games released in 2026 before September.
3. Games sold mostly through a launcher outside Steam (Ubisoft, Battle.net, other
   EA games) are underestimated; no column says it. EA Sports yearly series are
   out of the model since 2026-11-12.
4. Wrong or missing platform release dates (Palworld, Valheim, Risk of Rain 2;
   PC missing for Ghost of Tsushima, The Last of Us Part II, Spider-Man: Miles
   Morales) and Steam entries to check (page 5 of the UI lists them).
5. Ranges per game for unanchored games are done (H27). Games with no Steam
   review stay badly covered on the bench (62 % instead of 80 %). The locked test is done and the model is frozen. Not started: anchors from platform figures, the backend port.
6. H24 is confirmed by the owner (2026-11-11), knowing its effect on the
   catalog (about 15 % lower on games under 10,000 reviews). Do not reopen it
   unless new published figures on small games say its level is wrong. Not
   tried: constraining peak players and console ratings only, leaving the
   follower count free.
7. The model is on a plateau: no hypothesis since H8 improved the estimate (H17
   to H26 and H28 rejected; H24 and H27 kept for other reasons). What still pays is data, not the model: a new published
   figure moves its game from about ×1.45 to ×1.14 through anchoring.
8. The catalog level is fragile: removing 9 EA Sports games raised the model's
   answer for multi-platform catalog games by 18 % (sum of the same games 6.07 →
   6.55 billion) with the same bias on published figures. Same nature as the H24
   side effect. The locked test does not measure it.

## Keep this skill current

At the end of every step that changes the lab, update in the same turn:

1. this file: the date, "Where it stands", "Open points", and any new rule
   the owner gave;
2. `ml2/history.py`: one entry per hypothesis tried (page "Comment ça marche"
   of the UI reads it);
3. `ml2/README.md`: the detailed numbers of the step.

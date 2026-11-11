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
- **The locked test is never scored** (`bench.py --final`) until the owner
  says the model is chosen. It has not been run.
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

- **Model** (`learned.BEST`, currently H24 = H8 + monotonic constraints): one gradient-boosted model for
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
| `../ml/.venv/bin/streamlit run app.py` | The UI (or the `ml2` entry of `.claude/launch.json`, port 8512). |

After changing `dataset.py`, rerun `dataset.py`, then `bench.py` for the models
compared, then `anchor.py`, `consoles.py`, `estimate_catalog.py`, `diagnose.py`.
Restart the UI server after changing a Python module.

To try a hypothesis: add a small subclass of `BEST` in `learned.py` (see
`H19LaunchPeak`, `H24Monotone`), register it in `VARIANTS`, run `bench.py <key>` and
`compare.py <BEST_KEY> <key>`. Then add an entry to `history.py`, kept or not.

## Where it stands (2026-11-11)

Typical error = factor between estimate and published figure for the middle game.

| Test | Result |
| ---- | ------ |
| Model alone, totals, cross-validation | ×1.48 |
| Model alone, totals, test in time | ×1.53 (14 % too high on recent games) |
| Model alone, PC figures | ×1.42 (×1.50 in time) |
| Small PC games (2018 Steam leak players) | ×1.35, no bias |
| Anchoring, games that had an earlier total | ×1.14 (model alone ×1.42) |
| Whole system on all development totals | ×1.45 → ×1.36 |
| Games raised by console ratings | ×1.64 → ×1.49 |

Catalog today: 4,428 released games; 543 anchored, 3,258 by the model, 298
raised by console ratings, 126 by console ratings alone, 5 floored by a
platform figure, 198 not estimated (no signal).

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
3. Games sold mostly through a launcher outside Steam (EA, Ubisoft,
   Battle.net) are underestimated (EA Sports ×0.30); no column says it. The
   owner is considering excluding EA Sports like Call of Duty.
4. Wrong or missing platform release dates (Palworld, Valheim, Risk of Rain 2;
   PC missing for Ghost of Tsushima, The Last of Us Part II, Spider-Man: Miles
   Morales) and Steam entries to check (page 5 of the UI lists them).
5. Not started: ranges per game for unanchored games, anchors from platform
   figures, the locked test, freezing the model, the backend port.
6. H24 is confirmed by the owner (2026-11-11), knowing its effect on the
   catalog (about 15 % lower on games under 10,000 reviews). Do not reopen it
   unless new published figures on small games say its level is wrong. Not
   tried: constraining peak players and console ratings only, leaving the
   follower count free.
7. The model is on a plateau: the last 10 hypotheses tried on H8 (H17 to H26) were
   all rejected. What still pays is data, not the model: a new published
   figure moves its game from about ×1.45 to ×1.14 through anchoring.

## Keep this skill current

At the end of every step that changes the lab, update in the same turn:

1. this file: the date, "Where it stands", "Open points", and any new rule
   the owner gave;
2. `ml2/history.py`: one entry per hypothesis tried (page "Comment ça marche"
   of the UI reads it);
3. `ml2/README.md`: the detailed numbers of the step.

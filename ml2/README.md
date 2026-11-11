# ml2/ — sales model V2, rebuilt step by step

Started on 2026-11-09, from scratch. `ml/` (v1.5, in production) is left untouched
until V2 replaces it. The lab never writes to the database (`db.py`).

It reuses the Python environment of `ml/` for now (`../ml/.venv`).

## Step 1 — the data

```bash
../ml/.venv/bin/python export.py
```

```bash
../ml/.venv/bin/python dataset.py
```

```bash
../ml/.venv/bin/streamlit run app.py
```

| File | Role |
| ---- | ---- |
| `export.py` | Frozen copy of the production tables → `data/<stamp>/raw/` (about 45 s). |
| `dataset.py` | `figures.parquet` (one row per published figure: status, and the signals known at its date) and `catalog.parquet` (one row per game to estimate). |
| `app.py`, `ui/` | Streamlit UI, one page per step. Page 1: the data. |

Rules set in `dataset.py`:

- **Scope**: paid games first released since 2017, on any platform.
- **Total**: a worldwide figure, or a platform figure when the game sold on no other
  platform at that date (`totalBecause`). A platform counts as released unless its
  release date is after the figure's day, so a missing date never creates a total.
  Leaks count players, not sales, and are never a total.
- **Repeated figure**: the same number for the same game is kept once, at its first date.
- **Known at the date**: a signal counts only if it was readable by the end of the
  figure's day. Monthly history rows (before September 2026) are stamped on the 1st
  of the month but hold the end-of-month value, so they count from the end of their
  month. The `...Stamped` columns read them by their stamp, to measure that leak.
- Rebuilt PlayStation ratings (`synthetic`) are never exported.

`data/` holds production data and is ignored by git.

## Step 2 — the bench

```bash
../ml/.venv/bin/python bench.py
```

| File | Role |
| ---- | ---- |
| `bench.py` | The protocol: locked test (1 game in 5, by hash), cross-validation by game on 8 splits, test in time (learn before 2025, estimate games released since), scores where each game counts once, paired bootstrap by game. Writes `data/<stamp>/bench/<model>.parquet`. `--final` scores the locked test: once, after the model is chosen. |
| `models.py` | The models the bench runs (`REGISTRY`). Step 2 holds two naive references. |
| `stats.py` | Weighted quantile, one-game-one-vote weights. |
| `ui/bench_page.py` | Page 2: rules, set sizes, scores, segments, estimate vs published, largest gaps. |

A model must answer for every figure, even with no signal at its date, so that all
models are scored on the same rows. A gain is kept when it holds in cross-validation
and in time, and wins in at least 9 game resamples out of 10.

## Step 3 — the references to beat

```bash
../ml/.venv/bin/python import_v1.py
```

| File | Role |
| ---- | ---- |
| `import_v1.py` | Copies the v1 lab's out-of-fold estimates (site formula, v1.5) from `ml/reports/bench_oof.parquet` onto this bench. Nothing is retrained. |
| `exclusions.csv` | Games excluded by hand from learning and judging (a series slug or a game id, with the reason). |

The results table scores every compared model on the figures they all cover. v1 has
no result for the test in time, and its estimates read monthly history by its stamp:
`reviews_ratio_stamped` shows what that leak is worth on the naive rule.

## Step 4 — the model, one hypothesis at a time

```bash
../ml/.venv/bin/python bench.py h6_combined
```

| File | Role |
| ---- | ---- |
| `features.py` | What a model is given about a figure, by family: signals at the date, time, platforms released by then, type of figure, game traits, track record of the series and studio. |
| `algorithms.py` | The learning algorithms a hypothesis can use: boosting, random forest, ridge, and their averages. |
| `learned.py` | One gradient-boosted model for every type of figure, settings fixed in advance. Each hypothesis is a small subclass (`VARIANTS`). |

The bench also scores the PC players of the 2018 Steam leak (`PC_PLAYERS`), for
information: it is the only view on small games, which almost never publish sales.

Hypotheses so far, total figures, cross-validation / test in time (2026-11-09):

| Hypothesis | CV | Time | Verdict |
| ---------- | -- | ---- | ------- |
| Reviews × coefficient (naive) | ×1.84 | ×1.85 | reference |
| H1 learned on the signals at the date | ×1.62 | ×1.84 | kept |
| H2 learn sales per review | ×1.64 | ×1.87 | kept: same on totals, small games ×3.00 → ×1.45 |
| H3 leak players as PC training rows | ×1.65 | ×1.91 | kept for PC (time ×1.90 → ×1.56) |
| H4 game traits | ×1.49 | ×1.55 | kept: the largest gain |
| H5 track record of the series and studio | ×1.59 | ×1.78 | kept, small |
| H6 = H2 + H3 + H4 + H5 | ×1.50 | ×1.64 | superseded by H7 |
| H7 = H6 + reviews rebuilt at the date | ×1.47 | ×1.53 | current best (96 % of resamples in CV, 88 % in time; PC in time gets worse, 51 games) |
| H8 = H7 + the total of a PC-only game learned as a PC figure | ×1.48 | ×1.55 | rejected: no gain |
| H9 = H7 + total = estimated PC × a learned console multiplier | ×1.49 | ×1.60 | rejected: worse |

Consoles are not what limits the model: H7 scores ×1.44 on PC + console games and
×1.46 on PC-only games. `compare.py` prints two or more models side by side.

Similar games (2026-11-10): `Context.similarity` in `features.py` compares games by
their Steam tags and genres, rare ones weighing more; the neighbours of a game always
come from the training games. Totals CV / time:

| Hypothesis | CV | Time | Verdict |
| ---------- | -- | ---- | ------- |
| H10 = H7 + what the 15 most similar games sold per review, as inputs | ×1.48 | ×1.62 | rejected for totals (worse in time); better on PC (×1.42 → ×1.38 in CV, 98 % of resamples) |
| H11 = H7 + half of the error made on the 15 most similar games | ×1.47 | ×1.58 | rejected: no gain |

More inputs (2026-11-10), totals CV / time: H12 = H7 + publisher (size, 25 largest)
×1.47 / ×1.45, better in time only (93 % of resamples), not kept yet; H13 = H7 + other
stores (Epic, GOG, Game Pass) ×1.48 / ×1.52, rejected.
H14 = H7 + what the other games of the series, studio and publishing group sold per
review ×1.47 / ×1.58, rejected for totals (PC in time ×1.61 → ×1.47, 79 % of resamples).
Publishers are grouped (`PUBLISHER_GROUPS` in `features.py`): IGDB splits them.

Models by publisher (2026-11-10), totals CV / time: H15 = H7 + a correction per
publisher (its mean error, shrunk when it has few games) ×1.48 / ×1.53, rejected;
H16 = one model for the 14 large publishing groups and one for the others ×1.47 /
×1.55, rejected. Too few games per publisher: the largest group has 28 games with a
figure, and 224 of 461 games belong to a publisher with fewer than 3.

The Epic, GOG and Game Pass columns say the game has a page there, not where it sells:
H7's error is the same with or without them, and the games sold through the EA,
Ubisoft or Battle.net launchers are not flagged. Games with `estimateHidden` set in
the admin are excluded like the ones of `exclusions.csv`.

`diagnose.py` (page 3 of the UI) explains what is left:

- 79 % of the error is a per-game offset: with the game's level known, ×1.40 → ×1.13;
- a game's own earlier figure × the growth of its reviews gives ×1.11, against ×1.37
  for the model alone (463 figures of 206 games);
- more training games no longer help: ×1.63 with 91 games, ×1.55 with 183, ×1.50 with
  274 and with 368.

PC and total made consistent (2026-11-11). For a PC-only game H7 gave a PC estimate
about 25 % under its total estimate, because totals of PC-only games and PC figures
were learned as two different types. H8 learns them as one, so both are the same
number; it scores like H7 (totals ×1.48 / ×1.55, PC ×1.41 / ×1.52) and is now the
model the rest of the lab builds on (`BEST` in `learned.py`). Its sales per review for
PC-only games are closer to the known figures (59 from 1,000 to 10,000 reviews, where
the 2018 leak and the published totals both say about 65; H7 said 76).

H17 / H18 = H8 with the game's age capped at 1 or 2 years in the time inputs: ×1.50
and ×1.49 on totals in CV (worse than H7 in 95 % of resamples), nothing elsewhere,
rejected.

First week after release (2026-11-11). On the bench the model is ×1.54 there, against
×1.45 after a month. Two things tried:

- Data fix, kept: 12 games read by Steam had no PC release date, so their launch
  reviews could not be rebuilt; the game's first release now stands in. First week
  ×1.54 → ×1.53 in CV, ×1.66 → ×1.59 in time.
- H19 = H8 + the launch month's peak players counted from day 3 (reached by then for
  8 games in 10): first week ×1.50 in time but 8 to 30 days ×1.48 → ×1.66; rejected.

What still limits the first week: 38 first-week totals have no review count at their
date, 23 of them because the base holds no review reading before 2026-09-12 for games
released earlier in 2026. With reviews rebuilt the first week is ×1.35, without ×1.68.

Review behaviour over time and by price (owner's knowledge, 2026-11-11). The data
agrees: PC-only games sold about 62 copies per review in 2018-2019 and 34 to 47 since
2020; since 2020, 64 under $10 against 30 above $45. The model had learned both, more
weakly (64.6 → 53.7 from 2018 to 2026, 57.7 → 44.3 from $5 to $60, all else equal).
H20 = H8 + when the reviews were written (mean year, share before 2020, how old they
are): ×1.47 / ×1.50, wins in 50 % of resamples in CV, rejected. The year of the figure
already carries it for the figures judged.

Other algorithms on the H7 inputs (`algorithms.py`, 2026-11-10), totals CV / time,
share of resamples where it beats boosting in CV:

| Algorithm | CV | Time | Beats boosting (CV) |
| --------- | -- | ---- | ------------------- |
| Gradient boosting (H7) | ×1.47 | ×1.53 | reference |
| Linear (ridge) | ×1.57 | ×1.62 | 0 % |
| Random forest | ×1.53 | ×1.50 | 1 % |
| Mean of boosting + linear | ×1.51 | ×1.52 | 0 % |
| Mean of forest + linear | ×1.53 | ×1.49 | 0 % |
| Mean of the three | ×1.51 | ×1.49 | 1 % |

None beats boosting: the algorithm is not the lever. The forest is a little better
on small games (×1.32 vs ×1.36) and worse on PC in time (×1.96 vs ×1.61).

On the 614 total figures v1 covers: H6 ×1.48, H7 ×1.45, v1.5 ×1.43.

`check_reviews_at_date.py` validates the rebuilt review count on games read daily:
×1.21 from the real count in the first week (×1.89 for either monthly reading), ×1.10
from day 8 to 30, exact after a month.

## Step 5 — anchoring on a game's own figures

```bash
../ml/.venv/bin/python anchor.py
```

| File | Role |
| ---- | ---- |
| `anchor.py` | A game that has published a total is estimated from it: last total × growth of its Steam reviews, with a launch correction, the model's growth when reviews cannot say, never below the published total. Its test estimates each total from the game's earlier totals only. Writes `anchor.parquet` and `anchor.json`. |
| `ui/anchor_page.py` | Page 4: the test, the whole system, and one game's published totals, model estimates and anchored curve. |

Results (2026-11-10), 463 totals of 206 development games that had an earlier total:
model alone ×1.38, anchored ×1.14 (×1.13 when prolonged by reviews, ×1.39 by the model
when there are none), range holds 77 %. Weakest when the anchor dates from the game's
first week (×1.33) or is more than a year old (×1.23). The launch correction is worth
little (×1.20 → ×1.16 for anchors 8 to 30 days after release, nothing elsewhere).

Whole system on the 896 development totals (anchor when the game already had a total,
52 % of them, model otherwise): ×1.44 → ×1.36, within ±20 %: 32 % → 41 %.

## Step 6 — the whole catalog, today

```bash
../ml/.venv/bin/python estimate_catalog.py
```

| File | Role |
| ---- | ---- |
| `estimate_catalog.py` | Every released, non-excluded game estimated today: anchored on its last published total when it has one, model otherwise, never below a published platform figure. Writes `catalog_estimates.parquet`. |
| `ui/catalog_page.py` | Page 5: how each game is estimated, estimates by size of game, the 2018 leak check, games to check in the base, the full table. |

Nothing in the lab is compared with the estimates currently online (owner's rule,
2026-11-11): only published figures judge a model. The v1 estimates imported on the
bench are no longer shown unless picked.

`consoles.py` estimates console sales from today's store ratings (about 37 sales per
PlayStation rating, 53 per Xbox rating, 21 for a Game Pass game; published figures
spread ×1.66 and ×2.50 around that). A game sold at least consoles + PC: when that sum
is above the model's total the sum is kept (236 games), and with fewer than 10 Steam
reviews the console sales stand alone (126 games). Test on games the model never saw,
against their last total carried to today: ×1.49 → ×1.47 overall, ×1.75 → ×1.46 on the
59 raised games, ×1.81 → ×1.53 on the 7 with almost no Steam review. Mixing the model
and the sum of platforms everywhere gained nothing.

What the check found (2026-11-10), 4,428 games estimated, 543 anchored:

- 319 games with no Steam review got absurd numbers (median 860,000): the model only
  learned that case on console hits. Fixed: a game with fewer than 10 Steam reviews and
  no published figure is estimated from its console ratings, or not at all when it
  has none (198 games); a game that published a total stays estimated from it.
- The level of small games is not verified: 76 to 86 sales per review from 100 to
  10,000 reviews, against 35 to 50 for large games; the only evidence on small games is
  the 2018 leak (62 players per review then).
- Some games have fewer than 200 Steam reviews while their console ratings point to
  more than 20,000 sales: console-heavy games, or a Steam entry pointing at the wrong
  product. Page 5 lists them.

Five more leads, each tested alone against H8 (2026-11-11). Reference H8: totals ×1.47
in CV and ×1.54 in time, PC ×1.42 / ×1.58, small games (2018 leak players) ×1.35.
"Wins" is the share of game resamples where the lead beats H8 on totals, CV / time.

| Lead | What changes | Totals CV | Totals time | PC CV / time | Small games | Wins CV / time | Verdict |
| ---- | ------------ | --------- | ----------- | ------------ | ----------- | -------------- | ------- |
| H21 | The boosting minimises the absolute error (`boosting_median` in `algorithms.py`) | ×1.47 | ×1.57 | ×1.39 / ×1.99 | ×1.32 | 63 % / 39 % | rejected |
| H22 | Training weight of a figure halved every 3 years of age | ×1.47 | ×1.52 | ×1.41 / ×1.51 | ×1.34 | 55 % / 56 % | rejected |
| H23 | Same, halved every 5 years | ×1.48 | ×1.55 | ×1.40 / ×1.44 | ×1.35 | 25 % / 44 % | rejected |
| H24 | Monotonic constraints: never lower when a signal rises | ×1.48 | ×1.53 | ×1.42 / ×1.50 | ×1.35 | 21 % / 68 % | rejected for accuracy |
| H25 | 1,528 figures of 1,214 games released before 2017 as training-only rows | ×1.49 | ×1.61 | ×1.44 / ×1.49 | ×1.33 | 17 % / 4 % | rejected |
| H26 | IGDB type in detail, number in the series, has a parent game (`traits_detail`) | ×1.48 | ×1.52 | ×1.40 / ×1.60 | ×1.35 | 22 % / 64 % | rejected |

None passes the rule, so nothing was combined. H24 was then adopted by the owner for
consistency, not accuracy (see below). Details:

- H21 is better where figures are many and alike (small games 99 % of resamples, PC in
  CV 89 %) and much worse on recent PC games (bias ×1.41 → ×1.99).
- H22 / H23 count a figure's age from the latest figure of the training rows. The 2018
  leak rows keep 15 % (3 years) or 32 % (5 years) of their weight; small games do not
  move. PC in time improves (82 % and 85 % of resamples), short of the rule.
- H24 constrains `log_steamPeakPlayers`, `log_psRatings`, `log_xboxRatings`,
  `log_steamFollowers` in both models, `log_peakPerReview` in the per-review model, and
  `log_steamReviews`, `log_reviewsPerDay` in the direct model (the one that answers for
  games with no Steam review). `check_monotony.py` raises each signal by 20 % on the
  4,428 released games of the catalog and counts the estimates that drop:

  | Signal raised by 20 % | H8 | H24 |
  | --------------------- | -- | --- |
  | Peak players (4,056 games) | 23.6 % (median drop 1.4 %, largest 14.9 %) | 0 % |
  | PlayStation ratings (2,335) | 3.0 % (median 3.3 %, largest 10.2 %) | 0 % |
  | Xbox ratings (2,289) | 3.1 % (median 0.9 %, largest 3.3 %) | 0 % |
  | Steam followers (3,921) | 22.0 % (median 5.2 %, largest 27.4 %) | 0 % |
  | At least one of the four | 36.7 % of all games | 0 % |
  | Steam reviews (4,109), not constrained | 5.6 % | 7.3 % |

  It costs ×0.01 in CV and nothing in time: not an accuracy gain, so rejected by the
  rule. The owner adopted it for consistency alone (below).
- H25: `dataset.py` marks these figures `trainOnly` (status unchanged, "jeu sorti avant
  2017"), after the same filters as the others (not rejected, dated, no engagement, not a
  third-party estimate, not Switch, not dated before release, no repeat): 363 totals of
  203 games, 22 PC, 10 PlayStation and 5 Xbox sales figures, 1,121 Steam leak players,
  7 PlayStation leak players. `bench.load_figures(train_only=True)` hands them to a
  model with `old_games = True` in every training set (before 2025 only for the test in
  time); `judged` never returns them and their games are not in the catalog. Old games
  sold far more per review (totals: 219 per review against 67 for games in scope; leak
  players: 104 against 62), and the model carries part of that over to recent games
  (bias in time ×1.15 → ×1.24).
- H26: too few games carry the information (25 of the 888 games with a kept figure are
  not "main game", 106 have a number in their series, 21 a parent game; the number is
  sometimes a year, such as 2077).

The dataset rebuilt with `trainOnly` is otherwise identical (figures and catalog), and
H8, `anchor.py`, `consoles.py`, `estimate_catalog.py` and `diagnose.py` give the same
outputs as before.

H24 adopted as the reference model (owner's decision, 2026-11-11): `BEST` in
`learned.py` is now `H24Monotone`, and `anchor.py`, `consoles.py`,
`estimate_catalog.py`, `diagnose.py` were rerun.

| Test | H8 | H24 |
| ---- | -- | --- |
| Model alone, totals, CV / time | ×1.47 / ×1.54 | ×1.48 / ×1.53 |
| First week after release, CV / time | ×1.53 / ×1.59 | ×1.54 / ×1.65 |
| Anchoring, 463 totals with an earlier total | ×1.14 (model ×1.41) | ×1.14 (model ×1.42) |
| Whole system on the 896 development totals | ×1.46 → ×1.35 | ×1.45 → ×1.36 |
| Console rule, all 411 unseen games | ×1.52 → ×1.50 | ×1.48 → ×1.47 |
| Console rule, games raised by their ratings | ×1.71 → ×1.54 (64 games) | ×1.64 → ×1.49 (70 games) |
| Catalog: by the model / raised by console ratings | 3,310 / 248 | 3,258 / 298 |

Side effect found after the switch: on published figures the two models have the same
bias at every size (within ×0.02 almost everywhere), but on the catalog today H24's
model answers 15 % lower in the median (final estimates 12 % lower; their sum 6.68 →
6.44 billion):

| Steam reviews today | Games | Model H24 / H8 (median) | Sales per review, PC-only games: H8 → H24 |
| ------------------- | ----- | ----------------------- | ------------------------------------------ |
| 1 to 100 | 115 | ×0.83 | 144 → 119 |
| 100 to 1,000 | 887 | ×0.77 | 82 → 66 |
| 1,000 to 10,000 | 2,020 | ×0.82 | 56 → 48 |
| 10,000 to 100,000 | 925 | ×0.95 | 45 → 42 |
| 100,000 and more | 162 | ×0.98 | 32 → 32 |

The drop goes with the follower count: ×0.83 for games that have one, ×0.98 without.
95 % of catalog games have a follower count today, against 52 % of the published
figures at their date, and the catalog's games are much older (median 5.4 years against
0.6) with far fewer peak players per review (0.17 against 1.02). The catalog is mostly
outside what the published figures cover, so they cannot say which level is right
(known marks for PC-only games: about 65 sales per review in the 2018 leak and the
published totals, 34 to 47 for totals published since 2020). The owner kept H24
knowing this (2026-11-11).

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


### H27 — a range width per game (2026-11-12, adopted by the owner, now `BEST`)

The estimate is unchanged; only `low` and `high` move. Until now the width of the range
was one value per type of figure (×2.22 for totals). H27 (`width_by_signals`) multiplies
it by a factor measured per group of games, on the same unseen-game errors: Steam reviews
at the date (none, under 10,000, 10,000 and more), then peak players known or not, then
console ratings known or not. A group gets its own factor only with 50 games
(`WIDTH_MIN_GAMES`); otherwise the coarser group is used. Each error is first divided by
the width of its type of figure, so a group is not called uncertain because it holds
more console figures.

Share of published totals inside the range (target 80 %), H24 → H27:

| Group (reviews as the model sees them) | Games | Width needed | Cross-validation | Test in time |
| --- | --- | --- | --- | --- |
| Under 10,000 reviews | 168 | ×2.28 | 77 % → 81 % | 80 % → 82 % |
| 10,000 reviews and more | 269 | ×1.93 | 86 % → 83 % | 89 % → 84 % |
| No review | 55 | ×3.37 | 56 % → 62 % | 57 % → 57 % |
| All totals | 433 | ×2.18 | 80 % → 80 % | 80 % → 79 % |

Widths learned on every development game: ×2.32 under 10,000 reviews, ×2.07 above
(×2.04 with peak players and console ratings), ×3.28 with no review. Games with no
review stay badly covered on the bench: about 48 of them are in each training split,
under the 50-game floor, so the factor is rarely learned there; it is with all games.
Peak players and console ratings add little once the review count is known.

On the catalog no estimate changes. Range (÷ and × around the estimate) of games
estimated by the model: multi-platform ×2.22 → ×2.32 under 10,000 reviews, ×2.04 above;
PC-only ×2.08 → ×2.17 and ×1.98. 2,909 games get a wider range, 624 a narrower one;
anchored games and games on console ratings alone are untouched. Under 1,000 reviews only 6
games published a total, so the width there is not checked by sales figures.

### H28 — games released from 2014 to 2016 as training-only rows (2026-11-12, rejected)

Asked by the owner. Same plumbing as H25, limited to games released from 2014 on
(`old_games_since = 2014`, read by `bench._extra`): 1,101 figures on 924 games (184
totals of 104 games, 17 platform figures, 900 leak players). Never judged, never
estimated.

| | Totals CV | Totals in time | PC CV / time | Small PC games | Range in time | Resamples won (CV / time) |
| --- | --- | --- | --- | --- | --- | --- |
| H27 | ×1.48 | ×1.53 | ×1.42 / ×1.50 | ×1.35 | 79 % | |
| H28 | ×1.48 | ×1.50 | ×1.43 / ×1.47 | ×1.33 | 75 % | 55 % / 56 % |

No gain that holds, so rejected. It does less harm than H25 (every game before 2017:
×1.49 / ×1.61). Aside: the reference model, which never saw these games, estimates
their 184 published totals within ×1.67 and 27 % too low (2014 ×1.74, 2015 ×1.83,
2016 ×1.49; bias ×0.71 to ×0.73 every year; range holds 67 %). Old games sold more per
review than the model has learned from games released since 2017.

### EA Sports yearly series are excluded by hand (2026-11-12, owner's decision)

Seven series join Call of Duty in `exclusions.csv`: ea-sports-fc, fifa, madden-nfl,
ea-sports-nhl, ncaa-football, nba-live, ufc: 33 catalog games, 15 kept figures on 9
games (none in the locked test). Reason: sold mostly on consoles and through the EA
app; the model answered ×0.14 to ×0.71 of their published figures. They neither teach
nor judge the model and get no estimate. F1, WRC and Super Mega Baseball stay.

| | Before | After |
| --- | --- | --- |
| Totals, CV / in time | ×1.48 / ×1.53 | ×1.49 / ×1.47 |
| PC, CV / in time | ×1.42 / ×1.50 | ×1.44 / ×1.59 |
| Whole system on all totals | ×1.45 → ×1.36 | ×1.47 → ×1.38 |
| PlayStation sales per rating | 37.0 | 35.5 |
| Catalog: estimated games | 4,428 | 4,395 |
| Catalog: anchored / model / raised by console ratings / console ratings alone | 543 / 3,258 / 298 / 126 | 537 / 3,346 / 205 / 116 |

Tried first, then dropped by the owner: keeping these games estimated from their own
figures. Anchoring prolonged by Steam reviews is absurd on them (EA SPORTS FC 24 6.8 M
→ 136 M, FC 26 12 M → 75 M, FIFA 22 9 M → 56 M): their Steam reviews at the figure's
date were tiny and grew many times since. The plumbing stays for another case: a column
`anchor` in `exclusions.csv`; with `yes` the game is out of the model but the catalog
anchors it on its total, floors it by a platform figure, and does not estimate it
otherwise (`anchorOnly` in `figures.parquet` and `catalog.parquet`). No row uses it.

Side effect, open: removing these 9 games moves the catalog much more than the bench.
The model's answer for multi-platform catalog games rises by 18 % in the median
(PC-only ×0.95), the sum of estimates of the same games goes from 6.07 to 6.55 billion,
and 93 games are no longer raised by their console ratings. Bias on published figures
is unchanged (×0.96 CV, ×1.14 in time). Like the H24 side effect, the level of catalog
games with few reviews is not pinned by the published figures.

## Step 7 — the locked test (2026-11-12, run once, on the owner's go)

`bench.py --final h27_width_by_signals`: the model learns from every development game
and answers for the 1 game in 5 set aside since step 2, never looked at before.

| Figures | Locked test | Development (CV) | Bias | Within ±20 % / ×2 | Range holds | Figures / games |
| --- | --- | --- | --- | --- | --- | --- |
| Totals | ×1.47 (×1.41 to ×1.55 over game resamples) | ×1.49 | ×0.97 | 25 % / 75 % | 80 % | 225 / 110 |
| PC | ×1.35 | ×1.44 | ×1.11 | 41 % / 77 % | 87 % | 43 / 26 |
| PlayStation | ×1.59 | ×2.19 | ×1.19 | 18 % / 60 % | 71 % | 24 / 15 |
| Xbox | ×2.42 | ×1.99 | ×0.69 | 0 % / 43 % | 43 % | 7 / 7 |
| Small PC games (leak players) | ×1.24 | ×1.36 | ×1.09 | 51 % / 87 % | 88 % | 76 / 76 |

The model does on unseen games what the development bench said: no overfitting to the
bench. Totals by group: under 10,000 reviews ×1.51, bias ×1.17, range 77 % (45 games);
10,000 and more ×1.46, bias ×0.93, range 80 % (79 games); no review ×1.79, bias ×0.58,
range 77 % (10 games). Largest misses: OCTOPATH TRAVELER ×0.10, Red Dead Redemption 2
×0.12, Timberborn ×0.17, DRAGON QUEST XI ×0.19, Celeste ×4.25, Super Battle Golf ×3.69.

The test is spent: a later change to the model can no longer be judged on these games
without bias. Anchoring and the console rule were not scored on them (no `--final` mode
there). It says nothing of the level of small multi-platform catalog games.

## Step 8 — the model is frozen (2026-11-12, owner's decision)

The V2 model is H27 (`learned.BEST`), on snapshot `2026-11-09T1952` with
`exclusions.csv` as of 2026-11-12. No further hypothesis is tried on it: the locked
test is spent. Still to do: the backend port (v1.5 stays in production until then).

### Against v1.5, once, at the owner's request

An exception to the rule of step 6, asked by the owner when freezing. Both are scored
on published totals only, on the 575 development totals (327 games) that v1.5's
out-of-fold estimates cover (`compare.py h27_width_by_signals v1_5`). Two caveats in
v1.5's favour, as in step 3: it read monthly Steam history by its stamp (up to a month
of future), and it only kept figures the site formula could estimate.

| | Typical error | Within ±20 % | Within ×2 | Bias |
| --- | --- | --- | --- | --- |
| v1.5 | ×1.41 | 30 % | 81 % | ×1.02 |
| V2, model alone | ×1.45 | 31 % | 79 % | ×0.95 |
| V2, model + anchoring | ×1.32 | 43 % | 85 % | |

- Model against model, no difference that holds: v1.5 is ahead in 71 % of game
  resamples. V2 is better under 1 M (×1.48 vs ×1.62) and from day 8 to 30 (×1.39 vs
  ×1.62); v1.5 is better at 5 M and more (×1.34 vs ×1.48).
- With anchoring, V2 wins in 100 % of resamples: on the 296 totals of games that had
  published an earlier total, ×1.13 against ×1.37; on the 279 first totals of a game,
  ×1.43 against ×1.47.
- V2 also answers for 312 development totals (203 games) v1.5 has no estimate for,
  at ×1.60.

So the gain of the V2 is the anchoring, the wider coverage, the honest reading of
history and a range that holds; the learned model itself is not more accurate than v1.5.

## Step 9 — the frozen file, for the backend (2026-11-12)

```bash
../ml/.venv/bin/python freeze.py     # refuses to overwrite an existing freeze
```

| File | Role |
| ---- | ---- |
| `freeze.py` | Trains `learned.BEST` once on every kept figure of the snapshot, the locked games included (the locked test is spent), and writes `models/<snapshot>/`. |
| `frozen.py` | Reads the file back with numpy only. This is the reference the backend port must reproduce. `FrozenBest` gives it the interface of a lab model. |
| `models/<snapshot>/v2.json` | In git, never edited. The two boosted models tree by tree (`direct`: log sales; `perReview`: log sales per Steam review, used whenever the game has reviews), the range widths and their scale per group of games, the anchoring settings, the console coefficients, the hand exclusions, and what the input columns are made of. |
| `models/<snapshot>/catalog_reference.parquet`, `catalog_features.parquet` | Not in git (production data). Every catalog game estimated by the frozen file, and the 94 input values it was given: what the backend must return, and from what. |

A tree node asks `x[f] <= t`; a missing value goes left when `m` is 1; `f` is -1 on a
leaf, whose value is in `t`. An estimate is the baseline plus one leaf per tree. Numbers
are written as full float64, so the backend can reproduce them to the last bit.

v2.0, snapshot `2026-11-09T1952`: 1,863 figures of 879 games (1,494 sales figures of
570 games; 184 locked games now included), 300 + 300 trees, 94 columns, 0.53 MB.
Read back identical to scikit-learn on the 1,863 figures and on the 4,395 catalog
games, for totals and for PC (largest gap 0).

Learning also from the locked games moves the catalog again, as every change of the
training games does: the model's answer rises by 9 % in the median (×0.81 to ×1.56 for
8 games in 10; ×1.57 from 1 to 100 reviews, ×1.17 from 1,000 to 10,000, ×0.91 above
100,000), the final estimates by 6 %, their sum from 6.55 to 6.63 billion. Console
coefficients: 35.8 PlayStation, 58.0 Xbox, 17.8 Game Pass (35.5 / 53.4 / 21.2 on the
development games). Range of a total: ×2.14, × 1.17 in log under 10,000 reviews, × 0.93
above, × 1.56 with no review. The anchoring settings are those of `anchor.json`
(measured on the development games).

## Step 10 — the backend reads the frozen file (2026-11-12, first half of the port's step 2)

```bash
../ml/.venv/bin/python freeze.py --install      # copies v2.json into the backend, writes data/<snapshot>/v2_parity.json
cd ../backend && npx ts-node src/scripts/check-ml2-parity.ts ../ml2/data/<snapshot>/v2_parity.json
```

| File | Role |
| ---- | ---- |
| `backend/src/estimation/ml2/v2-frozen.json` | Copy of `models/<snapshot>/v2.json` (`freeze.py --install`). |
| `backend/src/estimation/ml2/v2-model.ts` | Mirror of `frozen.py`: walks the trees, gives estimate and range (`V2Model.predict`, `v2SignalGroups`). Pure. |
| `backend/src/estimation/ml2/v2-features.ts` | Mirror of `features.py` (families signals, time, platforms, target, traits, track_record) and of `Learned._prep`: `buildV2Features` turns what the base holds on a game into the 94 input columns. Pure: no database access. |
| `backend/src/scripts/check-ml2-parity.ts` | For every catalog game, as a total and as a PC figure: (1) the lab's columns through the TypeScript reader, (2) the game's raw values through `buildV2Features` then the reader, both against the lab's estimate and range. |
| `data/<snapshot>/v2_parity.json` | Written by `freeze.py --install`, not in git: the 8,790 rows (columns, expected estimate and range) and the raw values of each game. |

Result on the 8,790 rows: reader 0 estimate differs (largest gap 4e-15 in log), inputs
0 row with a different column and 0 estimate differs. Nothing in the backend calls
these files yet. Still to do in step 2: the database lookups that fill `V2FeatureInput`
(signals as `dataset.signals_at` reads them, first release, release date per platform,
price, published totals of the series and the studio as `Context.best_before`).

## Step 11 — the backend reads the inputs in the base (2026-11-12, second half of the port's step 2)

```bash
cd ../backend && npx ts-node src/scripts/check-ml2-inputs.ts ../ml2/data/<snapshot>/v2_parity.json
```

| File | Role |
| ---- | ---- |
| `backend/src/estimation/ml2/v2-inputs.ts` | `loadV2Inputs(query, model, gameIds, asOf)`: six queries for any number of games, giving the `V2FeatureInput` of each. Mirrors `dataset.signals_at` (a monthly row is known at the end of its month; latest reviews, ratings, followers, playtime; highest concurrent players; best top-seller rank; median Twitch viewers over 30 days), the first release, the release date per platform, the current US Steam price, and the track record of the series and of the studio from the totals the lab keeps (`dataset.build`, `total_reason`, the hand exclusions of the frozen file, `Context.best_before`). |
| `backend/src/scripts/check-ml2-inputs.ts` | Read-only. Runs it on every catalog game at the snapshot's date and compares each value with the lab's (`v2_parity.json`). |

Result at the date of snapshot `2026-11-09T1952`, on the base of 2026-11-12: 4,207 of
4,395 games identical on every value. The 188 others moved in the base since the
snapshot: `twitchViewers30d` 166 games and `steamPeakPlayers` 2 (the day's row is
updated in place until the day ends: the snapshot was taken during 9 November),
`steamFollowers` 10 (rows dated before the snapshot, written after it),
`timeToBeatSeconds` 10 and `inSeries` 1 (game sheets edited). No difference of reading
was found. Every other value, the track record included, is identical on all games.

Cost: no table, no cron, no stored row. 11 s for the whole catalog in batches of 200
(2 ms per game); nothing calls it yet. The Nest service around it comes with the
parallel run (step 5 of the port).

## Step 12 — the rules after the model, in the backend (2026-11-13, step 3 of the port)

| File | Role |
| ---- | ---- |
| `backend/src/estimation/ml2/v2-estimate.ts` | `estimateV2`: mirror of `estimate_catalog.py` and of `consoles.console_units` / `combine`. Anchoring on the last published total (growth of the Steam reviews, launch correction, the model's growth when there are no reviews to follow, never below the figure), the console rule, the floor of a published platform figure, "not estimated" without a signal, and the range of each case. Pure. Its `basis` is a code: `anchored`, `platform-floor`, `model`, `model-raised-by-consoles`, `consoles`, `not-estimated`. |
| `estimate_catalog.py` | Now also writes what the rules were given (`modelPcRaw`, `gamePass`, the ratings, the anchor's review count, its model answer, whether the count was read that day). |
| `freeze.py --install` | Reruns the catalog with the frozen file, checks it equals `catalog_reference.parquet`, and adds to `v2_parity.json`, per game, what the rules are given and the estimate kept. |

`check-ml2-parity.ts` has a third part: for each of the 4,395 catalog games, the raw
values go through `buildV2Features`, the reader (total and PC) and `estimateV2`. Result:
0 game with a different basis, 0 estimate, low or high that differs (largest gap 1e-12
in log). So, given the same values, the backend returns the lab's whole catalog.

Left before the parallel run: reading in the base what the rules are given (the game's
own kept figures: its last total and its best figure; the Steam reviews rebuilt at the
total's date, `dataset.reviews_at_date`; the model's answer at that date; the Game Pass
flag; which games are excluded by hand or not released), then the same check on the base.

## Step 13 — the whole chain on the base, in the backend (2026-11-13, step 4 of the port)

```bash
cd ../backend && npx ts-node src/scripts/check-ml2-estimates.ts ../ml2/data/<snapshot>/v2_parity.json
```

| File | Role |
| ---- | ---- |
| `backend/src/estimation/ml2/v2-inputs.ts` | Rewritten around `V2World` (the games asked, their series and studio peers, release dates, price, and the published figures the lab keeps, with "the same figure repeated" dropped) and `loadV2Signals` (readings of each game at its own date). `v2ReviewsAtDate` mirrors `dataset.reviews_at_date`. `loadV2Inputs` is unchanged for its callers. Figures and prices entered after the date asked are not read. |
| `backend/src/estimation/ml2/v2-catalog.ts` | `estimateV2Games(query, model, gameIds, asOf)`: status of each game (out of scope, excluded by hand, not released, estimated), the model today (total and PC), the game's last published total with the reviews rebuilt and the model asked at that total's date, its best figure, then `estimateV2`. About nine queries for any number of games. |
| `backend/src/scripts/check-ml2-estimates.ts` | Read-only. The whole chain at the snapshot's date against the lab's catalog: basis, estimate, range, and what the rules were given. |

Result at the date of snapshot `2026-11-09T1952`, on the base of 2026-11-13: of 4,395
games, 4,367 have the lab's basis, estimate and range exactly, 4,371 within 1 %, 4,389
within 10 %. The 28 others:

- 3 games have two kept totals on the same day (Megabonk 909,746 and 2,000,000; PRAGMATA
  2.70 M and 2.73 M; one more 8 M and 9 M). The lab anchors on whichever comes last in
  its table; the backend takes the higher one, on purpose. Same rule for two review
  counts known at the same instant. To align in the lab at the next freeze.
- 1 anchor figure is gone from the base (Ace Combat 8), 2 games were deleted, 3 answers
  of the model at the anchor's date moved (checked on Horizon Forbidden West: its time to
  beat was filled in since), the rest are the inputs that moved (step 11).

Seen on the way, and reproduced as the lab does it: daily rows stamped at 02:00 on the
first of a month (a review-history import) count as monthly rows, so they are known a
month late (MECCHA CHAMELEON, 1 July 2026).

Cost: no table, no cron, no stored row. 26 s for the whole catalog in batches of 200
(6 ms per game). Nothing calls it yet.

## Step 14 — the site switches to the V2 (2026-11-13, coded, not deployed)

The owner skipped the parallel run and asked for the switch; games the V2 does not
estimate show "Not estimated". How the backend stores and shows it is owned by
`ESTIMATION.md` §6. In short: `V2EstimateService` (method `ml-v2`) is computed at each
rebuild of a game and stored as its worldwide row (`sales_estimate.estimatedUnits`, new
column, migration `1788980000000-AddMlV2Estimate`; 0 = not estimated); the public page
reads it; a game not rebuilt yet keeps its current figure; the admin game page shows the
V2 computed live.

`backend/src/scripts/preview-ml2-switch.ts` (read-only) lists what a rebuild would store
for every game on the base as it is. On 2026-11-13, 7,422 games: 4,235 estimates (3,376
model, 543 anchored, 195 raised by console ratings, 117 console ratings alone, 4
platform floors), 244 "not estimated" (193 no signal, 51 excluded by hand), 2,943
without a row (2,582 free or released before 2017, 361 not released). Sum of the
estimates 6.62 billion, no invalid range.

Not verified: the write path never ran (no local database). Cost: one more row per
estimated game (about 4,500 rows, a few MB) and about ten more queries per rebuild; no
cron, no backfill. Games move to the V2 at their next rebuild (270 to 400 a day, at most
once a week each), so the site mixes v1.5 and V2 for two to three weeks after the deploy.

"""Step 2: the bench. The protocol is fixed here, before any model exists.

Three tests, always on games the model never saw:
  - cross-validation by game, repeated on several splits (a single split moves the
    result by about ±0.02, which is the size of most "gains");
  - a test in time: learn from figures published before 2025, estimate games
    released since;
  - a locked test: 1 game in 5, set aside by a hash of its id. Scored only with
    `--final`, once a model has been chosen on the two others.

Only sales figures are judged. The headline is the total; PC is the second target;
PlayStation and Xbox are shown for information (few games). Each game counts once.

    ../ml/.venv/bin/python bench.py                # every model, cv + time
    ../ml/.venv/bin/python bench.py reviews_ratio  # one model
    ../ml/.venv/bin/python bench.py --final reviews_ratio
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

from dataset import KEPT, latest_snapshot
from stats import game_weights, weighted_quantile

LOCKED_ONE_IN = 5
FOLDS = 5
REPEATS = 8
TIME_CUTOFF = pd.Timestamp("2025-01-01", tz="UTC")
TARGETS = ("TOTAL", "PC", "PLAYSTATION", "XBOX")
# Small games almost never publish sales. The 2018 Steam leak gives their PC players, a
# little above their sales: scored for information, to see what a model does down there.
PLAYERS = "PC_PLAYERS"
SCORED = (*TARGETS, PLAYERS)
BOOTSTRAP_DRAWS = 300


def _hash(text: str) -> int:
    return int(hashlib.md5(text.encode()).hexdigest(), 16)


def is_locked(game_id: str) -> bool:
    return _hash(f"v2-lock:{game_id}") % LOCKED_ONE_IN == 0


def fold_of(game_id: str, repeat: int) -> int:
    return _hash(f"v2-fold-{repeat}:{game_id}") % FOLDS


def load_figures(snapshot: Path, train_only: bool = False) -> pd.DataFrame:
    """Kept figures, with the set each game belongs to. `train_only` adds the figures of
    games released before 2017: a model may learn from them, they are never judged."""
    f = pd.read_parquet(snapshot / "figures.parquet")
    if "trainOnly" not in f:
        f["trainOnly"] = False
    f = f[(f.status == KEPT) | (f.trainOnly & train_only)].reset_index(drop=True)
    f["locked"] = f.gameId.map(is_locked) & ~f.trainOnly
    return f


def judged(figures: pd.DataFrame) -> pd.DataFrame:
    sales = (figures.measure == "ventes") & figures.target.isin(TARGETS)
    out = figures[sales | ((figures.measure == "joueurs") & (figures.target == "PC"))]
    return out[~out.trainOnly] if "trainOnly" in out else out


def _extra(model_class, figures: pd.DataFrame) -> pd.DataFrame:
    """Training-only figures (games released before 2017), for a model that asks for them."""
    extra = figures[figures.trainOnly & bool(getattr(model_class, "old_games", False))]
    since = getattr(model_class, "old_games_since", None)  # only the old games released from that year on
    return extra if since is None else extra[extra.releaseDate >= pd.Timestamp(f"{since}-01-01", tz="UTC")]


def _with(train: pd.DataFrame, extra: pd.DataFrame) -> pd.DataFrame:
    return pd.concat([train, extra]) if len(extra) else train


def training_rows(model_class, figures: pd.DataFrame) -> pd.DataFrame:
    """Everything a model may learn from outside the locked test."""
    return _with(figures[~figures.locked & ~figures.trainOnly], _extra(model_class, figures))


# ---- running a model ---------------------------------------------------------

def _predict(model_class, train: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    assert not set(train.gameId) & set(test.gameId), "a test game is in the training set"
    model = model_class()
    model.fit(train)
    out = model.predict(test)
    assert out[["estimate", "low", "high"]].notna().all().all() and (out.estimate > 0).all(), "a model must always answer"
    return out.assign(figureId=test.figureId.to_numpy())


def cross_validate(model_class, figures: pd.DataFrame) -> pd.DataFrame:
    dev, extra = figures[~figures.locked & ~figures.trainOnly], _extra(model_class, figures)

    def one(repeat: int, k: int) -> pd.DataFrame:
        folds = dev.gameId.map(lambda g: fold_of(g, repeat))
        return _predict(model_class, _with(dev[folds != k], extra), judged(dev[folds == k])).assign(test="cv", repeat=repeat)

    parts = Parallel(n_jobs=-1)(delayed(one)(repeat, k) for repeat in range(REPEATS) for k in range(FOLDS))
    return pd.concat(parts, ignore_index=True)


def time_test(model_class, figures: pd.DataFrame) -> pd.DataFrame:
    dev, extra = figures[~figures.locked & ~figures.trainOnly], _extra(model_class, figures)
    recent = dev.releaseDate >= TIME_CUTOFF
    # A game released before 2025 stays out of both sides if its figures came later.
    train = _with(dev[~recent & (dev.reportedAt < TIME_CUTOFF)], extra[extra.reportedAt < TIME_CUTOFF])
    return _predict(model_class, train, judged(dev[recent])).assign(test="time", repeat=0)


def final_test(model_class, figures: pd.DataFrame) -> pd.DataFrame:
    return _predict(model_class, training_rows(model_class, figures), judged(figures[figures.locked])).assign(test="final", repeat=0)


# ---- scoring -------------------------------------------------------------------

def with_errors(predictions: pd.DataFrame, figures: pd.DataFrame) -> pd.DataFrame:
    cols = ["figureId", "gameId", "game", "target", "measure", "units", "reportedAt", "ageDays", "origin",
            "totalBecause", "steamReviews", "sourceUrl"]
    p = predictions.merge(figures[cols], on="figureId")
    p["target"] = p.target.where(p.measure == "ventes", PLAYERS)
    p["ratio"] = p.estimate / p.units
    p["factor"] = np.exp(np.abs(np.log(p.ratio)))
    p["inside"] = (p.units >= p.low) & (p.units <= p.high)
    return p


def score(p: pd.DataFrame) -> dict:
    """Scores of one set of rows (one repeat). Each game counts once."""
    if len(p) == 0:
        return {}
    w = game_weights(p.gameId)
    share = lambda mask: float(np.average(mask, weights=w))
    return {
        "figures": len(p), "games": p.gameId.nunique(),
        "factor": weighted_quantile(p.factor, w, 0.5),
        "within20": share(p.factor <= 1.25), "within1_5": share(p.factor <= 1.5), "within2": share(p.factor <= 2.0),
        "bias": weighted_quantile(p.ratio, w, 0.5),
        "coverage": share(p.inside), "width": weighted_quantile(np.sqrt(p.high / p.low), w, 0.5),
    }


def score_repeats(p: pd.DataFrame) -> dict:
    """Mean of each score over the repeats, plus how far the typical error moves between splits."""
    per = [score(rows) for _, rows in p.groupby("repeat")]
    if not per:
        return {}
    out = {k: float(np.mean([s[k] for s in per])) for k in per[0]}
    out["figures"], out["games"] = per[0]["figures"], per[0]["games"]
    out["factorMin"], out["factorMax"] = min(s["factor"] for s in per), max(s["factor"] for s in per)
    return out


def bootstrap_factor(p: pd.DataFrame, draws: int = BOOTSTRAP_DRAWS, seed: int = 0) -> np.ndarray:
    """Typical error on `draws` resamples of the games (same games for every model: paired)."""
    games = np.sort(p.gameId.unique())
    index = {g: i for i, g in enumerate(games)}
    rng = np.random.default_rng(seed)
    counts = rng.multinomial(len(games), np.full(len(games), 1 / len(games)), size=draws)
    out = np.zeros(draws)
    repeats = [rows for _, rows in p.groupby("repeat")]
    for rows in repeats:
        gi = rows.gameId.map(index).to_numpy()
        base = game_weights(rows.gameId)
        factor = rows.factor.to_numpy()
        order = np.argsort(factor)
        for d in range(draws):
            w = (base * counts[d][gi])[order]
            cum = np.cumsum(w)
            out[d] += factor[order][min(int(np.searchsorted(cum, 0.5 * cum[-1])), len(factor) - 1)]
    return out / len(repeats)


SEGMENTS = {
    "Taille du chiffre publié": lambda p: pd.cut(p.units, [0, 3e5, 1e6, 5e6, float("inf")], right=False,
                                                 labels=["< 300 k", "300 k – 1 M", "1 – 5 M", "5 M +"]),
    "Âge du jeu à la date du chiffre": lambda p: pd.cut(p.ageDays, [-1, 7, 30, 365, float("inf")],
                                                       labels=["1re semaine", "8 – 30 jours", "1 – 12 mois", "plus d'un an"]),
    "Reviews Steam connues à la date": lambda p: np.where(p.steamReviews > 0, "oui", "non"),
    "Origine du chiffre": lambda p: p.origin,
}


def by_segment(p: pd.DataFrame, segment: str) -> pd.DataFrame:
    p = p.assign(segment=SEGMENTS[segment](p))
    rows = {name: score_repeats(part) for name, part in p.groupby("segment", observed=True)}
    return pd.DataFrame(rows).T


def label_disagreement(figures: pd.DataFrame, max_days: int = 30, min_age_days: int = 365) -> pd.Series:
    """Factor between two different total figures of the same game published close in time,
    once the game is old enough to sell slowly. No model can be scored below this."""
    t = figures[(figures.measure == "ventes") & (figures.target == "TOTAL") & (figures.ageDays >= min_age_days)]
    pairs = t.merge(t, on="gameId", suffixes=("", "_b"))
    pairs = pairs[(pairs.figureId < pairs.figureId_b)
                  & ((pairs.reportedAt - pairs.reportedAt_b).abs() <= pd.Timedelta(days=max_days))]
    return np.exp(np.abs(np.log(pairs.units / pairs.units_b)))


def set_sizes(figures: pd.DataFrame) -> pd.DataFrame:
    j = judged(figures)
    j = j.assign(target=j.target.where(j.measure == "ventes", PLAYERS))
    recent = j.releaseDate >= TIME_CUTOFF
    sets = {"Développement (validation croisée)": j[~j.locked],
            "dont test dans le temps (jeux sortis depuis 2025)": j[~j.locked & recent],
            "Sous clé (test final)": j[j.locked]}
    rows = {}
    for name, part in sets.items():
        rows[name] = {f"{target} {what}": (len(x) if what == "chiffres" else x.gameId.nunique())
                      for target in SCORED for x in [part[part.target == target]] for what in ("chiffres", "jeux")}
    return pd.DataFrame(rows).T


# ---- command line --------------------------------------------------------------

def predictions_dir(snapshot: Path) -> Path:
    return snapshot / "bench"


def main() -> None:
    from models import REGISTRY

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    final = "--final" in sys.argv
    snapshot = latest_snapshot()
    figures = load_figures(snapshot, train_only=True)
    out = predictions_dir(snapshot)
    out.mkdir(exist_ok=True)
    for key in args or REGISTRY:
        if final:
            preds = final_test(REGISTRY[key], figures)
            preds.to_parquet(out / f"{key}.final.parquet", index=False)
        else:
            preds = pd.concat([cross_validate(REGISTRY[key], figures), time_test(REGISTRY[key], figures)], ignore_index=True)
            preds.to_parquet(out / f"{key}.parquet", index=False)
        p = with_errors(preds, figures)
        print(f"\n{REGISTRY[key].label}")
        for test, rows in p.groupby("test"):
            for target in SCORED:
                s = score_repeats(rows[rows.target == target])
                if s:
                    print(f"  {test:<5} {target:<12} ×{s['factor']:.2f} [{s['factorMin']:.2f}–{s['factorMax']:.2f}]  "
                          f"±20 %: {s['within20']:.0%}  ×2: {s['within2']:.0%}  biais ×{s['bias']:.2f}  "
                          f"fourchette: {s['coverage']:.0%}  ({s['figures']} chiffres, {s['games']} jeux)")


if __name__ == "__main__":
    main()

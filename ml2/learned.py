"""Step 4: the learned model, built one hypothesis at a time.

One gradient-boosted model for every type of figure (total, PC, PlayStation, Xbox):
the type is an input, so the few console figures lean on what the totals teach.
Settings are fixed in advance and never tuned on the bench.
"""

from __future__ import annotations

import hashlib
import os

# The tables are tiny: one thread per fit is several times faster than many.
os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np
import pandas as pd
import algorithms
import features
from stats import game_weights, weighted_quantile

INNER_FOLDS = 5
COVERAGE = 0.80


def _inner_fold(game_id: str) -> int:
    return int(hashlib.md5(f"v2-inner:{game_id}".encode()).hexdigest(), 16) % INNER_FOLDS


GROUP_SHRINK = 5  # a publisher's correction counts fully only with many more games than this


def publisher_key(game_ids: pd.Series) -> pd.Series:
    """Publishing group of each game (large groups merged), or its publisher."""
    return game_ids.map(features.context().publisher)


NEIGHBOURS = 15
RESIDUAL_SHARE = 0.5  # how much of the neighbours' typical error is corrected


def neighbour_mean(values: pd.Series, games: pd.Series) -> np.ndarray:
    """For each game of `games`: the similarity-weighted mean of `values` (indexed by
    game) over its most similar games that have one. NaN when none is similar at all."""
    ctx = features.context()
    pool = list(values.index)
    out = np.full(len(games), np.nan)
    if not pool:
        return out
    unique = list(pd.unique(games))
    sim = ctx.similarity(unique, pool)
    top = np.argsort(-sim, axis=1)[:, :NEIGHBOURS]
    weights = np.clip(np.take_along_axis(sim, top, axis=1), 0, None)
    total = weights.sum(axis=1)
    mean = np.where(total > 0, (weights * values.to_numpy()[top]).sum(axis=1) / np.where(total > 0, total, 1), np.nan)
    return pd.Series(mean, index=unique).reindex(games).to_numpy()


class NeighbourPool:
    """What the training games sold per review, to describe a game by its neighbours."""

    def __init__(self, rows: pd.DataFrame):
        known = rows[(rows.steamReviews > 0) & (rows.measure == "ventes")]
        per_review = np.log(known.units / known.steamReviews)
        self.total = per_review[known.target == "TOTAL"].groupby(known.gameId).mean()
        self.pc = per_review[known.target == "PC"].groupby(known.gameId).mean()
        sales = rows[(rows.measure == "ventes") & (rows.target == "TOTAL")]
        self.units = np.log(sales.units).groupby(sales.gameId).mean()

    def features(self, rows: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame({"nb_logTotalPerReview": neighbour_mean(self.total, rows.gameId),
                             "nb_logPcPerReview": neighbour_mean(self.pc, rows.gameId),
                             "nb_logTotal": neighbour_mean(self.units, rows.gameId)}, index=rows.index)


def pc_only_total(rows: pd.DataFrame) -> np.ndarray:
    """Total figures of games that sold on PC and nowhere else at the figure's date."""
    on = features.platforms(rows, features.context())
    return ((rows.target == "TOTAL") & (on.onPc == 1) & (on.platformCount == 1)).to_numpy()


class Learned:
    label = "Modèle appris"
    families: tuple[str, ...] = ("signals", "time", "platforms", "target")
    ratio = False   # learn sales per Steam review instead of sales, when reviews are known
    leak = None     # None: sales only; "plain": leak players count as PC sales; "flag": same, marked as players
    reviews = "steamReviews"  # which reading of the Steam review count: strict, or rebuilt at the date
    peak = "steamPeakPlayers"  # peak players: strictly known, or with the launch month's row from day 3
    algorithm = "boosting"    # see `algorithms.py`
    age_cap_days = None       # past this age a game is described as if it were this old (see `_x`)
    publisher_offset = False  # shift each publisher by the error the common model makes on its other games
    neighbours = None         # "ratio": what similar games sold per review, as inputs;
                              # "residual": shift the estimate by the error made on similar games

    pc_only_is_pc = False  # the total of a game sold on PC only (at that date) is a PC figure

    def _prep(self, rows: pd.DataFrame) -> pd.DataFrame:
        if self.reviews != "steamReviews":
            rows = rows.assign(steamReviews=rows[self.reviews])
        if self.peak != "steamPeakPlayers":
            rows = rows.assign(steamPeakPlayers=rows[self.peak])
        if self.pc_only_is_pc:
            rows = rows.assign(target=rows.target.where(~pc_only_total(rows), "PC"))
        return rows

    # -- one fit ---------------------------------------------------------------
    def _rows(self, train: pd.DataFrame) -> pd.DataFrame:
        return train if self.leak else train[train.measure == "ventes"]

    def _x(self, rows: pd.DataFrame, training: bool) -> pd.DataFrame:
        if self.age_cap_days is None:
            x = features.matrix(rows, self.families)
        else:
            # Within a game, sales per review barely move once it is mature. Left free, the
            # model reads "old" from the few old games that published, all long-running hits,
            # and inflates every old game. Past the cap, time stops for the time inputs.
            cap = pd.Timedelta(days=self.age_cap_days)
            frozen = rows.assign(reportedAt=rows.reportedAt.where(rows.reportedAt <= rows.releaseDate + cap, rows.releaseDate + cap),
                                 ageDays=rows.ageDays.clip(upper=self.age_cap_days))
            history = tuple(f for f in self.families if f in ("track_record", "group_coefficients"))
            x = features.matrix(frozen, tuple(f for f in self.families if f not in history))
            if history:
                x = pd.concat([x, features.matrix(rows, history)], axis=1)
        if self.leak == "flag":
            x["isPlayers"] = (rows.measure == "joueurs").astype(float).to_numpy() if training else 0.0
        return x

    def _core(self, rows: pd.DataFrame):
        """Fit on `rows`; return a function giving log(sales) for new rows."""
        x, y = self._x(rows, True), np.log(rows.units.to_numpy(float))
        pool = NeighbourPool(rows) if self.neighbours == "ratio" else None
        if pool:
            x = pd.concat([x, pool.features(rows)], axis=1)
        columns = [c for c in x if x[c].notna().any()]  # a signal nobody had yet teaches nothing
        x = x[columns]
        w = np.zeros(len(rows))
        for t in rows.target.unique():  # each game counts once per type of figure
            mask = (rows.target == t).to_numpy()
            w[mask] = game_weights(rows.gameId[mask])
        direct = algorithms.make(self.algorithm).fit(x, y, sample_weight=w)
        per_review = None
        known = (rows.steamReviews > 0).to_numpy()
        if self.ratio and known.sum() >= 50:
            offset = np.log(rows.steamReviews.to_numpy(float)[known])
            per_review = algorithms.make(self.algorithm).fit(x[known], y[known] - offset, sample_weight=w[known])

        def predict(new: pd.DataFrame) -> np.ndarray:
            nx = self._x(new, False)
            if pool:
                nx = pd.concat([nx, pool.features(new)], axis=1)
            nx = nx[columns]
            out = direct.predict(nx)
            if per_review is not None:
                has = (new.steamReviews > 0).to_numpy()
                if has.any():
                    out[has] = per_review.predict(nx[has]) + np.log(new.steamReviews.to_numpy(float)[has])
            return out
        return predict

    # -- fit with honest intervals ---------------------------------------------
    def fit(self, train: pd.DataFrame) -> None:
        rows = self._prep(self._rows(train)).reset_index(drop=True)
        # Width of the range: the errors made on training games a sub-model never saw.
        folds = rows.gameId.map(_inner_fold).to_numpy()
        gap = np.zeros(len(rows))  # log(published) - log(estimated), on games the sub-model never saw
        for k in range(INNER_FOLDS):
            gap[folds == k] = np.log(rows.units[folds == k]) - self._core(rows[folds != k])(rows[folds == k])
        sales = (rows.measure == "ventes").to_numpy()
        self.game_gap = pd.Series(gap[sales]).groupby(rows.gameId[sales].to_numpy()).mean()
        if self.neighbours == "residual":  # the width must be the one left after the correction
            gap = gap - RESIDUAL_SHARE * np.nan_to_num(neighbour_mean(self.game_gap, rows.gameId))
        if self.publisher_offset:
            # One mean gap per game, then per publisher, pulled towards zero when the publisher has few games.
            games = pd.DataFrame({"gap": self.game_gap, "key": publisher_key(pd.Series(self.game_gap.index)).to_numpy()})
            groups = games.groupby("key").gap.agg(["sum", "count"])
            self.offsets = (groups["sum"] / (groups["count"] + GROUP_SHRINK)).to_dict()
            # For the width, a training game must not see its own gap in its publisher's correction.
            key = publisher_key(rows.gameId)
            own = rows.gameId.map(self.game_gap).fillna(0).to_numpy()
            total, count = key.map(groups["sum"]).fillna(0).to_numpy(), key.map(groups["count"]).fillna(0).to_numpy()
            seen = rows.gameId.isin(self.game_gap.index).to_numpy()
            gap = gap - (total - own * seen) / (count - seen + GROUP_SHRINK)
        miss = np.abs(gap)
        self.widths = {"*": weighted_quantile(miss[sales], game_weights(rows.gameId[sales]), COVERAGE)}
        for t in rows.target.unique():
            mask = sales & (rows.target == t).to_numpy()
            if rows.gameId[mask].nunique() >= 100:
                self.widths[t] = weighted_quantile(miss[mask], game_weights(rows.gameId[mask]), COVERAGE)
        self.predict_log = self._core(rows)

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        rows = self._prep(rows)
        mid = self.predict_log(rows)
        if self.publisher_offset:
            mid = mid + publisher_key(rows.gameId).map(self.offsets).fillna(0).to_numpy()
        if self.neighbours == "residual":
            mid = mid + RESIDUAL_SHARE * np.nan_to_num(neighbour_mean(self.game_gap, rows.gameId))
        width = rows.target.map(lambda t: self.widths.get(t, self.widths["*"])).to_numpy()
        return pd.DataFrame({"estimate": np.exp(mid), "low": np.exp(mid - width), "high": np.exp(mid + width)}, index=rows.index)


class H1Signals(Learned):
    label = "H1 · appris sur les signaux à la date"


class H2PerReview(Learned):
    label = "H2 · H1, en apprenant les ventes par review"
    ratio = True


class H3Leak(H2PerReview):
    label = "H3 · H2 + joueurs de la fuite Steam à l'apprentissage"
    leak = "plain"


class H3LeakFlag(H2PerReview):
    label = "H3b · H2 + joueurs de la fuite, marqués comme joueurs"
    leak = "flag"


class H4Traits(H2PerReview):
    label = "H4 · H2 + caractéristiques du jeu"
    families = (*H2PerReview.families, "traits")


class H5TrackRecord(H2PerReview):
    label = "H5 · H2 + palmarès de la série et du studio"
    families = (*H2PerReview.families, "track_record")


class H6Combined(H2PerReview):
    label = "H6 · H2 + fuite + caractéristiques + palmarès"
    families = (*H2PerReview.families, "traits", "track_record")
    leak = "plain"


class H7ReviewsAtDate(H6Combined):
    label = "H7 · H6 + reviews reconstruites à la date"
    reviews = "steamReviewsAtDate"


class H8PcOnly(H7ReviewsAtDate):
    label = "H8 · H7 + le total d'un jeu PC seul appris comme un chiffre PC"
    pc_only_is_pc = True


class H9TwoStage(H7ReviewsAtDate):
    """Total of a multi-platform game = its PC sales, estimated by a PC-only model,
    times a multiplier for the consoles learned on the published totals."""

    label = "H9 · H7 + total = PC estimé × multiplicateur des consoles"

    @staticmethod
    def _on(rows: pd.DataFrame) -> pd.DataFrame:
        return features.platforms(rows, features.context())

    def _multi(self, rows: pd.DataFrame) -> np.ndarray:
        on = self._on(rows)
        return ((rows.target == "TOTAL") & (on.onPc == 1) & (on.platformCount >= 2)).to_numpy()

    def _stage_b_x(self, rows: pd.DataFrame, log_pc: np.ndarray) -> pd.DataFrame:
        x = features.matrix(rows, tuple(f for f in self.families if f != "target"))
        x["log_pcEstimate"] = log_pc
        return x

    def fit(self, train: pd.DataFrame) -> None:
        super().fit(train)  # the single model answers everything the two stages do not cover
        rows = self._prep(self._rows(train)).reset_index(drop=True)
        as_pc = rows.assign(target=rows.target.where(~pc_only_total(rows), "PC"))
        is_pc = (as_pc.target == "PC").to_numpy()
        multi = self._multi(rows) & (rows.measure == "ventes").to_numpy()
        folds = rows.gameId.map(_inner_fold).to_numpy()
        # PC estimate of each multi-platform total, by a PC model that never saw the game.
        log_pc = np.full(len(rows), np.nan)
        for k in range(INNER_FOLDS):
            pick = multi & (folds == k)
            if pick.any():
                log_pc[pick] = self._core(as_pc[is_pc & (folds != k)])(rows[pick].assign(target="PC"))
        self.pc_log = self._core(as_pc[is_pc])
        m = rows[multi]
        x = self._stage_b_x(m, log_pc[multi])
        self.b_columns = [c for c in x if x[c].notna().any()]
        y = np.log(m.units.to_numpy(float)) - log_pc[multi]
        w = game_weights(m.gameId)
        fit_b = lambda keep: algorithms.make(self.algorithm).fit(x[self.b_columns][keep], y[keep], sample_weight=w[keep])
        miss, m_folds = np.zeros(len(m)), folds[multi]
        for k in range(INNER_FOLDS):
            miss[m_folds == k] = np.abs(y[m_folds == k] - fit_b(m_folds != k).predict(x[self.b_columns][m_folds == k]))
        self.b_width = weighted_quantile(miss, w, COVERAGE)
        self.multiplier = fit_b(np.ones(len(m), bool))

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        out = super().predict(rows)
        prepped = self._prep(rows)
        multi = self._multi(prepped)
        if multi.any():
            part = prepped[multi]
            log_pc = self.pc_log(part.assign(target="PC"))
            mid = log_pc + self.multiplier.predict(self._stage_b_x(part, log_pc)[self.b_columns])
            out.loc[multi, ["estimate", "low", "high"]] = np.exp(np.column_stack([mid, mid - self.b_width, mid + self.b_width]))
        return out


class H10NeighbourRatio(H7ReviewsAtDate):
    label = "H10 · H7 + ventes par review des jeux voisins"
    neighbours = "ratio"


class H11NeighbourResidual(H7ReviewsAtDate):
    label = "H11 · H7 + correction par l'erreur sur les jeux voisins"
    neighbours = "residual"


class H12Publisher(H7ReviewsAtDate):
    label = "H12 · H7 + éditeur du jeu"
    families = (*H7ReviewsAtDate.families, "publisher")


class H13Stores(H7ReviewsAtDate):
    label = "H13 · H7 + autres boutiques (Epic, GOG, Game Pass)"
    families = (*H7ReviewsAtDate.families, "stores")


class H14GroupCoefficients(H7ReviewsAtDate):
    label = "H14 · H7 + ventes par review de la série, du studio et du groupe éditeur"
    families = (*H7ReviewsAtDate.families, "group_coefficients")


class H15PublisherOffset(H7ReviewsAtDate):
    label = "H15 · H7 + correction par éditeur"
    publisher_offset = True


class H16BigAndSmall:
    """Two separate models: games of the large publishing groups, and all the others."""

    label = "H16 · un modèle pour les gros éditeurs, un pour les autres"

    @staticmethod
    def _big(rows: pd.DataFrame) -> np.ndarray:
        return publisher_key(rows.gameId).isin(features.PUBLISHER_GROUPS).to_numpy()

    def fit(self, train: pd.DataFrame) -> None:
        big = self._big(train)
        self.models = {True: H7ReviewsAtDate(), False: H7ReviewsAtDate()}
        self.models[True].fit(train[big])
        self.models[False].fit(train[~big])

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        big = self._big(rows)
        parts = [self.models[flag].predict(rows[big == flag]) for flag in (True, False) if (big == flag).any()]
        return pd.concat(parts).reindex(rows.index)


class H17AgeCap1(H8PcOnly):
    label = "H17 · H8 + âge du jeu plafonné à 1 an"
    age_cap_days = 365


class H18AgeCap2(H8PcOnly):
    label = "H18 · H8 + âge du jeu plafonné à 2 ans"
    age_cap_days = 730


class H19LaunchPeak(H8PcOnly):
    label = "H19 · H8 + pic de joueurs du lancement connu dès le 3e jour"
    peak = "steamPeakPlayersAtDate"


class H20ReviewEra(H8PcOnly):
    label = "H20 · H8 + époque à laquelle les reviews ont été écrites"
    families = (*H8PcOnly.families, "review_era")


def _with_algorithm(name: str, title: str):
    return type(f"H7{name.title().replace('+', '')}", (H7ReviewsAtDate,), {"algorithm": name, "label": f"H7 · {title}"})


ALGORITHM_VARIANTS = {
    "h7_linear": _with_algorithm("linear", "linéaire (ridge)"),
    "h7_forest": _with_algorithm("forest", "forêt aléatoire"),
    "h7_boosting_linear": _with_algorithm("boosting+linear", "moyenne boosting + linéaire"),
    "h7_forest_linear": _with_algorithm("forest+linear", "moyenne forêt + linéaire"),
    "h7_all_three": _with_algorithm("boosting+forest+linear", "moyenne boosting + forêt + linéaire"),
}

# The model the rest of the lab builds on (anchoring, consoles, catalog). H8 scores like
# H7 on the bench and, unlike it, gives a PC-only game the same PC and total estimates.
BEST_KEY, BEST = "h8_pc_only", H8PcOnly

VARIANTS = {"h20_review_era": H20ReviewEra, "h19_launch_peak": H19LaunchPeak, "h17_age_cap_1": H17AgeCap1, "h18_age_cap_2": H18AgeCap2, "h15_publisher_offset": H15PublisherOffset, "h16_big_and_small": H16BigAndSmall, "h14_group_coefficients": H14GroupCoefficients, "h12_publisher": H12Publisher, "h13_stores": H13Stores, "h10_neighbour_ratio": H10NeighbourRatio, "h11_neighbour_residual": H11NeighbourResidual,
            **ALGORITHM_VARIANTS, "h9_two_stage": H9TwoStage, "h8_pc_only": H8PcOnly, "h7_reviews_at_date": H7ReviewsAtDate, "h6_combined": H6Combined, "h1_signals": H1Signals, "h2_per_review": H2PerReview, "h3_leak": H3Leak, "h3_leak_flag": H3LeakFlag,
            "h4_traits": H4Traits, "h5_track_record": H5TrackRecord}

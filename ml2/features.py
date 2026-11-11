"""Step 4: what a learned model is given about a figure, by family.

Every value is either known at the figure's date (signals, ages, platforms released by
then, figures other games had already published) or a trait of the game that does not
depend on its sales (genre, tags, price, modes). Nothing is fitted here, and missing
values stay missing: the models decide what to do with them.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from dataset import KEPT, PLATFORMS, latest_snapshot

N_TAGS, N_GENRES = 40, 12
DAY = pd.Timedelta(days=1)


PUBLISHER_GROUPS = {
    "Electronic Arts": ("electronic arts", "ea sports", "ea games", "ea originals"),
    "Take-Two": ("2k", "rockstar", "private division", "take-two"),
    "Sony": ("sony", "playstation"),
    "Microsoft": ("microsoft", "xbox game studios", "bethesda", "activision", "blizzard"),
    "Square Enix": ("square enix",),
    "Ubisoft": ("ubisoft",),
    "Bandai Namco": ("bandai", "namco"),
    "Sega": ("sega", "atlus"),
    "Capcom": ("capcom",),
    "Warner": ("warner", "wb games"),
    "Koei Tecmo": ("koei",),
    "Konami": ("konami",),
    "Embracer": ("thq nordic", "deep silver", "plaion", "koch media"),
    "Nintendo": ("nintendo",),
}


def publisher_group(name) -> str | None:
    """The group a publisher label belongs to, or None when it is not one of the large ones."""
    if not isinstance(name, str):
        return None
    low = name.lower()
    for group, needles in PUBLISHER_GROUPS.items():
        if any(low.startswith(n) or f" {n}" in low for n in needles):
            return group
    return None


def _split(text) -> list[str]:
    return [t.strip().lower() for t in text.split(",") if t.strip()] if isinstance(text, str) else []


class Context:
    """Game tables of a snapshot, indexed for the feature families."""

    def __init__(self, snapshot):
        raw = snapshot / "raw"
        self.games = pd.read_parquet(raw / "games.parquet").set_index("id")
        releases = pd.read_parquet(raw / "release_dates.parquet")
        releases["releaseDate"] = pd.to_datetime(releases.releaseDate, utc=True)
        self.release = releases.pivot_table(index="gameId", columns="platform", values="releaseDate", aggfunc="min")
        self.price = pd.read_parquet(raw / "prices.parquet").set_index("gameId").priceCents
        catalog = pd.read_parquet(snapshot / "catalog.parquet")
        scope = self.games.loc[catalog.gameId]
        # Vocabulary from the whole catalog, never from the sales figures.
        self.tags = list(pd.Series([t for s in scope.steamTags for t in _split(s)[:10]]).value_counts().index[:N_TAGS])
        self.genres = list(pd.Series([t for s in scope.genres for t in _split(s)]).value_counts().index[:N_GENRES])
        self.game_tags = {gid: set(_split(s)[:10]) for gid, s in self.games.steamTags.items()}
        self.game_genres = {gid: set(_split(s)) for gid, s in self.games.genres.items()}
        # Published totals, for the track record of a series and of a studio.
        figures = pd.read_parquet(snapshot / "figures.parquet")
        totals = figures[(figures.status == KEPT) & (figures.target == "TOTAL")].sort_values("reportedAt")
        self.totals = {gid: (rows.reportedAt.to_numpy("datetime64[ns]"), rows.units.to_numpy(float))
                       for gid, rows in totals.groupby("gameId")}
        known = totals[totals.steamReviewsAtDate > 0]
        self.per_review = {gid: (rows.reportedAt.to_numpy("datetime64[ns]"), np.log(rows.units / rows.steamReviewsAtDate).to_numpy(float))
                           for gid, rows in known.groupby("gameId")}
        # One key per publishing group: IGDB splits them ("EA Sports" / "Electronic Arts", "2K" / "2K Games").
        group = self.games.publisher.map(publisher_group)
        publisher = group.where(group.notna(), self.games.publisherId)
        self.publisher = publisher.to_dict()
        self.by_publisher = {k: list(v) for k, v in publisher.dropna().groupby(publisher.dropna()).groups.items()}
        self.first_release = dict(zip(catalog.gameId, pd.to_datetime(catalog.firstRelease, utc=True)))
        series = self.games.seriesSlug.fillna(self.games.franchiseSlug)
        self.series = series.to_dict()
        self.by_series = {k: list(v) for k, v in series.dropna().groupby(series.dropna()).groups.items()}
        self._similarity_vectors()
        self.publisher_games = scope.publisherId.value_counts()
        self.studio_games = scope.developerId.value_counts()
        self.top_publishers = list(self.publisher_games.index[:25])
        studio = self.games.developerId
        self.studio = studio.to_dict()
        self.by_studio = {k: list(v) for k, v in studio.dropna().groupby(studio.dropna()).groups.items()}

    def _similarity_vectors(self) -> None:
        """One vector per game from its Steam tags and genres, rare ones weighing more.
        Two games are similar when their vectors point the same way (cosine)."""
        tokens = {gid: self.game_tags[gid] | {f"genre:{g}" for g in self.game_genres[gid]} for gid in self.games.index}
        counts = pd.Series([t for ts in tokens.values() for t in ts]).value_counts()
        counts = counts[counts >= 5]
        column = {t: i for i, t in enumerate(counts.index)}
        weight = np.log(len(tokens) / counts.to_numpy())
        self.vector_row = {gid: i for i, gid in enumerate(self.games.index)}
        vectors = np.zeros((len(tokens), len(column)), dtype=np.float32)
        for gid, ts in tokens.items():
            for t in ts:
                if t in column:
                    vectors[self.vector_row[gid], column[t]] = weight[column[t]]
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        self.vectors = vectors / np.where(norms > 0, norms, 1)

    def similarity(self, games: list[str], pool: list[str]) -> np.ndarray:
        """Similarity (0 to 1) of each game to each game of the pool; a game is never its own neighbour."""
        a = self.vectors[[self.vector_row[g] for g in games]]
        b = self.vectors[[self.vector_row[g] for g in pool]]
        sim = a @ b.T
        sim[np.asarray(games)[:, None] == np.asarray(pool)[None, :]] = -1
        return sim

    def per_review_before(self, game_id: str, peers: list[str], t: np.datetime64) -> tuple[float, int]:
        """Mean log(sales per Steam review) the other games of a group had shown before `t`
        (the latest figure of each), and how many games that is."""
        values = []
        for peer in peers:
            if peer == game_id or peer not in self.per_review:
                continue
            times, logs = self.per_review[peer]
            known = logs[times < t]
            if len(known):
                values.append(known[-1])
        return (float(np.mean(values)), len(values)) if values else (np.nan, 0)

    def best_before(self, game_id: str, peers: list[str], t: np.datetime64) -> tuple[float, int]:
        """Best total an earlier game of the group had published before `t`, and how many such games."""
        mine = self.first_release.get(game_id)
        best, count = np.nan, 0
        for peer in peers:
            theirs = self.first_release.get(peer)
            if peer == game_id or peer not in self.totals or pd.isna(theirs) or (pd.notna(mine) and theirs >= mine):
                continue
            times, units = self.totals[peer]
            known = units[times < t]
            if len(known):
                best, count = np.nanmax([best, known.max()]), count + 1
        return best, count


@lru_cache(maxsize=2)
def context(snapshot=None) -> Context:
    return Context(snapshot or latest_snapshot())


def _log(values) -> pd.Series:
    return np.log1p(values.where(values > 0))


def signals(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    out = pd.DataFrame(index=rows.index)
    for col in ("steamReviews", "steamPeakPlayers", "psRatings", "xboxRatings", "steamFollowers", "twitchViewers30d",
                "steamBestSalesRank", "steamMedianPlaytime", "steamReviewsAgeDays"):
        out[f"log_{col}"] = _log(rows[col])
    for col in ("steamPositiveShare", "psAverage", "xboxAverage"):
        out[col] = rows[col]
    out["log_reviewsPerDay"] = np.log((rows.steamReviews / rows.ageDays.clip(lower=1)).where(rows.steamReviews > 0))
    out["log_peakPerReview"] = np.log((rows.steamPeakPlayers / rows.steamReviews).where((rows.steamReviews > 0) & (rows.steamPeakPlayers > 0)))
    return out


def time(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    year = lambda d: d.dt.year + (d.dt.dayofyear - 1) / 365.25
    return pd.DataFrame({"log_ageDays": np.log1p(rows.ageDays.clip(lower=0)), "releaseYear": year(rows.releaseDate),
                         "reportYear": year(rows.reportedAt)}, index=rows.index)


def platforms(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    out = pd.DataFrame(index=rows.index)
    listed = rows.gameId.map(lambda g: set(ctx.games.platforms.get(g) if ctx.games.platforms.get(g) is not None else []))
    for p in PLATFORMS:
        date = rows.gameId.map(ctx.release[p]) if p in ctx.release else pd.Series(pd.NaT, index=rows.index)
        days = (rows.reportedAt - date) / DAY
        # Released by the figure's date; listed without a date counts as released.
        out[f"on{p.title()}"] = np.where(date.notna(), days >= 0, listed.map(lambda s, p=p: p in s)).astype(float)
        out[f"log_daysOn{p.title()}"] = np.log1p(days.where(days >= 0))
    out["platformCount"] = out[[f"on{p.title()}" for p in PLATFORMS]].sum(axis=1)
    out["log_pcDelayDays"] = np.log1p(((rows.gameId.map(ctx.release["PC"]) - rows.releaseDate) / DAY).clip(lower=0))
    return out


def target(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    return pd.DataFrame({f"is{t.title()}": (rows.target == t).astype(float) for t in ("TOTAL", *PLATFORMS)}, index=rows.index)


def traits(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    g = ctx.games.reindex(rows.gameId)
    out = pd.DataFrame({
        "log_price": np.log1p(rows.gameId.map(ctx.price).to_numpy(float)),
        "log_timeToBeat": np.log1p(g.timeToBeatSeconds.to_numpy(float)),
        "log_dlcCount": np.log1p(g.dlcCount.fillna(0).to_numpy(float)),
        "annualIteration": g.isAnnualIteration.fillna(False).to_numpy(float),
        "liveService": g.liveService.fillna(False).to_numpy(float),
        "inSeries": rows.gameId.map(ctx.series).notna().to_numpy(float),
        "mainGame": (g.gameType.fillna("MAIN_GAME") == "MAIN_GAME").to_numpy(float),
        "multiplayer": g.gameModes.map(lambda m: float(m is not None and any(x != "SINGLE_PLAYER" for x in m))).to_numpy(),
        "singlePlayer": g.gameModes.map(lambda m: float(m is not None and "SINGLE_PLAYER" in m)).to_numpy(),
    }, index=rows.index)
    for tag in ctx.tags:
        out[f"tag_{tag}"] = rows.gameId.map(lambda gid, tag=tag: float(tag in ctx.game_tags.get(gid, ()))).to_numpy()
    for genre in ctx.genres:
        out[f"genre_{genre}"] = rows.gameId.map(lambda gid, genre=genre: float(genre in ctx.game_genres.get(gid, ()))).to_numpy()
    return out


def track_record(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    out = []
    for r in rows.itertuples():
        t = r.reportedAt.to_datetime64()
        s_best, s_n = ctx.best_before(r.gameId, ctx.by_series.get(ctx.series.get(r.gameId), []), t)
        d_best, d_n = ctx.best_before(r.gameId, ctx.by_studio.get(ctx.studio.get(r.gameId), []), t)
        out.append((np.log(s_best) if s_n else np.nan, s_n, np.log(d_best) if d_n else np.nan, d_n))
    return pd.DataFrame(out, index=rows.index, columns=["log_seriesBest", "seriesGames", "log_studioBest", "studioGames"])


def stores(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    """Other places the PC version is sold or given: sales there leave no Steam review."""
    g = ctx.games.reindex(rows.gameId)
    return pd.DataFrame({c: g[c].fillna(False).to_numpy(float) for c in ("onEpic", "onGog", "gamePass")}, index=rows.index)


def publisher(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    """Who publishes the game: how many catalog games the publisher and the studio have,
    and which of the 25 largest publishers it is (their own launchers, their console weight)."""
    g = ctx.games.reindex(rows.gameId)
    out = pd.DataFrame({"log_publisherGames": np.log1p(g.publisherId.map(ctx.publisher_games).to_numpy(float)),
                        "log_studioGames": np.log1p(g.developerId.map(ctx.studio_games).to_numpy(float))}, index=rows.index)
    for i, pid in enumerate(ctx.top_publishers):
        out[f"publisher_{i:02d}"] = (g.publisherId == pid).to_numpy(float)
    return out


def group_coefficients(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    """What the other games of the same series, studio and publisher sold per Steam
    review, from the figures they had published before this one."""
    out = []
    for r in rows.itertuples():
        t = r.reportedAt.to_datetime64()
        values = []
        for index, members in ((ctx.series, ctx.by_series), (ctx.studio, ctx.by_studio), (ctx.publisher, ctx.by_publisher)):
            values.extend(ctx.per_review_before(r.gameId, members.get(index.get(r.gameId), []), t))
        out.append(values)
    return pd.DataFrame(out, index=rows.index, columns=["log_seriesPerReview", "seriesFigures", "log_studioPerReview",
                                                        "studioFigures", "log_publisherPerReview", "publisherFigures"])


def review_era(rows: pd.DataFrame, ctx: Context) -> pd.DataFrame:
    """WHEN the game's Steam reviews were written. Players review more and more over the
    years, so a review from 2018 stands for more sales than one from 2025. With no
    history yet (a launch), the reviews are as old as the figure itself."""
    report = rows.reportedAt.dt.year + (rows.reportedAt.dt.dayofyear - 1) / 365.25
    mean = rows.steamReviewsMeanYear.fillna(report)
    before = rows.steamReviewsShareBefore2020.fillna((report < 2020).astype(float))
    return pd.DataFrame({"reviewsMeanYear": mean, "reviewsShareBefore2020": before, "reviewsYearsOld": report - mean}, index=rows.index)


FAMILIES = {"review_era": review_era, "group_coefficients": group_coefficients, "stores": stores, "publisher": publisher, "signals": signals, "time": time, "platforms": platforms, "target": target, "traits": traits,
            "track_record": track_record}


def matrix(rows: pd.DataFrame, families: tuple[str, ...]) -> pd.DataFrame:
    ctx = context()
    return pd.concat([FAMILIES[f](rows, ctx) for f in families], axis=1).astype(float)

"""Step 1b: the two tables every later step reads.

`figures.parquet`: one row per published sales figure, with its status (kept, or
why it is dropped) and what the site knew about the game AT THE FIGURE'S DATE.
`catalog.parquet`: one row per game the site has to estimate, with today's signals.

Nothing here is a modelling choice: no transform, no imputation, no split.

    ../ml/.venv/bin/python dataset.py            # latest snapshot
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"

# The site publishes no estimate for games released before 2017.
SCOPE_START = pd.Timestamp("2017-01-01", tz="UTC")

# Rows imported from monthly history (SteamCharts, Steam review histogram) are stamped
# on the FIRST day of the month but hold the value at the END of that month: 2,114 of
# 2,670 games released after the 10th have a review row dated before their release.
# Such a row is only known once its month is over. Live polling replaced the monthly
# imports in September 2026.
MONTHLY_METRICS = ("STEAM_REVIEWS", "STEAM_CONCURRENT", "STEAM_PEAK_CCU")
MONTHLY_UNTIL = pd.Timestamp("2026-09-01", tz="UTC")

# People review more and more: Steam has prompted players for a review since late 2019,
# and a review written before stands for more sales than one written since.
REVIEW_PROMPT = np.datetime64("2020-01-01")

# Reviews pile up like the square root of the days since release during a launch
# (33 games with daily readings: 37 % of the day-30 count on day 3, 60 % on day 7).
LAUNCH_EXPONENT = 0.5
MAX_LOOK_AHEAD = np.timedelta64(31, "D")  # a monthly row is at most a month away
FRESH = np.timedelta64(2, "D")

PLAYER_SOURCES = {"STEAM_LEAK", "PLAYSTATION_LEAK"}  # owners or players, not sales
ALINEA_RE = re.compile(r"alinea|aliena|rhys\s*elliott?", re.I)
PLATFORMS = ("PC", "PLAYSTATION", "XBOX")

KEPT = "gardé"
EXCLUSIONS = Path(__file__).resolve().parent / "exclusions.csv"


def excluded_games(games: pd.DataFrame) -> pd.Series:
    """Reason per game excluded by hand (`exclusions.csv`: a whole series, or one game id).

    Their signals do not follow their sales, so they neither teach nor judge a model.
    """
    reasons = pd.Series("", index=games.index)
    if "estimateHidden" in games:  # the admin's own switch: signals that do not measure the game alone
        reasons[games.estimateHidden.fillna(False).to_numpy(bool)] = "Estimate hidden in the admin"
    for rule in pd.read_csv(EXCLUSIONS).itertuples():
        hit = (games.seriesSlug == rule.value) | (games.franchiseSlug == rule.value) if rule.kind == "series" \
            else games.index == rule.value
        reasons[hit] = rule.reason
    return reasons


def latest_snapshot() -> Path:
    dirs = sorted(p for p in DATA_DIR.iterdir() if (p / "manifest.json").exists()) if DATA_DIR.exists() else []
    if not dirs:
        raise FileNotFoundError("No snapshot: run `python export.py` first.")
    return dirs[-1]


def with_available_at(signals: pd.DataFrame) -> pd.DataFrame:
    """Add `availableAt`: the moment a reading could really be known."""
    at = signals.capturedAt
    monthly = (signals.metric.isin(MONTHLY_METRICS) & (at.dt.day == 1) & (at.dt.hour <= 2) & (at < MONTHLY_UNTIL))
    start = at.dt.floor("D")
    next_month = (start.dt.tz_localize(None) + pd.offsets.MonthBegin(1)).dt.tz_localize("UTC")
    out = signals.copy()
    out["availableAt"] = at.where(~monthly, next_month)
    out["monthly"] = monthly
    return out


class SignalStore:
    """Per metric and game: readings sorted by the time they became known."""

    def __init__(self, signals: pd.DataFrame, time: str = "availableAt"):
        self.series: dict[str, dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]] = {}
        signals = signals.rename(columns={time: "at"}).sort_values(["metric", "gameId", "at"])
        for metric, by_metric in signals.groupby("metric", observed=True):
            games = {}
            for game_id, rows in by_metric.groupby("gameId", sort=False):
                games[game_id] = (rows["at"].to_numpy("datetime64[ns]"), rows.value.to_numpy(float),
                                  rows.rating.to_numpy(float))
            self.series[str(metric)] = games

    def _until(self, metric: str, game_id: str, t: np.datetime64):
        s = self.series.get(metric, {}).get(game_id)
        if s is None:
            return None
        n = int(np.searchsorted(s[0], t, side="right"))
        return (s[0][:n], s[1][:n], s[2][:n]) if n else None

    def latest(self, metric: str, game_id: str, t: np.datetime64):
        """(value, rating, known since) of the last reading known at `t`, or None."""
        s = self._until(metric, game_id, t)
        return (s[1][-1], s[2][-1], s[0][-1]) if s else None

    def around(self, metric: str, game_id: str, t: np.datetime64):
        """((time, value) of the last reading known at `t`, (time, value) of the next one); None when missing."""
        s = self.series.get(metric, {}).get(game_id)
        if s is None:
            return None, None
        n = int(np.searchsorted(s[0], t, side="right"))
        return ((s[0][n - 1], s[1][n - 1]) if n else None), ((s[0][n], s[1][n]) if n < len(s[0]) else None)

    def accrual(self, metric: str, game_id: str, t: np.datetime64, split: np.datetime64) -> tuple[float, float]:
        """When a cumulative count known at `t` was built up: the mean year of its
        increments, and the share of them that came before `split`. NaN when unknown."""
        s = self._until(metric, game_id, t)
        if not s:
            return float("nan"), float("nan")
        gained = np.clip(np.diff(s[1], prepend=0.0), 0, None)
        if gained.sum() <= 0:
            return float("nan"), float("nan")
        years = s[0].astype("datetime64[D]").astype(float) / 365.2425 + 1970
        return float(np.average(years, weights=gained)), float(gained[s[0] < split].sum() / gained.sum())

    def highest(self, metric: str, game_id: str, t: np.datetime64) -> float | None:
        s = self._until(metric, game_id, t)
        return float(s[1].max()) if s else None

    def lowest(self, metric: str, game_id: str, t: np.datetime64) -> float | None:
        s = self._until(metric, game_id, t)
        return float(s[1].min()) if s else None

    def median_last_days(self, metric: str, game_id: str, t: np.datetime64, days: int) -> float | None:
        s = self._until(metric, game_id, t)
        if not s:
            return None
        recent = s[1][s[0] > t - np.timedelta64(days, "D")]
        return float(np.median(recent)) if len(recent) else None


def reviews_at_date(before, after, t: np.datetime64, release) -> tuple[float, str]:
    """Steam reviews on day `t`, rebuilt from the readings around it.

    Monthly history only says the count at each month's end. Reading the last known
    month end is stale (nothing at all during a launch month); reading the next one
    shows the future. Between two readings, the count is placed on the usual curve
    (square root of the days since release). This uses a reading taken after `t`, at
    most a month later, only to locate the count on `t`: the site now reads it daily.
    """
    if before is not None and t - before[0] <= FRESH:
        return before[1], "relevé du jour"
    usable = after is not None and after[0] - t <= MAX_LOOK_AHEAD
    if not usable:
        return (before[1], "dernier relevé connu") if before is not None else (float("nan"), "aucun relevé")
    days = lambda at: max((at - release) / np.timedelta64(1, "D"), 0.5) ** LAUNCH_EXPONENT
    if before is None:
        if release is None or after[0] <= release:
            return float("nan"), "aucun relevé"
        if t < release:
            return 0.0, "avant la sortie PC"
        return after[1] * days(t) / days(after[0]), "courbe de lancement"
    if release is None or before[0] <= release:  # no curve to follow: straight line in time
        share = (t - before[0]) / (after[0] - before[0])
    else:
        share = (days(t) - days(before[0])) / (days(after[0]) - days(before[0]))
    return before[1] + (after[1] - before[1]) * share, "entre deux relevés"


def total_reason(figures: pd.DataFrame, games: pd.DataFrame, releases: pd.DataFrame) -> pd.Series:
    """Why a sales figure counts as the game's total, or "" when it does not.

    A platform figure is the total when the game sold on no other platform at that
    date. A platform the game is listed on, has a release date for, or has a figure
    for counts as released unless its release date is after the figure's day.
    """
    listed = games.platforms.map(lambda ps: set(ps) if ps is not None else set())
    dates = {(r.gameId, r.platform): r.releaseDate for r in releases.itertuples()}
    seen = figures[figures.platform.isin(PLATFORMS)].groupby("gameId").platform.agg(set)
    out = []
    for r in figures.itertuples():
        if r.platform == "GLOBAL":
            out.append("chiffre monde")
            continue
        if r.platform not in PLATFORMS or r.source in PLAYER_SOURCES or pd.isna(r.reportedAt):
            out.append("")
            continue
        others = (listed.get(r.gameId, set()) | seen.get(r.gameId, set())
                  | {p for p in PLATFORMS if (r.gameId, p) in dates}) - {r.platform}
        day = r.reportedAt.floor("D")
        released = [p for p in others if not (pd.notna(dates.get((r.gameId, p))) and dates[(r.gameId, p)] > day)]
        out.append("" if released else ("seule plateforme du jeu" if not others else "seule plateforme à cette date"))
    return pd.Series(out, index=figures.index)


def _origin(row) -> str:
    if row.source == "STEAM_LEAK":
        return "Fuite Steam 2018"
    if row.source == "PLAYSTATION_LEAK":
        return "Fuite PlayStation"
    if ALINEA_RE.search(" ".join(str(v) for v in (row.publisher, row.note, row.sourceUrl) if isinstance(v, str))):
        return "Alinea"
    return {"OFFICIAL": "Officiel", "ANNOUNCEMENT": "Officiel", "WIKIPEDIA": "Wikipédia"}.get(row.source, "Média")


def _peak(store: SignalStore, game_id: str, t: np.datetime64) -> float:
    peaks = [p for p in (store.highest("STEAM_CONCURRENT", game_id, t), store.highest("STEAM_PEAK_CCU", game_id, t))
             if p is not None]
    return max(peaks) if peaks else float("nan")


# The peak of a game's launch month is reached by its 3rd day for 8 games in 10, by its
# 5th for 9 in 10 (43 games with daily readings). From then on the monthly row of the
# launch says what the peak already was.
LAUNCH_PEAK_AFTER = np.timedelta64(3, "D")
LAUNCH_MONTHS = np.timedelta64(31, "D")


def launch_peak(store: SignalStore, stamped: SignalStore, game_id: str, t: np.datetime64, release) -> float:
    """Peak concurrent players known at `t`, counting the launch month's own row once
    the launch is 3 days old."""
    strict = _peak(store, game_id, t)
    if release is None or t < release + LAUNCH_PEAK_AFTER:
        return strict
    launch = _peak(stamped, game_id, min(t - LAUNCH_PEAK_AFTER, release + LAUNCH_MONTHS))
    return float(np.nanmax([strict, launch])) if not (np.isnan(strict) and np.isnan(launch)) else float("nan")


def signals_at(store: SignalStore, game_id: str, t: np.datetime64, stamped: SignalStore | None = None,
               pc_release=None) -> dict:
    """What the site's sources said about a game at `t`. NaN = nothing known yet.

    `stamped` reads monthly rows by their stamp instead of the end of their month:
    the `...Stamped` columns can hold up to a month of future. They exist to measure
    that leak, and to see launch figures that monthly history cannot date.
    """
    nan = float("nan")
    stamped = stamped or store
    reviews_stamped = stamped.latest("STEAM_REVIEWS", game_id, t)
    mean_year, before_prompt = store.accrual("STEAM_REVIEWS", game_id, t, REVIEW_PROMPT)
    rebuilt, basis = reviews_at_date(*store.around("STEAM_REVIEWS", game_id, t), t, pc_release)
    reviews = store.latest("STEAM_REVIEWS", game_id, t)
    ps = store.latest("PS_RATINGS", game_id, t)
    xbox = store.latest("XBOX_RATINGS", game_id, t)
    followers = store.latest("STEAM_FOLLOWERS", game_id, t)
    rank = store.lowest("STEAM_TOPSELLER_RANK", game_id, t)
    twitch = store.median_last_days("TWITCH_VIEWERS", game_id, t, 30)
    playtime = store.latest("STEAM_REVIEWER_MEDIAN_PLAYTIME", game_id, t)
    return {
        "steamReviews": reviews[0] if reviews else nan,
        "steamPositiveShare": reviews[1] if reviews else nan,
        "steamReviewsAgeDays": (t - reviews[2]) / np.timedelta64(1, "D") if reviews else nan,
        "steamPeakPlayers": _peak(store, game_id, t),
        "steamReviewsStamped": reviews_stamped[0] if reviews_stamped else nan,
        "steamReviewsAtDate": rebuilt,
        "steamReviewsBasis": basis,
        "steamReviewsMeanYear": mean_year,
        "steamReviewsShareBefore2020": before_prompt,
        "steamPeakPlayersStamped": _peak(stamped, game_id, t),
        "steamPeakPlayersAtDate": launch_peak(store, stamped, game_id, t, pc_release),
        "psRatings": ps[0] if ps else nan,
        "psAverage": ps[1] if ps else nan,
        "xboxRatings": xbox[0] if xbox else nan,
        "xboxAverage": xbox[1] if xbox else nan,
        "steamFollowers": followers[0] if followers else nan,
        "steamBestSalesRank": rank if rank is not None else nan,
        "twitchViewers30d": twitch if twitch is not None else nan,
        "steamMedianPlaytime": playtime[0] if playtime else nan,
    }


SIGNAL_COLUMNS = list(signals_at(SignalStore(pd.DataFrame(
    {"metric": pd.Series(dtype="category"), "gameId": [], "availableAt": [], "value": [], "rating": []})),
    "", np.datetime64("2020-01-01")))


def build(snapshot: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = snapshot / "raw"
    games = pd.read_parquet(raw / "games.parquet").set_index("id")
    figures = pd.read_parquet(raw / "figures.parquet")
    releases = pd.read_parquet(raw / "release_dates.parquet")
    prices = pd.read_parquet(raw / "prices.parquet").set_index("gameId").priceCents
    signals = with_available_at(pd.read_parquet(raw / "signals.parquet"))
    store, stamped = SignalStore(signals), SignalStore(signals, time="capturedAt")

    games["releaseDate"] = pd.to_datetime(games.releaseDate, utc=True)
    releases["releaseDate"] = pd.to_datetime(releases.releaseDate, utc=True)
    by_platform = releases.pivot_table(index="gameId", columns="platform", values="releaseDate", aggfunc="min")
    # First release anywhere: `game.releaseDate` is sometimes a later port or the 1.0 date.
    games["firstRelease"] = pd.concat([games.releaseDate, by_platform.min(axis=1).reindex(games.index)], axis=1).min(axis=1)
    games["inScope"] = (~games.deleted & ~games.isFree.fillna(False)
                        & (games.firstRelease.isna() | (games.firstRelease >= SCOPE_START)))

    games["excluded"] = excluded_games(games)

    # ---- figures -------------------------------------------------------------
    f = figures.rename(columns={"id": "figureId"}).copy()
    f["reportedAt"] = pd.to_datetime(f.reportedAt, utc=True)
    f = f[f.gameId.isin(games.index)].copy()
    g = games.loc[f.gameId]
    f["game"] = g.name.to_numpy()
    f["slug"] = g.slug.to_numpy()
    f["releaseDate"] = g.firstRelease.to_numpy()
    f["origin"] = [_origin(r) for r in f.itertuples()]
    f["measure"] = np.where(f.source.isin(PLAYER_SOURCES), "joueurs", "ventes")
    f["totalBecause"] = total_reason(f, games, releases)
    f["target"] = np.where(f.totalBecause != "", "TOTAL", f.platform)

    # The figure counts sales up to its day: readings of that day are fair game.
    f["knownUntil"] = f.reportedAt.dt.floor("D") + pd.Timedelta(days=1)
    f["ageDays"] = (f.reportedAt - f.releaseDate) / pd.Timedelta(days=1)

    reasons = [
        (f.rejected, "rejeté dans l'admin"),
        (f.isEngagement, "engagement (joueurs, pas des ventes)"),
        (f.reportedAt.isna(), "sans date"),
        (g.deleted.to_numpy(), "jeu supprimé"),
        (g.isFree.fillna(False).to_numpy(), "jeu gratuit"),
        ((g.excluded != "").to_numpy(), "jeu exclu à la main"),
        ((g.firstRelease < SCOPE_START).to_numpy(), "jeu sorti avant 2017"),
        (f.units <= 0, "chiffre à zéro"),
        (f.isEstimate, "estimation d'un tiers"),
        (f.platform == "SWITCH", "Switch (non estimée par le site)"),
        (f.ageDays < 0, "daté avant la sortie"),
    ]
    f["status"] = np.select([c for c, _ in reasons], [r for _, r in reasons], default=KEPT)
    # The same figure repeated (a threshold quoted again later): keep its first date.
    kept = f[f.status == KEPT].sort_values("reportedAt")
    repeated = kept[kept.duplicated(["gameId", "target", "measure", "units"], keep="first")].index
    f.loc[repeated, "status"] = "même chiffre répété"

    # PC release, or the game's first release when the PC date is missing but Steam reads it.
    pc_release = {gid: d.to_datetime64() for gid, d in games.firstRelease.dropna().items() if gid in store.series.get("STEAM_REVIEWS", {})}
    pc_release.update({gid: d.to_datetime64() for gid, d in by_platform["PC"].dropna().items()})
    rows = [signals_at(store, r.gameId, r.knownUntil.to_datetime64(), stamped, pc_release.get(r.gameId))
            if pd.notna(r.knownUntil) else dict.fromkeys(SIGNAL_COLUMNS, float("nan")) for r in f.itertuples()]
    f = pd.concat([f.reset_index(drop=True), pd.DataFrame(rows)], axis=1)
    f = f.drop(columns=["isEngagement", "rejected", "publisher", "confidenceScore"])

    # ---- catalog -------------------------------------------------------------
    c = games[games.inScope].copy()
    now = np.datetime64(pd.Timestamp(pd.read_json(snapshot / "manifest.json", typ="series").exportedAt).tz_convert(None))
    today = pd.DataFrame([signals_at(store, gid, now) for gid in c.index], index=c.index)
    today = today.drop(columns=["steamReviewsAtDate", "steamReviewsBasis", "steamPeakPlayersAtDate"])
    c = pd.concat([c, today], axis=1)
    for p in PLATFORMS:
        c[f"on{p.title()}"] = c.platforms.map(lambda ps, p=p: p in list(ps) if ps is not None else False)
        c[f"release{p.title()}"] = by_platform[p].reindex(c.index) if p in by_platform else pd.NaT
    c["priceCents"] = prices.reindex(c.index)
    ok = f[f.status == KEPT]
    for target, col in (("TOTAL", "Total"), ("PC", "Pc"), ("PLAYSTATION", "Playstation"), ("XBOX", "Xbox")):
        sales = ok[(ok.target == target) & (ok.measure == "ventes")].groupby("gameId").units
        c[f"figures{col}"] = sales.count().reindex(c.index).fillna(0).astype(int)
        c[f"best{col}"] = sales.max().reindex(c.index)
    players = ok[ok.measure == "joueurs"].groupby("gameId").units
    c["playersLeak"] = players.max().reindex(c.index)
    c = c.drop(columns=["inScope", "deleted"]).reset_index().rename(columns={"id": "gameId"})
    return f, c


def main() -> None:
    snapshot = Path(sys.argv[1]) if len(sys.argv) > 1 else latest_snapshot()
    figures, catalog = build(snapshot)
    figures.to_parquet(snapshot / "figures.parquet", index=False)
    catalog.to_parquet(snapshot / "catalog.parquet", index=False)
    kept = figures[figures.status == KEPT]
    print(f"{snapshot.name}: {len(figures):,} figures, {len(kept):,} kept on {kept.gameId.nunique():,} games; "
          f"catalog {len(catalog):,} games")
    print(figures.status.value_counts().to_string())
    print(kept.groupby(["target", "measure"]).agg(figures=("units", "size"), games=("gameId", "nunique")).to_string())


if __name__ == "__main__":
    main()

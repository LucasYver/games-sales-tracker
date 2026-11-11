"""Step 4 check: how well `reviews_at_date` rebuilds a daily count from monthly rows.

Takes games read daily, keeps only what monthly history would have kept (the count at
each month's end), rebuilds every other day and compares with the real reading.

    ../ml/.venv/bin/python check_reviews_at_date.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from dataset import MONTHLY_METRICS, latest_snapshot, reviews_at_date, with_available_at

DAY = np.timedelta64(1, "D")


def main() -> None:
    raw = latest_snapshot() / "raw"
    signals = with_available_at(pd.read_parquet(raw / "signals.parquet"))
    live = signals[(signals.metric == "STEAM_REVIEWS") & ~signals.monthly & (signals.value > 0)]
    releases = pd.read_parquet(raw / "release_dates.parquet")
    pc = pd.to_datetime(releases[releases.platform == "PC"].set_index("gameId").releaseDate, utc=True)
    rows = []
    for game_id, readings in live.groupby("gameId"):
        times = readings.capturedAt.to_numpy("datetime64[ns]")
        values = readings.value.to_numpy(float)
        order = np.argsort(times)
        times, values = times[order], values[order]
        if game_id not in pc.index or pd.isna(pc[game_id]) or times[-1] - times[0] < 40 * DAY:
            continue
        release = pc[game_id].to_datetime64()
        months = pd.date_range(pd.Timestamp(times[0]).floor("D") + pd.offsets.MonthBegin(1), pd.Timestamp(times[-1]), freq="MS")
        ends = []
        for m in months.to_numpy("datetime64[ns]"):  # what a monthly row would hold
            i = int(np.searchsorted(times, m, side="right")) - 1
            if i >= 0 and m - times[i] <= 2 * DAY:
                ends.append((m, values[i]))
        for at, value in zip(times[::3], values[::3]):  # one day in three is enough
            before = next(((m, v) for m, v in reversed(ends) if m <= at), None)
            after = next(((m, v) for m, v in ends if m > at), None)
            if after is None or (before is None and at - release > 31 * DAY) or (before is not None and at - before[0] <= 2 * DAY):
                continue
            rebuilt, basis = reviews_at_date(before, after, at, release)
            rows.append((game_id, (at - release) / DAY, value, rebuilt, before[1] if before else np.nan, after[1], basis))
    t = pd.DataFrame(rows, columns=["gameId", "age", "real", "rebuilt", "lastMonthEnd", "nextMonthEnd", "basis"])
    t = t[t.rebuilt > 0]
    t["when"] = pd.cut(t.age, [-1, 7, 30, 365, 1e6], labels=["1re semaine", "8 – 30 jours", "1 – 12 mois", "plus d'un an"])
    factor = lambda est: np.exp(np.abs(np.log(est / t.real)))
    t["Reconstruit"], t["Dernière fin de mois (strict)"], t["Fin du mois en cours (futur)"] = \
        factor(t.rebuilt), factor(t.lastMonthEnd.where(t.lastMonthEnd > 0)), factor(t.nextMonthEnd)
    t["biais"] = t.rebuilt / t.real
    per_game = t.groupby(["when", "gameId"], observed=True)[["Reconstruit", "Dernière fin de mois (strict)",
                                                           "Fin du mois en cours (futur)", "biais"]].median()
    out = per_game.groupby("when", observed=True).median().round(3)
    out.insert(0, "jeux", per_game.groupby("when", observed=True).size())
    print("Typical factor between each reading of the count and the real count (each game counts once)")
    print(out.to_string())


if __name__ == "__main__":
    main()

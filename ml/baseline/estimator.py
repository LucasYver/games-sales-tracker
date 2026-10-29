"""Portage de `backend/src/estimation/estimation.service.ts`.

`Estimator.estimate(game_id, as_of)` refait le calcul de la prod en ne
regardant QUE les signaux capturés avant `as_of` (voyage dans le temps), et
renvoie les fourchettes par méthode, l'agrégat par plateforme et le total
(= `estimatedToday`).

`holdout_game_id` retire l'ancre du jeu lui-même du matcher : sans ça, le
modèle « verrait la réponse » (fuite de données / data leakage).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import constants as C
from .matcher import Matcher, _none, _time_us
from .profile import Profile, overlay

PLATFORM_CONFIGS = [
    # (plateforme, métrique, low global, high global, préfixe méthode)
    ("PC", "STEAM_REVIEWS", C.PC_BOXLEITER_DEFAULT_LOW, C.PC_BOXLEITER_DEFAULT_HIGH, "boxleiter"),
    ("PLAYSTATION", "PS_RATINGS", C.PS_BOXLEITER_DEFAULT_LOW, C.PS_BOXLEITER_DEFAULT_HIGH, "ps-ratings-boxleiter"),
    ("XBOX", "XBOX_RATINGS", C.XBOX_BOXLEITER_DEFAULT_LOW, C.XBOX_BOXLEITER_DEFAULT_HIGH, "xbox-ratings-boxleiter"),
]
AGGREGATED = "aggregated"
US_PER_DAY = 86_400 * 1_000_000


@dataclass
class MethodResult:
    platform: str
    low: int
    high: int
    method: str
    detail: dict = field(default_factory=dict)


@dataclass
class Estimate:
    game_id: str
    as_of_us: int
    methods: list[MethodResult]
    aggregates: dict[str, MethodResult]
    profile: Profile | None

    @property
    def total(self) -> tuple[int, int] | None:
        if not self.aggregates:
            return None
        return (sum(a.low for a in self.aggregates.values()), sum(a.high for a in self.aggregates.values()))

    def for_platform(self, platform: str) -> tuple[int, int] | None:
        if platform == "GLOBAL":
            return self.total
        agg = self.aggregates.get(platform)
        return (agg.low, agg.high) if agg else None


class SignalStore:
    """Séries temporelles par (jeu, métrique), triées par date, pour des
    requêtes « dernière valeur avant T » en O(log n)."""

    def __init__(self, signals: pd.DataFrame):
        df = signals.sort_values("capturedAt", kind="stable")
        epoch = pd.Timestamp("1970-01-01", tz="UTC")
        df = df.assign(_t=((df.capturedAt - epoch) // pd.Timedelta(microseconds=1)).astype("int64"))
        self.all: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]] = {}
        self.real: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]] = {}
        for (game_id, metric), g in df.groupby(["gameId", "metric"], observed=True, sort=False):
            self.all[(game_id, metric)] = (g._t.to_numpy(), g.value.to_numpy())
            r = g[~g.synthetic]
            if len(r):
                self.real[(game_id, metric)] = (r._t.to_numpy(), r.value.to_numpy())

    def latest(self, game_id: str, metric: str, as_of_us: int) -> tuple[int, int] | None:
        """Dernier point NON synthétique avec capturedAt <= as_of → (valeur, t)."""
        series = self.real.get((game_id, metric))
        if series is None:
            return None
        t, v = series
        i = np.searchsorted(t, as_of_us, side="right") - 1
        if i < 0:
            return None
        return int(v[i]), int(t[i])

    def max_between(self, game_id: str, metric: str, start_us: int, end_us: int) -> int | None:
        """Max sur [start, end] inclus (TypeORM `Between`), synthétiques compris
        comme en prod (la requête du pic CCU ne filtre pas `synthetic`)."""
        series = self.all.get((game_id, metric))
        if series is None:
            return None
        t, v = series
        lo = np.searchsorted(t, start_us, side="left")
        hi = np.searchsorted(t, end_us, side="right")
        if hi <= lo:
            return None
        return int(v[lo:hi].max())


def _month_start_us(time_us: int, add_months: int = 0) -> int:
    d = datetime.fromtimestamp(time_us / 1e6, tz=timezone.utc)
    y, m = divmod(d.month - 1 + add_months, 12)
    return int(datetime(d.year + y, m + 1, 1, tzinfo=timezone.utc).timestamp() * 1_000_000)


class Estimator:
    def __init__(self, snapshot):
        self.games = snapshot.games.set_index("id", drop=False)
        self.matcher = Matcher(snapshot.games, snapshot.reference_profiles, snapshot.track_record,
                               snapshot.game_rank, snapshot.signals)
        self.signals = SignalStore(snapshot.signals[snapshot.signals.metric.isin(
            ["STEAM_REVIEWS", "PS_RATINGS", "XBOX_RATINGS", "STEAM_CONCURRENT"])])
        self.methods = {r.code: r for r in snapshot.estimation_methods.itertuples(index=False)}
        self.pc_release: dict[str, int] = {}
        for r in snapshot.platform_release_dates.itertuples(index=False):
            if r.platform == "PC" and r.gameId not in self.pc_release:
                self.pc_release[r.gameId] = _time_us(r.releaseDate)
        self._profiles: dict[tuple[str, str | None], Profile | None] = {}
        self._matches: dict[tuple[str, str | None], object] = {}

    # ─── Profil (matcher) ─────────────────────────────────────────────────
    def profile(self, game_id: str, holdout_game_id: str | None) -> Profile | None:
        key = (game_id, holdout_game_id)
        if key not in self._profiles:
            self._profiles[key] = overlay(self.match(game_id, holdout_game_id))
        return self._profiles[key]

    def match(self, game_id: str, holdout_game_id: str | None):
        """Résultat brut du matcher (voisins, similarités, courbe), gardé en cache."""
        key = (game_id, holdout_game_id)
        if key not in self._matches:
            self._matches[key] = self.matcher.find_neighbours(game_id, holdout_game_id=holdout_game_id)
        return self._matches[key]

    # ─── Point d'entrée ───────────────────────────────────────────────────
    def estimate(self, game_id: str, as_of_us: int, holdout_game_id: str | None = None) -> Estimate | None:
        """`estimateAllPlatforms` + `aggregateResultsByPlatform`."""
        if game_id not in self.games.index:
            return None
        game = self.games.loc[game_id]
        if _none(game.deletedAt) is not None or bool(game.isFree):
            return None
        platforms = list(_none(game.platforms) if _none(game.platforms) is not None else [])
        profile = self.profile(game_id, holdout_game_id)

        results: list[MethodResult] = []
        for platform, metric, d_low, d_high, prefix in PLATFORM_CONFIGS:
            if platform not in platforms:
                continue
            r = self._boxleiter(game_id, platform, metric, d_low, d_high, prefix, as_of_us, profile)
            if r:
                results.append(r)
        fw = self._first_week(game, as_of_us, profile)
        if fw:
            results.append(fw)

        aggregates, splits = self._aggregate_by_platform(platforms, results, profile)
        return Estimate(game_id, as_of_us, results + splits, aggregates, profile)

    # ─── Méthodes ─────────────────────────────────────────────────────────
    def _boxleiter(self, game_id, platform, metric, d_low, d_high, prefix, as_of_us, profile):
        latest = self.signals.latest(game_id, metric, as_of_us)
        if latest is None or latest[0] <= 0:
            return None
        value, captured = latest
        low, high, source = d_low, d_high, "global"
        if profile is not None:
            if platform == "PC" and profile.pc_boxleiter_low is not None and profile.pc_boxleiter_high is not None:
                low, high, source = profile.pc_boxleiter_low, profile.pc_boxleiter_high, "matcher"
            elif platform == "PLAYSTATION" and profile.ps_boxleiter_low is not None and profile.ps_boxleiter_high is not None:
                low, high, source = profile.ps_boxleiter_low, profile.ps_boxleiter_high, "matcher"
        return MethodResult(platform, C.js_round(value * low), C.js_round(value * high), f"{prefix}-default", {
            "signal": value, "signalAgeDays": (as_of_us - captured) / US_PER_DAY,
            "multiplierLow": low, "multiplierHigh": high, "multiplierSource": source,
        })

    def _first_week(self, game, as_of_us, profile):
        release = self.pc_release.get(game.id, _time_us(game.releaseDate))
        if release is None:
            return None
        age = (as_of_us - release) / US_PER_DAY
        if age <= 0:
            return None
        month_start = _month_start_us(release)
        window_end = min(as_of_us, _month_start_us(release, C.LAUNCH_PEAK_CCU_WINDOW_MONTHS))
        if window_end <= month_start:
            return None
        peak = self.signals.max_between(game.id, "STEAM_CONCURRENT", month_start, window_end)
        if peak is None or peak <= 0:
            return None

        ratio_low = profile.peak_ccu_to_week_one_low if profile else C.FIRST_WEEK_PEAK_CCU_LOW
        ratio_high = profile.peak_ccu_to_week_one_high if profile else C.FIRST_WEEK_PEAK_CCU_HIGH
        week_low, week_high = peak * ratio_low, peak * ratio_high
        if profile:
            projection = C.genre_projection_multiplier(profile.m1, profile.tail_y2, profile.tail_y5, age)
        else:
            projection = C.first_week_projection_multiplier((week_low + week_high) / 2, age)
        low, high = C.js_round(week_low * projection), C.js_round(week_high * projection)
        if high < C.FIRST_WEEK_ESTIMATE_MIN_UNITS or low > C.FIRST_WEEK_ESTIMATE_MAX_UNITS or low > high:
            return None
        return MethodResult("PC", low, high, "first-week-extrapolation-pc", {
            "launchPeakCcu": peak, "ageDays": age, "projection": projection,
        })

    # ─── Splits console + agrégation ──────────────────────────────────────
    def _split(self, platforms, source_agg: MethodResult, source, target, code, profile):
        if target not in platforms or profile is None:
            return None
        s_share, t_share = profile.share(source), profile.share(target)
        if s_share <= 0 or t_share <= 0:
            return None
        ratio = t_share / s_share
        low, high = C.js_round(source_agg.low * ratio), C.js_round(source_agg.high * ratio)
        if high <= 0 or low > high:
            return None
        return MethodResult(target, low, high, code, {"ratio": ratio})

    def _aggregate_methods(self, results: list[MethodResult]) -> MethodResult | None:
        eligible = []
        for r in results:
            m = self.methods.get(re.sub(r"\+[^+]+", "", r.method))
            if m is not None and m.isEnabled and not m.isAggregate and float(m.defaultWeight) > 0:
                eligible.append((r, float(m.defaultWeight)))
        if not eligible:
            return None
        total_w = sum(w for _, w in eligible)
        if total_w <= 0:
            return None
        w_low = sum(r.low * w for r, w in eligible) / total_w
        w_high = sum(r.high * w for r, w in eligible) / total_w
        mids = [(r.low + r.high) / 2 for r, _ in eligible]
        w_mid = (w_low + w_high) / 2
        disagreement = (max(mids) - min(mids)) / w_mid if w_mid > 0 else 0.0
        inflate = C.AGGREGATION_DISAGREEMENT_ALPHA * disagreement
        return MethodResult(eligible[0][0].platform, C.js_round(max(0.0, w_low * (1 - inflate))),
                            C.js_round(w_high * (1 + inflate)), AGGREGATED,
                            {"disagreement": disagreement, "inputs": [r.method for r, _ in eligible]})

    def _aggregate_by_platform(self, platforms, results, profile):
        by_platform: dict[str, list[MethodResult]] = {}
        for r in results:
            by_platform.setdefault(r.platform, []).append(r)
        aggregates: dict[str, MethodResult] = {}
        splits: list[MethodResult] = []

        def add_split(s):
            if s:
                splits.append(s)
                by_platform.setdefault(s.platform, []).append(s)

        pc = self._aggregate_methods(by_platform["PC"]) if by_platform.get("PC") else None
        if pc:
            aggregates["PC"] = pc
            add_split(self._split(platforms, pc, "PC", "PLAYSTATION", "genre-console-split-from-pc-playstation", profile))
        ps = self._aggregate_methods(by_platform["PLAYSTATION"]) if by_platform.get("PLAYSTATION") else None
        if ps:
            aggregates["PLAYSTATION"] = ps
        xbox_split = None
        if ps:
            xbox_split = self._split(platforms, ps, "PLAYSTATION", "XBOX", "genre-console-split-from-ps-xbox", profile)
        if not xbox_split and pc:
            xbox_split = self._split(platforms, pc, "PC", "XBOX", "genre-console-split-from-pc-xbox", profile)
        add_split(xbox_split)
        for platform, rows in by_platform.items():
            if platform in ("PC", "PLAYSTATION"):
                continue
            agg = self._aggregate_methods(rows)
            if agg:
                aggregates[platform] = agg
        return aggregates, splits

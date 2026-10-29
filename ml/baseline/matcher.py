"""Portage de `backend/src/reference-profiles/matcher.service.ts`.

Le matcher est un k plus proches voisins (kNN) « fait main » : pour un jeu
cible, il note la similarité avec chaque ancre de `reference_profile`
(somme pondérée de 13 critères), garde les k = 15 plus proches et fait une
moyenne pondérée de leurs ratios observés (reviews→ventes, courbe de vie,
parts de plateforme…).

Toutes les règles (seuils, valeurs neutres, ordre des critères) reprennent
le TypeScript à l'identique. Les commentaires renvoient au nom de la
fonction TS correspondante.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DEFAULT_NEIGHBOURS = 15
MIN_NEIGHBOURS = 3
SIMILARITY_WEIGHT_EXPONENT = 2
REVIEWS_TO_UNITS_OUTLIER_FACTOR = 2

# Même ordre qu'en TS : l'ordre de sommation influe (à la marge) sur les
# arrondis flottants, donc sur le départage des ex aequo.
SIMILARITY_WEIGHTS = {
    "gameplayType": 0.351,
    "rank": 0.1116,
    "publisherMatch": 0.081,
    "developerMatch": 0.081,
    "releaseEra": 0.0405,
    "scaleBucket": 0.0324,
    "platformsOverlap": 0.0486,
    "dlcTier": 0.0486,
    "franchise": 0.0324,
    "liveService": 0.0243,
    "devTrackRecord": 0.0243,
    "annualIteration": 0.0243,
    "playtime": 0.1,
}

RANK_PEAK_LOG_SCALE = 2.0
RANK_SUSTAIN_LOG_SCALE = 1.5
PLAYTIME_LOG_SCALE = 1.5
GENRE_STOPLIST = {"indie"}
GAMEPLAY_TAG_TOP_N = 6
TRACK_RECORD_HIT_UNITS = 5_000_000
TRACK_RECORD_MID_UNITS = 1_000_000

PLATFORMS = {"PC", "PLAYSTATION", "XBOX", "SWITCH", "MOBILE", "GLOBAL", "OTHER"}
ERA_ORDER = ["PRE_2013", "2013_2014", "2015_2016", "2017_2018", "2019_2020", "2021_2022", "2023_PLUS"]
DLC_ORDER = ["NONE", "FEW", "SOME", "MANY"]
TRACK_ORDER = ["NONE", "MID", "HIT"]
CURVE_KEYS = ["s1", "m1", "m3", "m6", "a1", "a2"]


# ─── Nettoyage des valeurs pandas → Python ───────────────────────────────────

def _none(v):
    """NaN / NaT / pd.NA → None, sinon la valeur telle quelle."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _time_us(v) -> int | None:
    """Horodatage → microsecondes depuis 1970 (UTC), ou None."""
    v = _none(v)
    if v is None:
        return None
    ts = pd.Timestamp(v)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return int(ts.tz_convert("UTC").value // 1000)


def _utc_year(time_us: int | None) -> int | None:
    if time_us is None:
        return None
    return datetime.fromtimestamp(time_us / 1e6, tz=timezone.utc).year


# ─── Extraction de features (fonctions homonymes du TS) ──────────────────────

def parse_text_array(raw, trim: bool) -> list[str]:
    """`simple-array` TypeORM = texte séparé par des virgules.

    Côté corpus (SQL brut) le TS fait `parseTextArray` (avec trim) ; côté
    cible l'entité TypeORM fait un `split(',')` sans trim. On garde la nuance.
    """
    raw = _none(raw)
    if raw is None:
        return []
    if isinstance(raw, (list, tuple, np.ndarray)):
        return [str(x) for x in raw]
    if raw == "":
        return []
    parts = raw.split(",")
    if trim:
        return [p.strip() for p in parts if p.strip()]
    return parts


def normalise_genres(raw: list[str]) -> list[str]:
    out: dict[str, None] = {}
    for g in raw:
        key = g.strip().lower()
        if not key or key in GENRE_STOPLIST:
            continue
        out[key] = None
    return list(out)


def play_mode_from_categories(cats: list[str]) -> str:
    if not cats:
        return "UNKNOWN"
    s = {c.lower() for c in cats}
    has_solo = "single-player" in s
    has_coop = bool(s & {"co-op", "online co-op", "shared/split screen co-op"})
    has_multi = bool(s & {"multi-player", "online pvp", "pvp", "cross-platform multiplayer"})
    has_mmo = bool(s & {"mmo", "massively multiplayer"})
    if has_mmo:
        return "MMO"
    if has_solo and (has_coop or has_multi):
        return "MIXED"
    if has_coop and not has_multi:
        return "COOP"
    if has_multi:
        return "MULTI"
    if has_solo:
        return "SOLO"
    return "UNKNOWN"


def release_era(year: int | None) -> str:
    if year is None:
        return "UNKNOWN"
    if year < 2013:
        return "PRE_2013"
    if year < 2015:
        return "2013_2014"
    if year < 2017:
        return "2015_2016"
    if year < 2019:
        return "2017_2018"
    if year < 2021:
        return "2019_2020"
    if year < 2023:
        return "2021_2022"
    return "2023_PLUS"


def scale_bucket(units: float | None) -> str:
    if units is None:
        return "UNKNOWN"
    if units >= 10_000_000:
        return "HUGE"
    if units >= 3_000_000:
        return "LARGE"
    if units >= 1_000_000:
        return "MEDIUM"
    return "SMALL"


def dlc_tier(count: float | None) -> str:
    if count is None or not math.isfinite(count):
        return "UNKNOWN"
    if count <= 0:
        return "NONE"
    if count <= 4:
        return "FEW"
    if count <= 14:
        return "SOME"
    return "MANY"


# ─── Similarités élémentaires (chacune dans [0, 1]) ──────────────────────────

def set_jaccard(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.5
    sa, sb = set(a), set(b)
    union = len(sa | sb)
    return len(sa & sb) / union if union > 0 else 0.5


def gameplay_type_similarity(row_tags, row_genres, target_tags, target_genres) -> float:
    if row_tags and target_tags:
        return set_jaccard(row_tags[:GAMEPLAY_TAG_TOP_N], target_tags[:GAMEPLAY_TAG_TOP_N])
    if row_genres and target_genres:
        return set_jaccard(row_genres, target_genres)
    return 0.5


def platform_jaccard(a: frozenset, b: frozenset) -> float:
    if not a and not b:
        return 1.0
    union = len(a | b)
    return len(a & b) / union if union > 0 else 0.0


def match_or_zero(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if a == "UNKNOWN" or b == "UNKNOWN":
        return 0.4
    return 0.0


def era_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if a == "UNKNOWN" or b == "UNKNOWN":
        return 0.5
    d = abs(ERA_ORDER.index(a) - ERA_ORDER.index(b))
    return 0.7 if d == 1 else 0.4 if d == 2 else 0.15


def dlc_tier_similarity(a: str, b: str) -> float:
    if a == "UNKNOWN" or b == "UNKNOWN":
        return 0.5
    if a == b:
        return 1.0
    d = abs(DLC_ORDER.index(a) - DLC_ORDER.index(b))
    return 0.6 if d == 1 else 0.3 if d == 2 else 0.1


def identity_match(a: str | None, b: str | None) -> float:
    if a is not None and b is not None:
        return 1.0 if a == b else 0.0
    return 0.5


def _norm_name(v: str | None) -> str | None:
    if v is None:
        return None
    return v.strip().lower() or None


def publisher_match(a_id, a_name, b_id, b_name) -> float:
    if a_id is not None and b_id is not None:
        return 1.0 if a_id == b_id else 0.0
    return identity_match(_norm_name(a_name), _norm_name(b_name))


def track_record_similarity(a: str, b: str) -> float:
    if a == "UNKNOWN" or b == "UNKNOWN":
        return 0.5
    if a == b:
        return 1.0
    d = abs(TRACK_ORDER.index(a) - TRACK_ORDER.index(b))
    return 0.5 if d == 1 else 0.1


def exp_closeness(x: float, y: float, scale: float) -> float:
    return math.exp(-abs(x - y) / scale)


def homegrown_rank_similarity(a, b) -> float:
    if a is None or b is None:
        return 0.5
    peak = exp_closeness(
        math.log(max(a[0], 1e-4)), math.log(max(b[0], 1e-4)), RANK_PEAK_LOG_SCALE
    )
    sustain = exp_closeness(math.log1p(a[1]), math.log1p(b[1]), RANK_SUSTAIN_LOG_SCALE)
    return (peak + sustain) / 2


def playtime_similarity(a: float | None, b: float | None) -> float:
    if a is None or b is None:
        return 0.5
    return exp_closeness(math.log(max(a, 1)), math.log(max(b, 1)), PLAYTIME_LOG_SCALE)


def neighbour_weight(similarity: float, quality: float) -> float:
    return similarity**SIMILARITY_WEIGHT_EXPONENT * quality


def weighted_mean(entries: list[tuple[float, float]]) -> float | None:
    cleaned = [(v, w) for v, w in entries if math.isfinite(v) and math.isfinite(w) and w > 0]
    if not cleaned:
        return None
    den = sum(w for _, w in cleaned)
    return sum(v * w for v, w in cleaned) / den if den > 0 else None


def reject_high_outliers(entries: list[tuple[float, float]], factor: float):
    if len(entries) < 4:
        return entries
    values = sorted(v for v, _ in entries)
    mid = len(values) // 2
    median = (values[mid - 1] + values[mid]) / 2 if len(values) % 2 == 0 else values[mid]
    if not math.isfinite(median) or median <= 0:
        return entries
    kept = [e for e in entries if e[0] <= factor * median]
    return kept if len(kept) >= 3 else entries


# ─── Index annexes (track record, rang, temps de jeu) ────────────────────────

class TrackRecordIndex:
    """`TrackRecordIndex` : le studio a-t-il déjà sorti un hit avant ce jeu ?"""

    def __init__(self, track_record: pd.DataFrame):
        self.by_dev: dict[str, list[tuple[str, int | None, float]]] = {}
        for r in track_record.itertuples(index=False):
            dev = _none(r.developer)
            if not dev:
                continue
            units = _none(r.maxUnits)
            self.by_dev.setdefault(dev.lower(), []).append(
                (r.gameId, _time_us(r.releaseDate), float(units) if units is not None else 0.0)
            )

    def tier_for(self, developer: str | None, release_us: int | None, self_id: str | None) -> str:
        if not developer:
            return "UNKNOWN"
        entries = self.by_dev.get(developer.lower())
        if not entries:
            return "NONE"
        best = 0.0
        for game_id, rel, units in entries:
            if game_id == self_id:
                continue
            if release_us is not None and rel is not None and rel >= release_us:
                continue
            best = max(best, units)
        if best >= TRACK_RECORD_HIT_UNITS:
            return "HIT"
        if best >= TRACK_RECORD_MID_UNITS:
            return "MID"
        return "NONE"


def build_rank_index(game_rank: pd.DataFrame) -> dict[str, tuple[float, float]]:
    index = {}
    for r in game_rank.itertuples(index=False):
        peak = _none(r.peakPercentile)
        if peak is None or not math.isfinite(float(peak)):
            continue
        weeks = _none(r.weeksTopDecile)
        weeks = float(weeks) if weeks is not None and math.isfinite(float(weeks)) else 0.0
        index[r.gameId] = (float(peak), weeks)
    return index


def build_playtime_index(signals: pd.DataFrame) -> dict[str, float]:
    """Dernière médiane de temps de jeu (minutes) non synthétique par jeu."""
    pt = signals[(signals.metric == "STEAM_REVIEWER_MEDIAN_PLAYTIME") & ~signals.synthetic]
    latest = pt.sort_values("capturedAt").groupby("gameId", observed=True).tail(1)
    return {g: float(v) for g, v in zip(latest.gameId, latest.value) if v > 0}


# ─── Représentation interne ──────────────────────────────────────────────────

@dataclass
class Features:
    platforms: frozenset
    genres: list[str]
    steam_tags: list[str]
    play_mode: str
    publisher_id: str | None
    publisher: str | None
    developer: str | None
    release_era: str
    scale_bucket: str
    dlc_tier: str
    franchise_slug: str | None
    is_annual_iteration: bool
    live_service: bool
    track_record: str = "UNKNOWN"
    rank: tuple[float, float] | None = None
    playtime: float | None = None


@dataclass
class Anchor:
    game_id: str
    features: Features
    quality_score: float
    curve: dict[str, float | None]
    reviews_to_units: float | None
    global_reviews_to_units: float | None
    peak_ccu_ratio: float | None
    platform_shares: dict[str, float] | None


@dataclass
class MatchResult:
    curve: dict[str, float | None]
    reviews_to_units: float | None
    global_reviews_to_units: float | None
    peak_ccu_ratio: float | None
    platform_shares: dict[str, float] | None
    neighbours_used: int
    cold_start: bool
    anchors: list[tuple[str, float, float]] = field(default_factory=list)  # (gameId, sim, weight)


def similarity(row: Features, target: Features) -> float:
    scores = {
        "gameplayType": gameplay_type_similarity(row.steam_tags, row.genres, target.steam_tags, target.genres),
        "rank": homegrown_rank_similarity(row.rank, target.rank),
        "publisherMatch": publisher_match(row.publisher_id, row.publisher, target.publisher_id, target.publisher),
        "developerMatch": identity_match(_norm_name(row.developer), _norm_name(target.developer)),
        "releaseEra": era_similarity(row.release_era, target.release_era),
        "scaleBucket": 1.0 if target.scale_bucket == "UNKNOWN" else match_or_zero(row.scale_bucket, target.scale_bucket),
        "platformsOverlap": platform_jaccard(row.platforms, target.platforms),
        "dlcTier": dlc_tier_similarity(row.dlc_tier, target.dlc_tier),
        "franchise": identity_match(row.franchise_slug, target.franchise_slug),
        "liveService": 1.0 if row.live_service == target.live_service else 0.0,
        "devTrackRecord": track_record_similarity(row.track_record, target.track_record),
        "annualIteration": 1.0 if row.is_annual_iteration == target.is_annual_iteration else 0.0,
        "playtime": playtime_similarity(row.playtime, target.playtime),
    }
    total = 0.0
    for key, weight in SIMILARITY_WEIGHTS.items():
        total += weight * scores[key]
    return total


class Matcher:
    """Charge le corpus d'ancres une fois, puis répond à `find_neighbours`."""

    def __init__(self, games: pd.DataFrame, reference_profiles: pd.DataFrame,
                 track_record: pd.DataFrame, game_rank: pd.DataFrame, signals: pd.DataFrame):
        self.track_index = TrackRecordIndex(track_record)
        self.rank_index = build_rank_index(game_rank)
        self.playtime_index = build_playtime_index(signals)
        self.games = games.set_index("id", drop=False)

        live = games[games.deletedAt.isna() & ~games.excludedFromReference].set_index("id", drop=False)
        self.corpus: list[Anchor] = []
        for r in reference_profiles.itertuples(index=False):
            if r.gameId not in live.index:
                continue  # INNER JOIN game ... deletedAt IS NULL AND excludedFromReference = false
            g = live.loc[r.gameId]
            release_us = _time_us(g.releaseDate)
            scale_units = _none(r.scaleUnits)
            dlc_count = _none(g.dlcCount)
            feats = Features(
                platforms=frozenset(p for p in (_none(g.platforms) if _none(g.platforms) is not None else []) if p in PLATFORMS),
                genres=normalise_genres(parse_text_array(g.genres, trim=True)),
                steam_tags=normalise_genres(parse_text_array(g.steamTags, trim=True)),
                play_mode=play_mode_from_categories(parse_text_array(g.categories, trim=True)),
                publisher_id=_none(g.publisherId),
                publisher=_none(g.publisher),
                developer=_none(g.developer),
                release_era=release_era(_utc_year(release_us)),
                scale_bucket=scale_bucket(float(scale_units) if scale_units is not None else None),
                # COALESCE(array_length(dlc, 1), 0) : côté corpus, null → 0 → NONE.
                dlc_tier=dlc_tier(float(dlc_count) if dlc_count is not None else 0.0),
                franchise_slug=_none(g.franchiseSlug),
                is_annual_iteration=bool(g.isAnnualIteration),
                live_service=bool(g.liveService),
                track_record=self.track_index.tier_for(_none(g.developer), release_us, r.gameId),
                rank=self.rank_index.get(r.gameId),
                playtime=self.playtime_index.get(r.gameId),
            )
            shares = None
            if all(_none(v) is not None for v in (r.platformSharePc, r.platformSharePs, r.platformShareXbox, r.platformShareSwitch)):
                shares = {"pc": float(r.platformSharePc), "ps": float(r.platformSharePs),
                          "xbox": float(r.platformShareXbox), "switch": float(r.platformShareSwitch)}
            self.corpus.append(Anchor(
                game_id=r.gameId,
                features=feats,
                quality_score=float(r.qualityScore),
                curve={k: _float_or_none(getattr(r, "curve" + k.upper())) for k in CURVE_KEYS},
                reviews_to_units=_float_or_none(r.reviewsToUnits),
                global_reviews_to_units=_float_or_none(r.globalReviewsToUnits),
                peak_ccu_ratio=_float_or_none(r.peakCcuRatio),
                platform_shares=shares,
            ))

    def target_features(self, game_id: str) -> Features:
        """`featurise` + enrichissements faits dans `findNeighbours`."""
        g = self.games.loc[game_id]
        release_us = _time_us(g.releaseDate)
        dlc_count = _none(g.dlcCount)
        platforms = _none(g.platforms)
        return Features(
            platforms=frozenset(p for p in (platforms if platforms is not None else []) if p in PLATFORMS),
            genres=normalise_genres(parse_text_array(g.genres, trim=False)),
            steam_tags=normalise_genres(parse_text_array(g.steamTags, trim=False)),
            play_mode=play_mode_from_categories(parse_text_array(g.categories, trim=False)),
            publisher_id=_none(g.publisherId),
            publisher=_none(g.publisher),
            developer=_none(g.developer),
            release_era=release_era(_utc_year(release_us)),
            scale_bucket="UNKNOWN",  # le resolver ne passe jamais de scaleHint
            # Côté cible : dlc null → UNKNOWN (différent du corpus, fidèle au TS).
            dlc_tier=dlc_tier(float(dlc_count) if dlc_count is not None else None),
            franchise_slug=_none(g.franchiseSlug),
            is_annual_iteration=bool(g.isAnnualIteration),
            live_service=bool(g.liveService),
            track_record=self.track_index.tier_for(_none(g.developer), release_us, None),
            rank=self.rank_index.get(game_id),
            playtime=self.playtime_index.get(game_id),
        )

    def find_neighbours(self, game_id: str, holdout_game_id: str | None = None,
                        k: int = DEFAULT_NEIGHBOURS) -> MatchResult:
        corpus = [a for a in self.corpus if a.game_id != holdout_game_id] if holdout_game_id else self.corpus
        target = self.target_features(game_id)

        same_mode = [a for a in corpus if a.features.play_mode == target.play_mode]
        primary = [a for a in same_mode if target.platforms & a.features.platforms]
        if len(primary) >= MIN_NEIGHBOURS:
            return self._aggregate(primary, target, k, cold_start=False)
        if len(same_mode) >= MIN_NEIGHBOURS:
            return self._aggregate(same_mode, target, k, cold_start=True)
        return self._aggregate(corpus, target, k, cold_start=True)

    def _aggregate(self, candidates: list[Anchor], target: Features, k: int, cold_start: bool) -> MatchResult:
        scored = [(a, similarity(a.features, target)) for a in candidates]
        scored.sort(key=lambda t: -t[1])  # tri stable, comme Array.sort en V8
        top = scored[:k]
        weighted = [(a, neighbour_weight(s, a.quality_score)) for a, s in top]

        curve = {}
        for key in CURVE_KEYS:
            curve[key] = weighted_mean([(a.curve[key], w) for a, w in weighted if a.curve[key] is not None])

        def log_mean(values: list[tuple[float, float]], reject: bool) -> float | None:
            kept = reject_high_outliers(values, REVIEWS_TO_UNITS_OUTLIER_FACTOR) if reject else values
            mean_log = weighted_mean([(math.log10(v), w) for v, w in kept])
            return None if mean_log is None else 10**mean_log

        rtu = log_mean([(a.reviews_to_units, w) for a, w in weighted
                        if a.reviews_to_units is not None and a.reviews_to_units > 0], reject=True)
        grtu = log_mean([(a.global_reviews_to_units, w) for a, w in weighted
                         if a.global_reviews_to_units is not None and a.global_reviews_to_units > 0], reject=True)
        pcr = log_mean([(a.peak_ccu_ratio, w) for a, w in weighted
                        if a.peak_ccu_ratio is not None and a.peak_ccu_ratio > 0], reject=False)

        shares = None
        with_shares = [(a, w) for a, w in weighted if a.platform_shares is not None]
        if with_shares:
            totals = {"pc": 0.0, "ps": 0.0, "xbox": 0.0, "switch": 0.0}
            weight_sum = 0.0
            for a, w in with_shares:
                for key in totals:
                    totals[key] += a.platform_shares[key] * w
                weight_sum += w
            if weight_sum != 0:
                raw = {key: v / weight_sum for key, v in totals.items()}
                s = sum(raw.values())
                if s > 0:
                    shares = {key: v / s for key, v in raw.items()}

        return MatchResult(
            curve=curve,
            reviews_to_units=rtu,
            global_reviews_to_units=grtu,
            peak_ccu_ratio=pcr,
            platform_shares=shares,
            neighbours_used=len(top),
            cold_start=cold_start,
            anchors=[(a.game_id, s, neighbour_weight(s, a.quality_score)) for a, s in top],
        )


def _float_or_none(v) -> float | None:
    v = _none(v)
    if v is None:
        return None
    f = float(v)
    return f if math.isfinite(f) else None

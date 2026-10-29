"""Portage de `backend/src/games/sales-modeling.constants.ts` (partie utilisée
par l'estimation) et des constantes locales d'`estimation.service.ts`.

Garder ces valeurs identiques au TypeScript : le backtest mesure le modèle
EN PROD, pas une variante.
"""

from __future__ import annotations

import math

DAY_SECONDS = 24 * 3600

# ─── Boxleiter (signal × multiplicateur) ─────────────────────────────────────
PC_BOXLEITER_DEFAULT_LOW = 25
PC_BOXLEITER_DEFAULT_HIGH = 65
PS_BOXLEITER_DEFAULT_LOW = 40
PS_BOXLEITER_DEFAULT_HIGH = 100
XBOX_BOXLEITER_DEFAULT_LOW = 35
XBOX_BOXLEITER_DEFAULT_HIGH = 90

# ─── Première semaine (PC) ───────────────────────────────────────────────────
FIRST_WEEK_PEAK_CCU_LOW = 3
FIRST_WEEK_PEAK_CCU_HIGH = 7
LAUNCH_PEAK_CCU_WINDOW_MONTHS = 2
FIRST_WEEK_BUCKET_THRESHOLD = 100_000
FIRST_WEEK_ESTIMATE_MIN_UNITS = 5_000
FIRST_WEEK_ESTIMATE_MAX_UNITS = 200_000_000

FIRST_WEEK_PROJECTION_CURVE_LARGE = [
    (7, 1.0), (30, 1.7), (90, 2.1), (180, 2.45), (365, 2.68),
    (730, 3.0), (1825, 3.4), (2555, 3.6), (3650, 3.8), (5475, 4.0),
]
FIRST_WEEK_PROJECTION_CURVE_SMALL = [
    (7, 1.0), (30, 2.2), (90, 2.85), (180, 3.3), (365, 3.77),
    (730, 4.5), (1825, 5.5), (2555, 5.9), (3650, 6.3), (5475, 6.7),
]
GENRE_INTRA_YEAR_SHAPE = [(30, 0.425), (90, 0.661), (180, 0.847)]

# ─── Agrégation (estimation.service.ts) ──────────────────────────────────────
AGGREGATION_DISAGREEMENT_ALPHA = 0.5


def js_round(x: float) -> int:
    """`Math.round` de JavaScript (0,5 arrondi vers +∞).

    Le `round` de Python arrondit au pair le plus proche (« banker's
    rounding ») : 2,5 → 2. On veut 3, comme en prod.
    """
    return math.floor(x + 0.5)


def interpolate_curve(curve: list[tuple[float, float]], x: float) -> float:
    if not curve:
        return 0.0
    if x <= curve[0][0]:
        return curve[0][1]
    if x >= curve[-1][0]:
        return curve[-1][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return curve[-1][1]


def first_week_projection_multiplier(week_one_mid: float, age_days: float) -> float:
    if age_days <= 0:
        return 0.0
    if age_days < 7:
        return age_days / 7
    curve = (
        FIRST_WEEK_PROJECTION_CURVE_LARGE
        if week_one_mid > FIRST_WEEK_BUCKET_THRESHOLD
        else FIRST_WEEK_PROJECTION_CURVE_SMALL
    )
    return interpolate_curve(curve, age_days)


def build_genre_projection_curve(m1: float, tail_y2: float, tail_y5: float):
    delta = m1 - 1
    tail_y10 = tail_y5 ** (1.85 / 1.5)
    return [
        (7, 1.0),
        *[(day, 1 + frac * delta) for day, frac in GENRE_INTRA_YEAR_SHAPE],
        (365, m1),
        (730, m1 * tail_y2),
        (1825, m1 * tail_y5),
        (3650, m1 * tail_y10),
    ]


def genre_projection_multiplier(
    m1: float, tail_y2: float, tail_y5: float, age_days: float
) -> float:
    if age_days <= 0:
        return 0.0
    if age_days < 7:
        return age_days / 7
    return interpolate_curve(build_genre_projection_curve(m1, tail_y2, tail_y5), age_days)

"""Portage de `sales-profile-resolver.service.ts` (fonction `overlay`).

Transforme le résultat brut du matcher en « profil » utilisable par
l'estimateur : bandes Boxleiter PC/PS, ratio pic CCU → semaine 1, courbe de
vie (m1, tailY2, tailY5) et parts de plateforme.
"""

from __future__ import annotations

from dataclasses import dataclass

from .constants import (
    PC_BOXLEITER_DEFAULT_HIGH,
    PC_BOXLEITER_DEFAULT_LOW,
    PS_BOXLEITER_DEFAULT_HIGH,
    PS_BOXLEITER_DEFAULT_LOW,
)
from .matcher import MatchResult

BOXLEITER_SPREAD_FRACTION = 0.25
PEAK_CCU_SPREAD_FRACTION = 0.3
PS_TO_PC_BOXLEITER_RATIO = (PS_BOXLEITER_DEFAULT_LOW + PS_BOXLEITER_DEFAULT_HIGH) / (
    PC_BOXLEITER_DEFAULT_LOW + PC_BOXLEITER_DEFAULT_HIGH
)


@dataclass
class Profile:
    pc_share: float
    playstation_share: float
    xbox_share: float
    switch_share: float
    m1: float  # firstWeekToYearOneMultiplier
    tail_y2: float
    tail_y5: float
    peak_ccu_to_week_one_low: float
    peak_ccu_to_week_one_high: float
    pc_boxleiter_low: float | None
    pc_boxleiter_high: float | None
    ps_boxleiter_low: float | None
    ps_boxleiter_high: float | None
    neighbours_used: int
    cold_start: bool

    def share(self, platform: str) -> float:
        return {"PC": self.pc_share, "PLAYSTATION": self.playstation_share, "XBOX": self.xbox_share}.get(platform, 0.0)


def blend_pc_boxleiter(match: MatchResult) -> float | None:
    direct = match.reviews_to_units if match.reviews_to_units is not None and match.reviews_to_units > 0 else None
    pc_share = match.platform_shares["pc"] if match.platform_shares else None
    via_global = (
        match.global_reviews_to_units * pc_share
        if match.global_reviews_to_units is not None and match.global_reviews_to_units > 0
        and pc_share is not None and pc_share > 0
        else None
    )
    if direct is not None and via_global is not None:
        return (direct * via_global) ** 0.5
    return direct if direct is not None else via_global


def overlay(match: MatchResult) -> Profile | None:
    if match.neighbours_used == 0:
        return None
    shares = match.platform_shares
    s1 = match.curve["s1"]
    a2 = match.curve["a2"]
    m1 = 1 / s1 if s1 is not None and s1 > 0 else 2.5
    tail_y2 = a2 if a2 is not None else 1.25
    tail_y5 = a2**1.5 if a2 is not None else 1.5

    pc = blend_pc_boxleiter(match)
    if pc is not None:
        pc_low, pc_high = pc * (1 - BOXLEITER_SPREAD_FRACTION), pc * (1 + BOXLEITER_SPREAD_FRACTION)
        ps_low = pc * PS_TO_PC_BOXLEITER_RATIO * (1 - BOXLEITER_SPREAD_FRACTION)
        ps_high = pc * PS_TO_PC_BOXLEITER_RATIO * (1 + BOXLEITER_SPREAD_FRACTION)
    else:
        pc_low = pc_high = ps_low = ps_high = None

    pcr = match.peak_ccu_ratio
    if pcr is not None and pcr > 0:
        ccu_low, ccu_high = pcr * (1 - PEAK_CCU_SPREAD_FRACTION), pcr * (1 + PEAK_CCU_SPREAD_FRACTION)
    else:
        ccu_low, ccu_high = 3.0, 7.0

    return Profile(
        pc_share=shares["pc"] if shares else 0.5,
        playstation_share=shares["ps"] if shares else 0.25,
        xbox_share=shares["xbox"] if shares else 0.15,
        switch_share=shares["switch"] if shares else 0.1,
        m1=m1,
        tail_y2=tail_y2,
        tail_y5=tail_y5,
        peak_ccu_to_week_one_low=ccu_low,
        peak_ccu_to_week_one_high=ccu_high,
        pc_boxleiter_low=pc_low,
        pc_boxleiter_high=pc_high,
        ps_boxleiter_low=ps_low,
        ps_boxleiter_high=ps_high,
        neighbours_used=match.neighbours_used,
        cold_start=match.cold_start,
    )

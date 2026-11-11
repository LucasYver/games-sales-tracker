"""Shared loading and formatting for the lab pages."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import streamlit as st

from dataset import DATA_DIR

BLUE = "#2a78d6"
TARGET_LABELS = {"TOTAL": "Total", "PC": "PC", "PLAYSTATION": "PlayStation", "XBOX": "Xbox",
                 "PC_PLAYERS": "Petits jeux (joueurs PC de la fuite)"}


def snapshots() -> list[str]:
    if not DATA_DIR.exists():
        return []
    return sorted((p.name for p in DATA_DIR.iterdir() if (p / "figures.parquet").exists()), reverse=True)


def load(snapshot: str) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Tables of a snapshot, reread when `dataset.py` rebuilds them."""
    return _load(snapshot, (DATA_DIR / snapshot / "figures.parquet").stat().st_mtime)


@st.cache_data(show_spinner=False)
def _load(snapshot: str, built_at: float) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    path = DATA_DIR / snapshot
    return (pd.read_parquet(path / "figures.parquet"), pd.read_parquet(path / "catalog.parquet"),
            json.loads((path / "manifest.json").read_text()))


@st.cache_data(show_spinner=False)
def game_signals(snapshot: str, game_id: str) -> pd.DataFrame:
    return pd.read_parquet(Path(DATA_DIR / snapshot / "raw" / "signals.parquet"), filters=[("gameId", "==", game_id)])


def n(value: float) -> str:
    """12 345 with a thin French thousands space."""
    return f"{value:,.0f}".replace(",", " ")


def units(value: float) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}".rstrip("0").rstrip(".").replace(".", ",") + " M"
    if value >= 1_000:
        return f"{value / 1_000:.0f} k"
    return f"{value:.0f}"

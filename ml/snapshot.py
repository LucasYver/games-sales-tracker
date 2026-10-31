"""Chargement d'un snapshot exporté par `export_snapshot.py`."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"


# Le site n'estime que les jeux sortis depuis 2017 (backend `games/estimate-scope.ts`).
# Le labo apprend et juge sur ces jeux seulement. Les chiffres plus anciens
# restent lus pour les voisins et le palmarès de la série et du studio.
ESTIMATE_MIN_RELEASE = pd.Timestamp("2017-01-01", tz="UTC")


@dataclass
class Snapshot:
    path: Path
    games: pd.DataFrame
    platform_release_dates: pd.DataFrame
    milestones: pd.DataFrame
    reference_profiles: pd.DataFrame
    game_rank: pd.DataFrame
    estimation_methods: pd.DataFrame
    track_record: pd.DataFrame
    prod_latest_estimates: pd.DataFrame
    signals: pd.DataFrame
    followers: pd.DataFrame  # followers Steam (depuis 2024) ; vide si non exportés
    prices: pd.DataFrame  # prix plein Steam actuel (US) ; vide si non exporté


def latest_snapshot_dir() -> Path:
    dirs = sorted(p for p in DATA_DIR.iterdir() if (p / "manifest.json").exists()) if DATA_DIR.exists() else []
    if not dirs:
        raise FileNotFoundError("Aucun snapshot : lancer d'abord `python export_snapshot.py`.")
    return dirs[-1]


def load_snapshot(path: Path | str | None = None) -> Snapshot:
    path = Path(path) if path else latest_snapshot_dir()
    tables = {}
    for name in Snapshot.__dataclass_fields__:
        if name == "path":
            continue
        file = path / f"{name}.parquet"
        # Tables ajoutées après coup (ex. followers) : vides si absentes.
        tables[name] = pd.read_parquet(file) if file.exists() else pd.DataFrame()
    return Snapshot(path=path, **tables)


def released_in_scope(release_dates: pd.Series) -> pd.Series:
    """Jeux que le site estime : sortis depuis 2017, ou sans date connue."""
    release = pd.to_datetime(release_dates, utc=True)
    return release.isna() | (release >= ESTIMATE_MIN_RELEASE)


def usable_milestones(snap: Snapshot) -> pd.DataFrame:
    """Milestones utilisables : non rejetés, hors « engagement », datés.

    Ajoute quelques colonnes pratiques (nom du jeu, jeu supprimé / F2P).
    """
    m = snap.milestones
    m = m[~m.rejected & ~m.isEngagement & m.reportedAt.notna()].copy()
    games = snap.games.set_index("id")
    m["gameName"] = m.gameId.map(games.name)
    m["gameDeleted"] = m.gameId.map(games.deletedAt.notna())
    m["gameIsFree"] = m.gameId.map(games.isFree)
    return m

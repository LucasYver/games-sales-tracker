"""Métriques d'erreur pour des ventes (quantités qui couvrent 5 ordres de
grandeur : 10 k à 100 M).

On mesure l'erreur en FACTEUR, pas en unités : se tromper de 50 000 copies
est énorme pour un jeu à 20 000 et négligeable pour un jeu à 20 M. Le
facteur × est symétrique : estimer 2 M pour 1 M réel = ×2, estimer 500 k
pour 1 M réel = ×2 aussi.

    log_err = ln(estimation / réel)      (> 0 : surestimation)
    facteur = exp(|log_err|)             (1 = parfait, 2 = ×2 de trop ou de moins)

Estimation ponctuelle = milieu (low + high) / 2 de la fourchette, la même
notion de « mid » que l'agrégation en prod. Un modèle dont la fourchette est
symétrique en échelle log (ex. [m / s, m × s]) fournit son centre `m` dans
une colonne `estPoint`, utilisée à la place du milieu arithmétique.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def add_error_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Attend `estLow`, `estHigh`, `units` (et `estPoint` en option) ; ajoute
    les colonnes d'erreur."""
    df = df.copy()
    df["estMid"] = df.estPoint if "estPoint" in df else (df.estLow + df.estHigh) / 2
    df["logErr"] = np.log(df.estMid / df.units)
    df["factor"] = np.exp(df.logErr.abs())
    df["within1_5"] = df.factor <= 1.5
    df["within2"] = df.factor <= 2
    df["covered"] = (df.units >= df.estLow) & (df.units <= df.estHigh)
    df["below"] = df.units < df.estLow   # le réel tombe sous la fourchette
    df["above"] = df.units > df.estHigh  # le réel dépasse la fourchette
    return df


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cum = np.cumsum(w)
    return float(v[np.searchsorted(cum, 0.5 * cum[-1])])


def _stats(df: pd.DataFrame, weights: np.ndarray) -> dict[str, float]:
    w = weights / weights.sum()
    return {
        "facteur_median": float(np.exp(weighted_median(df.logErr.abs().to_numpy(), w))),
        "part_x1_5": float((df.within1_5.to_numpy() * w).sum()),
        "part_x2": float((df.within2.to_numpy() * w).sum()),
        "couverture": float((df.covered.to_numpy() * w).sum()),
        "biais": float(np.exp(weighted_median(df.logErr.to_numpy(), w))),
        "sous_fourchette": float((df.below.to_numpy() * w).sum()),
        "au_dessus": float((df.above.to_numpy() * w).sum()),
    }


def game_weights(df: pd.DataFrame) -> np.ndarray:
    """Poids 1 / (nb de milestones du jeu) : chaque JEU pèse autant.

    Sans ça, un jeu avec 60 milestones pèse 60 fois plus qu'un jeu avec un
    seul, et la métrique décrit surtout quelques gros titres très suivis.
    """
    return (1.0 / df.groupby("gameId").gameId.transform("size")).to_numpy()


def summarize(df: pd.DataFrame, per_game: bool = False, bootstrap: int = 0,
              seed: int = 0) -> dict[str, float]:
    """Métriques sur les lignes estimées de `df` (+ IC 90 % si bootstrap > 0).

    L'intervalle de confiance vient d'un bootstrap PAR JEU : on retire des
    jeux au hasard avec remise (pas des lignes), parce que les milestones
    d'un même jeu ne sont pas indépendants entre eux.
    """
    if df.empty:
        return {"n": 0, "jeux": 0}
    w = game_weights(df) if per_game else np.ones(len(df))
    out: dict[str, float] = {"n": len(df), "jeux": df.gameId.nunique(), **_stats(df, w)}
    if bootstrap:
        rng = np.random.default_rng(seed)
        groups = [idx for idx in df.groupby("gameId").indices.values()]
        samples: dict[str, list[float]] = {k: [] for k in ("facteur_median", "part_x2", "couverture")}
        for _ in range(bootstrap):
            pick = rng.integers(0, len(groups), size=len(groups))
            idx = np.concatenate([groups[i] for i in pick])
            sub = df.iloc[idx]
            s = _stats(sub, game_weights(sub) if per_game else np.ones(len(sub)))
            for k in samples:
                samples[k].append(s[k])
        for k, vals in samples.items():
            lo, hi = np.percentile(vals, [5, 95])
            out[f"{k}_ic90"] = f"[{lo:.2f} ; {hi:.2f}]" if k == "facteur_median" else f"[{lo:.0%} ; {hi:.0%}]"
    return out


def segment_table(df: pd.DataFrame, by: str | list[str], per_game: bool = False, min_n: int = 1) -> pd.DataFrame:
    rows = []
    for key, sub in df.groupby(by, observed=True, dropna=False):
        s = summarize(sub, per_game=per_game)
        if s["n"] < min_n:
            continue
        rows.append({**({by: key} if isinstance(by, str) else dict(zip(by, key))), **s})
    return pd.DataFrame(rows)


def format_table(t: pd.DataFrame) -> str:
    t = t.copy()
    for col in ("part_x1_5", "part_x2", "couverture", "sous_fourchette", "au_dessus"):
        if col in t:
            t[col] = t[col].map(lambda v: f"{v:.0%}")
    for col in ("facteur_median", "biais"):
        if col in t:
            t[col] = t[col].map(lambda v: f"×{v:.2f}")
    return t.to_markdown(index=False)

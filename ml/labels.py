"""Chiffres publiés suspects : écartés de l'ENTRAÎNEMENT des modèles seulement.

La table `milestone` n'est pas modifiée. Ces chiffres restent visibles et les
modèles sont toujours jugés deux fois : sur tous les chiffres, et sur les
chiffres nettoyés (retirer des cas « difficiles » embellit les scores).

Trois règles, volontairement prudentes :

1. Incohérent dans le temps : moins de la moitié d'un chiffre ANTÉRIEUR du
   même jeu. Les ventes cumulées ne baissent pas : c'est presque toujours un
   chiffre partiel (une plateforme, une région, une édition).
2. Partiel probable : le chiffre est plus de 4 fois PLUS PETIT que ce que
   disent les trois modèles (site, forêt, linéaire + interactions), alors que
   ces modèles sont d'accord entre eux (à ×2,5 près).
   On ne marque pas le sens inverse (chiffre bien plus grand que les
   modèles) : ce sont souvent de vrais succès console que tous les modèles
   sous-estiment ; les retirer cacherait un défaut des modèles.
3. Écart extrême : plus de ×20 dans un sens ou dans l'autre, les trois
   modèles d'accord sur le sens. Typiquement un chiffre rattaché au mauvais
   jeu, ou une annonce du jour de sortie sans aucun signal encore.

Les prédictions utilisées sont « hors pli » : chaque jeu est prédit par des
modèles qui ne l'ont jamais vu.

S'y ajoutent les jeux exclus à la main (`exclusions.py`) : tous leurs chiffres
sont écartés de la même façon.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import exclusions

PARTIAL_FACTOR = 4.0
AGREEMENT_FACTOR = 2.5
EXTREME_FACTOR = 20.0
REASONS = {
    "temps": "incohérent dans le temps (moins de la moitié d'un chiffre antérieur du même jeu)",
    "partiel": "bien plus petit que ce que disent tous les modèles (chiffre partiel probable)",
    "extrême": "écart extrême avec tous les modèles (mauvais jeu ou annonce du jour de sortie)",
}


def _oof_predictions(table: pd.DataFrame, specs: list, seed: int) -> pd.DataFrame:
    """log(ventes) prédit pour chaque ligne par des modèles qui n'ont pas vu le jeu."""
    from bench import _fit_core, fit  # import local : bench importe ce module

    out = pd.DataFrame(index=table.index)
    folds = GroupKFold(n_splits=5, shuffle=True, random_state=seed).split(table, groups=table.gameId)
    for tr, te in folds:
        train, test = table.iloc[tr], table.iloc[te]
        train = train[~train.gameId.isin(exclusions.excluded_ids())]
        for spec in specs:
            predict = fit(spec, train).predict if spec.kind == "ridge" else _fit_core(spec, train, None)[0]
            out.loc[test.index, spec.name] = predict(test)
    out["Site"] = np.log(table.baselineMid)
    return out


def flag_suspects(table: pd.DataFrame, specs: list, seed: int) -> pd.DataFrame:
    """Renvoie, pour chaque ligne de `table`, `suspect` (bool) et `suspectReason`."""
    preds = _oof_predictions(table, specs, seed)
    err = preds.sub(table.y, axis=0)  # log(estimation / vrai chiffre)
    same_sign = np.sign(err).nunique(axis=1) == 1
    closest = err.abs().min(axis=1)
    agree = (preds.max(axis=1) - preds.min(axis=1)) < math.log(AGREEMENT_FACTOR)
    partial = same_sign & (err.min(axis=1) > math.log(PARTIAL_FACTOR)) & agree
    extreme = same_sign & (closest > math.log(EXTREME_FACTOR))

    in_time = pd.Series(False, index=table.index)
    for _, d in table.sort_values("reportedAt").groupby("gameId"):
        running_max = d.units.cummax().shift(1)
        in_time.loc[d.index] = (d.units < running_max / 2).fillna(False).to_numpy()

    excluded = table.gameId.isin(exclusions.excluded_ids())
    reason = np.select([in_time, extreme, partial, excluded],
                       [REASONS["temps"], REASONS["extrême"], REASONS["partiel"], exclusions.REASON], "")
    out = pd.DataFrame({"suspect": reason != "", "suspectReason": reason, "excludedGame": excluded}, index=table.index)
    for name in preds.columns:
        out[f"pred_{name}"] = np.exp(preds[name])
    return out

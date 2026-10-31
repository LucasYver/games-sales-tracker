"""Jeux exclus à la main de l'ENTRAÎNEMENT des modèles.

Certains jeux induisent les modèles en erreur pour une raison connue, même quand
leurs chiffres sont justes. La liste est dans `excluded_games.csv` (gardé dans
git, avec la raison de chaque jeu) et se gère depuis « Qualité des données ».

Ce que ça change, après avoir relancé `bench.py` :
  - aucun chiffre de ces jeux ne sert à entraîner les modèles ;
  - la base n'est pas modifiée, et le site non plus tant qu'un nouveau modèle
    n'est pas figé (`freeze.py`) puis installé ;
  - le modèle peut toujours estimer ces jeux, et ils restent jugés dans « tous
    les chiffres » ;
  - leurs chiffres servent encore aux voisins et au palmarès de la série et du
    studio : la prod les lit aussi, le modèle doit voir la même chose.

Retirer un jeu difficile embellit le score sans améliorer le modèle : `measure`
compare donc avec et sans l'exclusion, jugé sur exactement les mêmes chiffres.

Usage (depuis ml/) :
    .venv/bin/python exclusions.py     # mesure l'effet de la liste actuelle
"""

from __future__ import annotations

import math
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

PATH = Path(__file__).resolve().parent / "excluded_games.csv"
COLUMNS = ["gameId", "jeu", "raison", "ajouté le"]
REASON = "jeu exclu à la main"


def load() -> pd.DataFrame:
    return pd.read_csv(PATH, dtype=str, keep_default_na=False) if PATH.exists() else pd.DataFrame(columns=COLUMNS)


def excluded_ids() -> set[str]:
    return set(load().gameId)


def _save(df: pd.DataFrame) -> None:
    df.sort_values("jeu").to_csv(PATH, index=False)


def add(game_id: str, name: str, reason: str) -> None:
    df = load()
    row = pd.DataFrame([[game_id, name, reason, date.today().isoformat()]], columns=COLUMNS)
    _save(pd.concat([df[df.gameId != game_id], row], ignore_index=True))


def remove(game_id: str) -> None:
    df = load()
    _save(df[df.gameId != game_id])


def measure(b, bootstrap: int = 300) -> dict | None:
    """Le modèle en prod, entraîné avec puis sans les jeux exclus, jugé sur les mêmes chiffres
    (jeux jamais vus, hors jeux exclus et hors chiffres suspects). None si la liste n'a aucun effet."""
    from bench import ML_MODEL, N_FOLDS, SEED, _fit_core, paired_gain  # import local : bench importe labels

    dev = b.table.reset_index(drop=True)
    in_list = dev.gameId.isin(excluded_ids())
    if not in_list.any():
        return None
    spec = next(s for s in b.specs if s.name == ML_MODEL)
    rule_suspect = dev.suspect & (dev.suspectReason != REASON)
    judged = (~rule_suspect & ~in_list).to_numpy()
    err = {"avec": np.empty(len(dev)), "sans": np.empty(len(dev))}
    for tr, te in GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED).split(dev, groups=dev.gameId):
        train = dev.iloc[tr][~rule_suspect.iloc[tr]]
        test = dev.iloc[te]
        err["avec"][te] = _fit_core(spec, train, None)[0](test) - test.y.to_numpy()
        err["sans"][te] = _fit_core(spec, train[~train.gameId.isin(excluded_ids())], None)[0](test) - test.y.to_numpy()
    frames = {k: pd.DataFrame({"gameId": dev.gameId[judged], "logErr": v[judged]}).set_axis(dev.milestoneId[judged])
              for k, v in err.items()}
    typical = {k: math.exp(f.logErr.abs().median()) for k, f in frames.items()}
    within_2 = {k: float((f.logErr.abs() <= math.log(2)).mean()) for k, f in frames.items()}
    return {
        "jeux_exclus": int(dev.gameId[in_list].nunique()), "chiffres_exclus": int(in_list.sum()),
        "chiffres_jugés": int(judged.sum()), "avec": typical["avec"], "sans": typical["sans"],
        "avec_x2": within_2["avec"], "sans_x2": within_2["sans"],
        "proba_meilleur": paired_gain(frames["avec"], frames["sans"], bootstrap)["proba_meilleur"],
    }


def main() -> None:
    import bench
    from snapshot import load_snapshot

    b = bench.load_saved_bench(load_snapshot().path.name)
    if b is None:
        raise SystemExit("Lancer d'abord bench.py sur ce snapshot.")
    r = measure(b)
    if r is None:
        raise SystemExit("Aucun jeu de la liste n'a de chiffre dans le banc.")
    print(f"{r['jeux_exclus']} jeux exclus ({r['chiffres_exclus']} chiffres), jugé sur {r['chiffres_jugés']} chiffres")
    print(f"avec eux : ×{r['avec']:.3f} (à ×2 : {r['avec_x2']:.0%})")
    print(f"sans eux : ×{r['sans']:.3f} (à ×2 : {r['sans_x2']:.0%})")
    print(f"sans eux, mieux dans {r['proba_meilleur']:.0%} des tirages")


if __name__ == "__main__":
    main()

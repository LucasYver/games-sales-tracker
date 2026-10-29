"""Fige les deux modèles finalistes, pour le test neutre et pour la prod.

Pourquoi figer ? Le banc d'essai a servi à CHOISIR (réglages, informations,
modèle) : ses scores sont donc un peu flatteurs. Le seul juge vraiment neutre,
ce sont des chiffres publiés après ce choix. On fige maintenant les deux
finalistes, entraînés sur tous les chiffres propres du snapshot ; dans
quelques mois, `prospective_test.py` les jugera sur les chiffres sortis depuis,
sans rien réentraîner.

Écrit dans `models/<snapshot>/` (à garder dans git, ne plus jamais modifier) :
  - ensemble.json   « Moyenne forêt + linéaire » : la forêt (arbre par arbre)
                     et la régression (moyennes, échelles, coefficients).
                     C'est aussi le modèle lu par le backend.
  - forest_knn.json  « Forêt + voisins » : la même forêt + l'erreur moyenne de
                     la forêt sur chaque jeu d'entraînement (pour la correction).
  - training.json    ce que les modèles ont vu : snapshot, jeux, chiffres.

Vérifie au passage que la relecture des fichiers (`frozen.py`, sans
scikit-learn) redonne les prédictions de scikit-learn.

Usage (depuis ml/) :
    .venv/bin/python freeze.py             # fige (refuse d'écraser un gel existant)
    .venv/bin/python freeze.py --install   # copie ensemble.json dans le backend
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import bench
from features import N_TAGS, game_tags, tag_col
from frozen import MODELS, FrozenEnsemble, FrozenForestKnn
from snapshot import load_snapshot

CHOSEN = bench.V11_MODEL
CHALLENGER = "Forêt + voisins"
BACKEND_MODEL = Path(__file__).resolve().parents[1] / "backend/src/estimation/ml/ensemble-model.json"


def _f32(v: float) -> str:
    """Nombre écrit au plus court qui redonne exactement le même float32."""
    return str(np.float32(v))


def export_tree(estimator) -> str:
    """Un arbre en JSON compact : f = feature (-1 = feuille), x = seuil ou valeur, r = enfant droit.

    Les seuils sont arrondis au float32 inférieur : scikit-learn compare des
    features float32, et pour un float32 `v`, `v <= seuil` équivaut alors à
    `v <= arrondi_inférieur(seuil)`. Les valeurs des feuilles (log des ventes)
    perdent ~1e-7 en relatif, sans effet sur le chiffre affiché.
    """
    t = estimator.tree_
    feature, right, x = [], [], []
    for i in range(t.node_count):
        leaf = t.children_left[i] == -1
        if not leaf:
            # Arbres construits en profondeur : l'enfant gauche suit toujours son parent.
            assert t.children_left[i] == i + 1
            thr = np.float32(t.threshold[i])
            if float(thr) > t.threshold[i]:
                thr = np.nextafter(thr, np.float32(-np.inf))
        feature.append(-1 if leaf else int(t.feature[i]))
        right.append(-1 if leaf else int(t.children_right[i]))
        x.append(_f32(t.value[i][0][0]) if leaf else _f32(thr))
    return '{"f":%s,"x":[%s],"r":%s}' % (json.dumps(feature, separators=(",", ":")), ",".join(x),
                                         json.dumps(right, separators=(",", ":")))


def top_tags(snap, table: pd.DataFrame, tag_cols: list[str]) -> list[dict]:
    """Retrouve le texte des tags derrière les colonnes `tag_*` (même calcul que `build_feature_table`)."""
    games = snap.games.set_index("id")
    counts = pd.Series([t for gid in table.gameId.unique() for t in game_tags(games, gid) if t != "indie"])
    tags = list(counts.value_counts().index[:N_TAGS])
    assert [tag_col(t) for t in tags] == tag_cols, "tags différents de ceux du banc d'essai"
    return [{"column": tag_col(t), "tag": t} for t in tags]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", help="copier ensemble.json dans le backend")
    args = parser.parse_args()

    snap = load_snapshot()
    out = MODELS / snap.path.name
    if (out / "ensemble.json").exists():
        print(f"Modèles déjà figés dans {out} : on n'y touche plus.")
    else:
        freeze(snap, out)
    if args.install:
        BACKEND_MODEL.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out / "ensemble.json", BACKEND_MODEL)
        print(f"→ copié dans {BACKEND_MODEL}")


def freeze(snap, out: Path) -> None:
    b = bench.load_saved_bench(snap.path.name)
    assert b is not None, "lancer d'abord bench.py sur ce snapshot"
    specs = {s.name: s for s in b.specs}
    ensemble_spec = specs[CHOSEN]
    forest_spec, ridge_spec = ensemble_spec.members
    tag_cols = [f for f in ridge_spec.features if f.startswith("tag_")]

    # Comme pour le banc et l'UI : on apprend sur les chiffres propres (base intacte).
    table = b.table[~b.table.suspect].reset_index(drop=True)
    print(f"Entraînement sur {len(table)} chiffres de {table.gameId.nunique()} jeux (snapshot {snap.path.name})")

    _, forest = bench._fit_core(forest_spec, table, None)
    ridge = bench.fit(ridge_spec, table)
    scaler, reg = ridge.model.named_steps["standardscaler"], ridge.model.named_steps["ridge"]
    halfwidths = b.choices[b.choices.modèle == CHOSEN]["demi-largeur"]
    cv = b.cv_scores.set_index("modèle")

    out.mkdir(parents=True, exist_ok=True)

    # ─── « Moyenne forêt + linéaire » ────────────────────────────────────
    doc = {
        "name": CHOSEN,
        "version": snap.path.name,
        "frozenAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trainingRows": len(table),
        "trainingGames": int(table.gameId.nunique()),
        # Fourchette : estimation ÷ facteur → estimation × facteur. Mesurée au
        # banc sur des jeux non vus, elle contient le vrai chiffre ~8 fois sur 10.
        "halfWidthFactor": float(halfwidths.median()),
        "benchmark": {k: float(cv.loc[CHOSEN, k]) for k in ("facteur_median", "part_x2", "couverture", "biais")},
        "tags": top_tags(snap, b.table, tag_cols),
        "ridge": {
            "features": list(ridge_spec.features),
            "alpha": float(ridge.hp),
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
            "coef": reg.coef_.tolist(),
            "intercept": float(reg.intercept_),
        },
        "forest": {"features": list(forest_spec.features), "trees": "__TREES__"},
    }
    trees = ",\n".join(export_tree(e) for e in forest.estimators_)
    text = json.dumps(doc, indent=1, ensure_ascii=False).replace('"__TREES__"', "[\n" + trees + "\n]")
    (out / "ensemble.json").write_text(text + "\n")

    # ─── « Forêt + voisins » : erreurs de la forêt sur des jeux qu'elle n'a pas vus ─
    resid = np.empty(len(table))
    for tr, va in GroupKFold(n_splits=4, shuffle=True, random_state=bench.SEED).split(table, groups=table.gameId):
        p, _ = bench._fit_core(forest_spec, table.iloc[tr], None)
        resid[va] = table.y.to_numpy()[va] - p(table.iloc[va])
    game_resid = pd.Series(resid).groupby(table.gameId).mean()
    knn_widths = b.choices[b.choices.modèle == CHALLENGER]["demi-largeur"]
    (out / "forest_knn.json").write_text(json.dumps({
        "name": CHALLENGER,
        "version": snap.path.name,
        "forest": "ensemble.json",
        "alpha": bench.KNN_ALPHA,
        "neighbours": bench.KNN_NEIGHBOURS,
        "halfWidthFactor": float(knn_widths.median()),
        "benchmark": {k: float(cv.loc[CHALLENGER, k]) for k in ("facteur_median", "part_x2", "couverture", "biais")},
        "residuals": {g: float(v) for g, v in game_resid.items()},
    }, indent=1, ensure_ascii=False) + "\n")

    # ─── Ce que les modèles ont vu ───────────────────────────────────────
    manifest = json.loads((snap.path / "manifest.json").read_text())
    (out / "training.json").write_text(json.dumps({
        "snapshot": snap.path.name,
        "snapshotExportedAt": manifest["exportedAt"],
        "trainingGameIds": sorted(table.gameId.unique()),
        "trainingMilestoneIds": sorted(table.milestoneId),
        # Tous les chiffres présents dans la base au moment du snapshot : un
        # chiffre absent de cette liste est « nouveau » pour le test neutre.
        "snapshotMilestoneIds": sorted(snap.milestones.id),
    }, indent=1) + "\n")

    # ─── Vérification : relecture des fichiers = scikit-learn ────────────
    frozen = FrozenEnsemble.load(out / "ensemble.json")
    sk_forest = forest.predict(b.table[forest_spec.features])
    sk_ridge = ridge.predict(b.table)
    gap_forest = np.abs(frozen.predict_forest(b.table) - sk_forest).max()
    gap_ridge = np.abs(frozen.predict_ridge(b.table) - sk_ridge).max()
    print(f"Écart max relecture / scikit-learn (log) : forêt {gap_forest:.1e}, linéaire {gap_ridge:.1e}")
    assert gap_forest < 1e-5 and gap_ridge < 1e-9
    FrozenForestKnn.load(frozen, out / "forest_knn.json")

    size = (out / "ensemble.json").stat().st_size / 1e6
    nodes = sum(e.tree_.node_count for e in forest.estimators_)
    print(f"Régularisation choisie : {ridge.hp} · {len(forest.estimators_)} arbres, {nodes:,} nœuds · "
          f"ensemble.json {size:.1f} Mo")
    print(f"Fourchette : ÷/× {frozen.halfwidth:.2f} → {out}")


if __name__ == "__main__":
    main()

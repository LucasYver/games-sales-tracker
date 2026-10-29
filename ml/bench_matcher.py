"""Faut-il repenser les jeux voisins (matcher) ?

Le modèle choisi (moyenne forêt + linéaire) reçoit trois informations du
matcher : ventes par review, croissance de la 1re année et part PC des 15 jeux
les plus similaires. On compare, sur les mêmes chiffres et avec le protocole
du banc (validation croisée par jeu, test dans le temps) :

  - avec les voisins (le modèle actuel) ;
  - sans aucun voisin ;
  - à la place des voisins, le palmarès de la série et du studio : le meilleur
    chiffre monde publié AVANT la date par un jeu précédent de la même série
    ou du même studio (ex. Transport Fever 3 → Transport Fever 2) ;
  - les voisins ET le palmarès.

Jugé aussi à part sur les chiffres de jeux qui ont un prédécesseur dans leur
série, là où le palmarès devrait le plus aider, et sur tout le catalogue.

Usage (depuis ml/) :
    .venv/bin/python bench_matcher.py      → reports/bench_matcher.md
"""

from __future__ import annotations

import json
import math
import time

import pandas as pd

import bench
from backtest import compute_backtest, to_us
from baseline import Estimator
from bench import SEED, TREE_FEATURES, ModelSpec, all_features
from checks import SITE, catalog_check, catalog_rows
from features import (CURVE_FEATURES, INTERACTION_FEATURES, MATCHER_FEATURES, SIMILARITY_FEATURES, SPREAD_FEATURES,
                      TRACK_RECORD_FEATURES, FeatureBuilder, build_feature_table)
from labels import flag_suspects
from metrics import add_error_columns, format_table
from snapshot import load_snapshot

BOOTSTRAP = 300
WITH = "Avec voisins (actuel)"
V11 = bench.V11_MODEL


def ensemble(name: str, description: str, trees: list[str], linear: list[str]) -> ModelSpec:
    return ModelSpec(name, description, "ensemble", members=[
        ModelSpec(f"{name} (forêt)", "", "forest", trees),
        ModelSpec(f"{name} (linéaire)", "", "ridge", linear + INTERACTION_FEATURES)])


def model_specs(tag_cols: list[str]) -> list[ModelSpec]:
    by = {s.name: s for s in bench.model_specs(tag_cols)}
    trees, linear = TREE_FEATURES + TRACK_RECORD_FEATURES, all_features(tag_cols) + TRACK_RECORD_FEATURES
    plus = lambda name, desc, extra: ensemble(name, desc, trees + extra, linear + extra)  # noqa: E731
    return [
        by[SITE],
        ensemble(WITH, "La moyenne forêt + linéaire telle qu'en prod.", TREE_FEATURES, all_features(tag_cols)),
        ensemble(V11, "Le matcher et le palmarès de la série et du studio.", trees, linear),
        plus("v1.1 + courbe de vie (piste 2)", "Plus la part de la 1re année que les voisins avaient vendue au même "
             "âge.", CURVE_FEATURES),
        plus("v1.1 + similarité (piste 5)", "Plus la similarité moyenne et maximale des voisins.", SIMILARITY_FEATURES),
        plus("v1.1 + désaccord (piste 6)", "Plus le désaccord des voisins sur les ventes par review.",
             SPREAD_FEATURES),
        plus("v1.1 + pistes 2, 5 et 6", "Les trois ensemble.", CURVE_FEATURES + SIMILARITY_FEATURES + SPREAD_FEATURES),
    ]


def main() -> None:
    t0 = time.time()
    snap = load_snapshot()
    est = Estimator(snap)
    res = compute_backtest(snap, est)
    table, tag_cols = build_feature_table(snap, est, res)
    by = {s.name: s for s in bench.model_specs(tag_cols)}
    table = table.join(flag_suspects(table, [by["Forêt aléatoire"], by["Linéaire + interactions"]], SEED))
    dev = table.reset_index(drop=True)
    specs = model_specs(tag_cols)
    print(f"{len(dev)} chiffres de {dev.gameId.nunique()} jeux, {len(est.matcher.corpus)} jeux de référence "
          f"({time.time() - t0:.0f}s)")

    cv_preds, _ = bench.cross_validate(specs, dev)
    scores = bench.score(cv_preds, BOOTSTRAP)
    scored = add_error_columns(cv_preds)
    ref = scored[scored.model == WITH].set_index("milestoneId")
    ref11 = scored[scored.model == V11].set_index("milestoneId")
    vs_with = {s.name: bench.paired_gain(ref, scored[scored.model == s.name].set_index("milestoneId"), BOOTSTRAP)
               ["proba_meilleur"] for s in specs if s.name not in (SITE, WITH)}
    vs_v11 = {s.name: bench.paired_gain(ref11, scored[scored.model == s.name].set_index("milestoneId"), BOOTSTRAP)
              ["proba_meilleur"] for s in specs if s.name not in (SITE, WITH, V11)}
    temporal = bench.score(bench.temporal_check(specs, dev))
    with_series = set(dev.milestoneId[dev.has_series_best == 1])
    group = dev.set_index("milestoneId").apply(
        lambda r: "série" if r.has_series_best else ("studio seulement" if r.has_developer_best else "aucun"), axis=1)
    group_scores = {g: bench.score(cv_preds[cv_preds.milestoneId.map(group) == g]) for g in ["série", "studio seulement",
                                                                                          "aucun"]}
    print(f"validations faites ({time.time() - t0:.0f}s)")

    games = snap.games.set_index("id")
    builder = FeatureBuilder(snap, est, tag_cols)
    now_us = to_us(pd.Timestamp(json.loads((snap.path / "manifest.json").read_text())["exportedAt"]))
    rows = catalog_rows(builder, games, now_us)
    catalog = catalog_check(specs, dev, rows)
    shown = (rows.baselineMid >= 300_000) & (rows.log_reviews >= math.log1p(1_000))  # zone affichée
    share = pd.DataFrame([{"jeux": label, "nombre": int(m.sum()),
                           "épisode précédent chiffré": f"{rows[m].has_series_best.mean():.0%}",
                           "studio seulement": f"{(rows[m].has_developer_best.astype(bool) & ~rows[m].has_series_best.astype(bool)).mean():.0%}",
                           "aucun": f"{(~rows[m].has_series_best.astype(bool) & ~rows[m].has_developer_best.astype(bool)).mean():.0%}"}
                          for label, m in [("tout le catalogue", pd.Series(True, index=rows.index)),
                                           ("zone où le site affiche le modèle", shown)]])
    train_share = group.value_counts(normalize=True)

    cols = ["modèle", "n", "jeux", "facteur_median", "part_x2", "couverture", "biais"]
    summary = scores[cols].copy()
    summary["meilleur que « avec voisins »"] = summary.modèle.map(lambda n: f"{vs_with[n]:.0%}" if n in vs_with else "")
    summary["meilleur que v1.1"] = summary.modèle.map(lambda n: f"{vs_v11[n]:.0%}" if n in vs_v11 else "")
    lines = [
        f"# Faut-il repenser les jeux voisins ? — snapshot {snap.path.name}\n",
        f"{len(dev)} chiffres monde réels de {dev.gameId.nunique()} jeux ; {len(est.matcher.corpus)} jeux de référence "
        f"dans le corpus du matcher ; {len(with_series)} chiffres de jeux dont un prédécesseur de la série a publié "
        "un chiffre.\n",
        "## Validation croisée (jeux jamais vus)\n",
        "« meilleur que « avec voisins » » : part des tirages (par jeu) où la variante fait mieux que le modèle "
        "actuel.\n",
        format_table(summary), "",
        "## Test dans le temps (apprendre avant 2025, prédire 2025+ sur des jeux jamais vus)\n",
        format_table(temporal[cols]), "",
        "## Selon ce que la série et le studio ont déjà publié\n",
        "Part des chiffres d'entraînement : " + ", ".join(f"{g} {v:.0%}" for g, v in train_share.items()) + ".\n",
        *[x for g, t in group_scores.items() for x in (f"### {g}\n", format_table(t[cols]), "")],
        "## Combien de jeux du catalogue ont un palmarès ?\n",
        share.to_markdown(index=False), "",
        "## Tout le catalogue : modèle ÷ site actuel, par nombre de reviews Steam\n",
        catalog.to_markdown(index=False), "",
    ]
    text = "\n".join(lines)
    print(text)
    bench.REPORTS.mkdir(exist_ok=True)
    (bench.REPORTS / "bench_matcher.md").write_text(text)
    cv_preds.to_parquet(bench.REPORTS / "bench_matcher_oof.parquet", index=False)
    print(f"→ {bench.REPORTS / 'bench_matcher.md'} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()

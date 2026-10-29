"""Banc d'essai v2 : la courbe qui descend et le lancement.

Deux défauts du modèle v1 (« Moyenne forêt + linéaire ») :
  1. sa courbe baisse parfois dans le temps, ce qui est impossible pour des
     ventes cumulées. En cause : les informations « du moment » (joueurs
     connectés, reviews récentes…) ;
  2. il sous-estime les chiffres publiés juste après la sortie, quand les
     signaux n'ont pas encore suivi.

Variantes comparées sur les mêmes chiffres, avec le protocole de bench.py
(validation croisée par jeu, réglages imbriqués, test dans le temps) :
  - v1 tel quel, et v1 « jamais en baisse » ;
  - v2 : sans les informations du moment, avec l'attente et le lancement
    (meilleur rang dans les ventes Steam, followers, prix) ;
  - v2 « jamais en baisse », avec ou sans la vitesse des reviews.

« Jamais en baisse » : à une date, on garde le plus haut chiffre que le
modèle a déjà donné pour ce jeu (frise de dates, voir bench.set_timeline).

En plus des scores habituels : l'erreur selon l'âge du jeu au chiffre, la part
de dates où l'estimation baisse, un contrôle sur tout le catalogue (pas
seulement les jeux qui publient leurs ventes) et la liste des chiffres « de
lancement » suspects (souvent une date de sortie de réédition ou de portage).

Usage (depuis ml/) :
    .venv/bin/python bench_v2.py      → reports/bench_v2.md
"""

from __future__ import annotations

import json
import time

import pandas as pd

import bench
from backtest import compute_backtest, to_us
from baseline import Estimator
from bench import SEED, TREE_FEATURES, ModelSpec, all_features
from checks import (ML_MIN_SITE_UNITS, ML_MIN_STEAM_REVIEWS, SITE, age_table, build_timeline, catalog_check,
                    catalog_rows, launch_suspects, timeline_check)
from features import (INTERACTION_FEATURES, LAUNCH_FEATURES, MOMENTARY_FEATURES, VELOCITY_FEATURES, FeatureBuilder,
                      build_feature_table)
from labels import flag_suspects
from metrics import add_error_columns, format_table
from snapshot import load_snapshot

BOOTSTRAP = 300
V1 = "Moyenne forêt + linéaire"


def ensemble(name: str, description: str, tree_features: list[str], linear_features: list[str]) -> ModelSpec:
    return ModelSpec(name, description, "ensemble", members=[
        ModelSpec(f"{name} (forêt)", "", "forest", tree_features),
        ModelSpec(f"{name} (linéaire)", "", "ridge", linear_features)])


def never_down(spec: ModelSpec, from_day: int = 0) -> ModelSpec:
    if from_day:
        return ModelSpec(f"{spec.name}, jamais en baisse dès J+{from_day}",
                         f"Règle de prod : rien avant J+{from_day} (le site garde son chiffre), puis le plus haut "
                         f"chiffre déjà donné aux dates où le jeu avait au moins {ML_MIN_STEAM_REVIEWS:,} reviews.",
                         "running_max", members=[spec], min_days=from_day, min_reviews=ML_MIN_STEAM_REVIEWS)
    return ModelSpec(f"{spec.name}, jamais en baisse",
                     f"{spec.name}, puis le plus haut chiffre déjà donné pour ce jeu.", "running_max", members=[spec])


def model_specs(tag_cols: list[str]) -> list[ModelSpec]:
    by = {s.name: s for s in bench.model_specs(tag_cols)}
    v1 = by[V1]
    cumulative = lambda fs: [f for f in fs if f not in MOMENTARY_FEATURES]  # noqa: E731
    trees, linear = cumulative(TREE_FEATURES) + LAUNCH_FEATURES, cumulative(all_features(tag_cols)) + LAUNCH_FEATURES
    v2 = ensemble("v2", "Sans les informations du moment, avec l'attente et le lancement (rang dans les ventes "
                        "Steam, followers, prix).", trees, linear + INTERACTION_FEATURES)
    v2_speed = ensemble("v2 + vitesse", "La v2 plus les reviews par jour depuis la sortie (forte au lancement).",
                        trees + VELOCITY_FEATURES, linear + VELOCITY_FEATURES + INTERACTION_FEATURES)
    return [by[SITE], v1, never_down(v1), never_down(v1, from_day=3), v2, never_down(v2), never_down(v2_speed)]


def main() -> None:
    t0 = time.time()
    snap = load_snapshot()
    est = Estimator(snap)
    res = compute_backtest(snap, est)
    table, tag_cols = build_feature_table(snap, est, res)
    bench.set_similarity(est)
    by = {s.name: s for s in bench.model_specs(tag_cols)}
    table = table.join(flag_suspects(table, [by["Forêt aléatoire"], by["Linéaire + interactions"]], SEED))
    table["t_us"] = table.reportedAt.map(to_us)
    dev = table.reset_index(drop=True)
    games = snap.games.set_index("id")
    builder = FeatureBuilder(snap, est, tag_cols)
    now_us = to_us(pd.Timestamp(json.loads((snap.path / "manifest.json").read_text())["exportedAt"]))
    timeline = build_timeline(builder, est, games, dev.gameId.unique(), now_us)
    bench.set_timeline(timeline)
    print(f"{len(dev)} chiffres de {dev.gameId.nunique()} jeux, frise de {len(timeline)} dates "
          f"({time.time() - t0:.0f}s)")

    specs = model_specs(tag_cols)
    cv_preds, choices = bench.cross_validate(specs, dev)
    print(f"validation croisée faite ({time.time() - t0:.0f}s)")
    scores = bench.score(cv_preds, BOOTSTRAP)
    scores_clean = bench.score(cv_preds, BOOTSTRAP, clean=True)
    scored = add_error_columns(cv_preds)
    v1 = scored[scored.model == V1].set_index("milestoneId")
    vs_v1 = {s.name: bench.paired_gain(v1, scored[scored.model == s.name].set_index("milestoneId"), BOOTSTRAP)
             ["proba_meilleur"] for s in specs if s.name not in (SITE, V1)}
    temporal = bench.score(bench.temporal_check(specs, dev))
    drops = timeline_check(specs, dev, timeline)
    print(f"frises faites ({time.time() - t0:.0f}s)")
    catalog = catalog_rows(builder, games, now_us)
    catalog_tbl = catalog_check(specs, dev, catalog)
    suspects = launch_suspects(cv_preds, dev, games, est)

    cols = ["modèle", "n", "jeux", "facteur_median", "part_x2", "couverture", "biais"]
    pct = lambda v: f"{v:.0%}"  # noqa: E731
    summary = scores[cols + ["proba_meilleur"]].copy()
    summary["proba_meilleur"] = summary.proba_meilleur.map(lambda v: "" if pd.isna(v) else pct(v))
    summary["meilleur que v1"] = summary.modèle.map(lambda n: pct(vs_v1[n]) if n in vs_v1 else "")
    drops_tbl = drops.assign(pas_en_baisse=drops.pas_en_baisse.map(lambda v: f"{v:.1%}"),
                             jeux_avec_baisse=drops.jeux_avec_baisse.map(pct),
                             pire_baisse=drops.pire_baisse.map(lambda v: f"×{v:.2f}"))
    lines = [
        f"# Banc d'essai v2 — snapshot {snap.path.name}\n",
        f"{len(dev)} chiffres monde réels de {dev.gameId.nunique()} jeux ; frise de {len(timeline)} dates. "
        "Entraînement sur les chiffres propres, jugement sur tous les chiffres.\n",
        "## Validation croisée (jeux jamais vus)\n",
        "« proba_meilleur » : le modèle bat le site dans cette part des tirages ; « meilleur que v1 » : idem contre "
        "la v1.\n",
        format_table(summary), "",
        "Jugé sur les chiffres nettoyés :\n", format_table(scores_clean[cols]), "",
        "## Test dans le temps (apprendre avant 2025, prédire 2025+ sur des jeux jamais vus)\n",
        format_table(temporal[cols]), "",
        "## Erreur typique selon l'âge du jeu au chiffre (chiffres nettoyés)\n",
        "Entre parenthèses : le biais (×0,80 = 20 % trop bas en médiane).\n",
        age_table(cv_preds, dev).to_markdown(index=False), "",
        "## La courbe baisse-t-elle ?\n",
        "Frise de chaque jeu prédite par un modèle qui ne l'a pas vu. « pas en baisse » : part des passages d'une "
        "date à la suivante où l'estimation perd plus de 5 %.\n",
        drops_tbl.to_markdown(index=False), "",
        "## Tout le catalogue : modèle ÷ site actuel, par nombre de reviews Steam\n",
        f"Médianes sur {len(catalog)} jeux. « zone affichée » : jeux où le site afficherait le modèle (site ≥ "
        f"{ML_MIN_SITE_UNITS:,} et ≥ {ML_MIN_STEAM_REVIEWS:,} reviews).\n",
        catalog_tbl.to_markdown(index=False), "",
        "## Chiffres « de lancement » suspects\n",
        "Publiés 3 jours ou moins après la sortie PC, et plus de 3 fois au-dessus de tous les modèles. Souvent un "
        "total de plusieurs années rattaché à la date d'une réédition, d'un portage ou d'une version 1.0.\n",
        suspects.to_markdown(index=False) if len(suspects) else "Aucun.", "",
        "## Réglages choisis à l'intérieur de chaque pli\n", choices.to_markdown(index=False), "",
    ]
    text = "\n".join(lines)
    print(text)
    bench.REPORTS.mkdir(exist_ok=True)
    (bench.REPORTS / "bench_v2.md").write_text(text)
    cv_preds.to_parquet(bench.REPORTS / "bench_v2_oof.parquet", index=False)
    suspects.to_csv(bench.REPORTS / "launch_suspects.csv", index=False)
    print(f"\n→ {bench.REPORTS / 'bench_v2.md'} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()

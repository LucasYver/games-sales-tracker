"""Page 0: what the lab does and how the model works, in plain words."""

from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

import bench
from dataset import DATA_DIR
from history import HISTORY, LEVERS
from learned import BEST, BEST_KEY
from ui.common import n, snapshots, units

FAMILIES = {
    "signals": ("Les signaux à la date du chiffre", "reviews Steam et part de reviews positives, pic de joueurs, notes PlayStation et Xbox, followers, rang dans les ventes Steam, spectateurs Twitch"),
    "time": ("Le temps", "âge du jeu à la date du chiffre, année de sortie, année du chiffre"),
    "platforms": ("Les plateformes", "sur quelles plateformes le jeu était sorti à cette date, et depuis combien de jours"),
    "target": ("Le type de chiffre demandé", "total, PC, PlayStation ou Xbox"),
    "traits": ("Les caractéristiques du jeu", "tags Steam, genres, prix, modes de jeu, durée de vie, DLC"),
    "track_record": ("Le palmarès", "meilleur chiffre déjà publié par un jeu précédent de la série, et du studio"),
}


def x(value: float) -> str:
    return f"×{value:.2f}".replace(".", ",")


@st.cache_data(show_spinner=False)
def _example_data(snapshot: str, built_at: float) -> pd.DataFrame:
    path = DATA_DIR / snapshot
    figures = bench.load_figures(path)
    p = pd.read_parquet(bench.predictions_dir(path) / f"{BEST_KEY}.parquet")
    p = p[p.test == "cv"]
    estimate = np.exp(np.log(p.estimate).groupby(p.figureId).mean()).rename("estimate")
    t = figures[(figures.target == "TOTAL") & (figures.measure == "ventes")].join(estimate, on="figureId", how="inner")
    return t.sort_values(["game", "reportedAt"])


def render() -> None:
    st.title("Comment ça marche")
    st.caption("Ce que fait le labo, ce qu'est le modèle, et ce qu'on change vraiment quand on dit qu'on « améliore » quelque chose.")

    st.header("En une phrase")
    st.markdown("""
Le modèle regarde **ce qu'on sait d'un jeu à une date** (ses reviews Steam, son âge, ses tags, ses plateformes…) et répond
**combien il a vendu à cette date**. Il a appris à le faire sur les jeux dont les ventes ont été publiées.
""")

    st.header("1. La matière première : une table")
    st.markdown("""
Tout part d'une table où **chaque ligne est un chiffre de ventes publié** : « tel jeu avait vendu 1 million le 12 mars ».
Sur la même ligne, on met tout ce qu'on savait du jeu **ce jour-là**, et rien de plus tard.

| Jeu | Date | Ventes publiées | Reviews Steam ce jour-là | Âge du jeu | Tags | … |
|---|---|---|---|---|---|---|
| Jeu A | 12/03/2025 | 1 000 000 | 20 000 | 30 jours | roguelike, action | … |
| Jeu B | 02/06/2024 | 300 000 | 4 500 | 400 jours | simulation | … |

La colonne « ventes publiées » est la réponse. Les autres colonnes sont les informations.
C'est la page **1 · Les données**.
""")

    st.header("2. Le modèle : beaucoup de petites règles apprises")
    st.markdown("""
Le modèle est un **gradient boosting** : quelques centaines de petits arbres de décision, appris automatiquement sur la table.
Chaque arbre est une suite de questions simples, par exemple :

> Le jeu a-t-il plus de 10 000 reviews ? → oui → A-t-il moins de 30 jours ? → oui → alors il vend un peu plus par review que la moyenne.

Personne n'écrit ces règles. On donne la table à l'algorithme et il trouve les questions qui prédisent le mieux les ventes publiées.

**Ce qu'il prédit exactement** : pas les ventes, mais les **ventes par review**. On multiplie ensuite par les reviews du jeu.
Exemple : il répond « 50 ventes par review », le jeu a 30 000 reviews, l'estimation est 1 500 000.
""")
    st.subheader("Les informations qu'il reçoit")
    rows = [{"Famille": FAMILIES[f][0], "Ce qu'elle contient": FAMILIES[f][1]} for f in BEST.families if f in FAMILIES]
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)

    st.header("3. Comment on sait s'il est bon : le banc")
    st.markdown("""
On cache une partie des jeux au modèle, on lui demande de les estimer, puis on compare à leurs ventes publiées.

- **Erreur typique ×1,47** veut dire : pour le jeu du milieu, l'estimation est à un facteur 1,47 du chiffre publié.
  Pour 1 000 000 publiés, il répond entre 680 000 et 1 470 000.
- **Validation croisée** : chaque jeu est estimé par un modèle qui ne l'a jamais vu.
- **Test dans le temps** : le modèle apprend sur les chiffres d'avant 2025 et estime les jeux sortis depuis.

C'est la page **2 · Le banc**. C'est le seul juge : on ne se compare jamais aux estimations déjà en ligne.
""")

    st.header("4. Ce qu'on change vraiment quand on « améliore »")
    st.markdown("Il n'y a que six sortes de changements possibles. Chaque essai du labo est l'un d'eux :")
    for title, text in LEVERS.values():
        st.markdown(f"- **{title}.** {text}")
    st.markdown("""
Après chaque changement, on **réapprend le modèle depuis zéro** sur la table modifiée, et on le rejuge sur le banc.
Si le score ne s'améliore pas nettement, on annule le changement.
""")
    st.subheader("Et « la première semaine », « les petits jeux », « les consoles » ?")
    st.info("""
Ce ne sont **pas des changements du modèle**. Ce sont des **tranches du résultat**.

« La première semaine » veut dire : parmi les chiffres jugés, je ne regarde que ceux publiés dans les 7 jours après la sortie du jeu.
Sur cette tranche, le modèle se trompe de ×1,53, contre ×1,45 après un mois. C'est une façon de trouver **où** il est mauvais.

Ensuite on cherche **pourquoi**. Pour la première semaine, la réponse était dans les données : la base n'avait souvent aucune
review Steam à la date du chiffre, donc le modèle répondait à l'aveugle. Le changement fait a donc été de **préparer cette donnée
autrement** (reconstruire les reviews au jour du chiffre), puis de réapprendre et rejuger.

Autrement dit : on ne « règle » jamais le modèle sur une tranche. On corrige une donnée ou on ajoute une information, pour tous
les jeux, et on regarde si la tranche qui allait mal va mieux sans abîmer les autres.
""")

    st.header("5. Autour du modèle : trois règles")
    st.markdown("""
Le modèle seul sert pour un jeu dont on ne connaît aucun chiffre. Trois règles s'ajoutent, sans le modifier :

1. **L'ancrage.** Si le jeu a déjà publié un chiffre total, on part de ce chiffre : dernier chiffre × croissance des reviews depuis.
   C'est beaucoup plus précis (×1,14 contre ×1,41). Page **4 · L'ancrage**.
2. **Les consoles.** Les notes PlayStation et Xbox d'aujourd'hui donnent les ventes console. Si consoles + PC dépassent le total du
   modèle, on garde cette somme.
3. **Pas de signal, pas d'estimation.** Sous 10 reviews Steam, sans note console ni chiffre publié, on n'estime pas.
""")
    st.graphviz_chart("""
digraph {
  rankdir=LR; node [shape=box, style=rounded, fontname="Helvetica", fontsize=11]; edge [fontname="Helvetica", fontsize=10];
  base [label="Base du site\\n(chiffres publiés, signaux)"];
  table [label="Table\\nun chiffre par ligne"];
  model [label="Modèle appris\\nventes par review"];
  rules [label="Règles\\nancrage, consoles, pas de signal"];
  out [label="Estimation de chaque jeu\\naujourd'hui"];
  bench [label="Banc\\njuge sur les chiffres publiés"];
  base -> table -> model -> rules -> out; model -> bench [style=dashed, label="jugé"]; rules -> bench [style=dashed];
}""")

    names = [s for s in snapshots() if (bench.predictions_dir(DATA_DIR / s) / f"{BEST_KEY}.parquet").exists()]
    if names:
        st.header("6. Un exemple réel")
        snapshot = names[0]
        t = _example_data(snapshot, (bench.predictions_dir(DATA_DIR / snapshot) / f"{BEST_KEY}.parquet").stat().st_mtime)
        counts = t.groupby("game").size().sort_values(ascending=False)
        game = st.selectbox("Jeu", counts.index, format_func=lambda g: f"{g} ({counts[g]} chiffres)")
        rows = t[t.game == game]
        st.markdown("Chaque ligne est un chiffre publié de ce jeu. L'estimation vient d'un modèle qui **n'a jamais vu ce jeu**.")
        shown = pd.DataFrame({
            "Date": rows.reportedAt.dt.strftime("%d/%m/%Y"), "Âge du jeu": rows.ageDays.round().astype(int).astype(str) + " j",
            "Reviews Steam ce jour-là": rows.steamReviewsAtDate.map(lambda v: "inconnues" if not v > 0 else n(v)),
            "Comment on les connaît": rows.steamReviewsBasis,
            "Ventes par review estimées": (rows.estimate / rows.steamReviewsAtDate).map(lambda v: "—" if not np.isfinite(v) else f"{v:.0f}"),
            "Estimation": rows.estimate.map(units), "Publié": rows.units.map(units),
            "Écart": np.exp(np.abs(np.log(rows.estimate / rows.units))).map(x)})
        st.dataframe(shown, width="stretch", hide_index=True)
        st.caption("Estimation = ventes par review estimées × reviews ce jour-là. Quand les reviews sont inconnues, le modèle "
                   "répond avec le reste (âge, tags, plateformes), et c'est là qu'il se trompe le plus.")

    st.header("7. Tout ce qui a été essayé")
    st.markdown("Scores : erreur typique sur les chiffres totaux, en validation croisée puis dans le temps.")
    kinds = {k: v[0] for k, v in LEVERS.items()}
    table = pd.DataFrame([{"Essai": h["key"], "Quoi": h["title"], "Sorte de changement": kinds[h["lever"]],
                           "Ce qui a été changé exactement": h["what"], "Résultat": h["result"], "Verdict": h["kept"]} for h in HISTORY])
    only = st.radio("Afficher", ["Tout", "Gardés", "Rejetés"], horizontal=True)
    if only != "Tout":
        table = table[table.Verdict.str.startswith("rejeté") == (only == "Rejetés")]
    st.dataframe(table, width="stretch", hide_index=True, height=38 * (len(table) + 1),
                 column_config={"Ce qui a été changé exactement": st.column_config.TextColumn(width="large")})

"""Page 3: where the remaining error comes from."""

from __future__ import annotations

import json

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from dataset import DATA_DIR
from models import LABELS
from ui.common import BLUE, n, snapshots


def x(value: float) -> str:
    return f"×{value:.2f}".replace(".", ",")


def render() -> None:
    names = [s for s in snapshots() if (DATA_DIR / s / "diagnosis.json").exists()]
    st.title("3 · Comprendre les erreurs")
    if not names:
        st.warning("Aucun diagnostic : lancer `diagnose.py`.")
        return
    snapshot = st.sidebar.selectbox("Snapshot", names)
    d = json.loads((DATA_DIR / snapshot / "diagnosis.json").read_text())
    st.caption(f"Sur la meilleure hypothèse du moment ({LABELS.get(d['model'], d['model'])}), chiffres totaux, "
               "validation croisée. Sert à choisir quoi essayer ensuite.")

    o = d["offsets"]
    st.header("L'erreur est surtout propre à chaque jeu")
    st.markdown(f"Sur les {n(o['games'])} jeux qui ont plusieurs chiffres, le modèle se trompe presque du même facteur "
                "à chaque chiffre d'un même jeu : il a mal jugé le jeu, pas la date.")
    a, b, c = st.columns(3)
    a.metric("Part de l'erreur propre au jeu", f"{o['gameShare']:.0%}")
    b.metric("Erreur typique aujourd'hui", x(o["factorNow"]))
    c.metric("Si on connaissait le niveau du jeu", x(o["factorIfGameKnown"]))
    st.caption("Chaque jeu vend plus ou moins par review que ce que ses signaux laissent prévoir, et cet écart dure. "
               "Aucune des informations testées ne l'explique encore.")

    an = d["anchoring"]
    st.header("Ce que vaut un chiffre déjà publié par le jeu")
    st.markdown(f"Pour {n(an['rows'][0]['figures'])} chiffres de {n(an['games'])} jeux, on connaissait déjà un chiffre "
                "plus ancien du même jeu. On peut estimer le nouveau en partant de l'ancien.")
    table = pd.DataFrame(an["rows"]).set_index("gap")
    shown = pd.DataFrame({"Chiffres": table.figures, "Modèle seul": table.model.map(x),
                          "Ancien chiffre tel quel": table.flat.map(x),
                          "Ancien chiffre × croissance des reviews": table.reviews.map(x),
                          "Ancien chiffre × croissance du modèle": table.modelGrowth.map(x)})
    st.dataframe(shown.rename_axis("Temps écoulé depuis l'ancien chiffre"), width="stretch")
    st.caption("Le banc interdit au modèle de voir les chiffres du jeu qu'il estime : c'est ce qu'il faut pour juger un "
               "jeu sans chiffre. Pour un jeu qui a déjà publié un chiffre, partir de ce chiffre est bien plus précis.")

    curve = pd.DataFrame(d["learningCurve"])
    st.header("Ce que vaut d'avoir plus de chiffres")
    st.markdown("Le même modèle, appris sur une partie seulement des jeux, puis jugé sur les mêmes chiffres.")
    fig = go.Figure()
    fig.add_scatter(x=curve.trainGames, y=curve["factor"], mode="lines+markers+text", line=dict(color=BLUE, width=2),
                    marker=dict(size=9), text=[x(v) for v in curve["factor"]], textposition="top center",
                    customdata=curve[["min", "max"]],
                    hovertemplate="%{x} jeux : %{text}<br>selon le découpage : ×%{customdata[0]:.2f} à ×%{customdata[1]:.2f}<extra></extra>")
    fig.update_layout(height=320, margin=dict(l=0, r=10, t=20, b=0), xaxis_title="Jeux avec un chiffre à l'apprentissage",
                      yaxis_title="Erreur typique", showlegend=False)
    fig.update_yaxes(range=[1.3, curve["max"].max() + 0.08], tickprefix="×")
    fig.update_xaxes(range=[0, curve.trainGames.max() * 1.1])
    st.plotly_chart(fig, width="stretch")
    last, before = curve.iloc[-1], curve.iloc[-2]
    st.caption(f"De {n(before.trainGames)} à {n(last.trainGames)} jeux, l'erreur passe de {x(before['factor'])} à "
               f"{x(last['factor'])} : la courbe est presque plate. Ajouter des chiffres du même genre n'améliore plus "
               "le modèle ; il lui faut des informations nouvelles.")

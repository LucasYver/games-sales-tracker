"""Page 4: anchoring a game on the totals it has published."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import anchor
import bench
from dataset import DATA_DIR
from ui.common import BLUE, game_signals, n, snapshots

ORANGE, AQUA = "#eb6834", "#1baf7a"


def x(value) -> str:
    return "—" if value is None else f"×{value:.2f}".replace(".", ",")


@st.cache_data(show_spinner=False)
def _load(snapshot: str, built_at: float):
    path = DATA_DIR / snapshot
    figures = bench.load_figures(path)
    return figures, pd.read_parquet(path / "anchor.parquet"), json.loads((path / "anchor.json").read_text()), anchor.model_logs(path, figures)


def render() -> None:
    names = [s for s in snapshots() if (DATA_DIR / s / "anchor.json").exists()]
    st.title("4 · L'ancrage")
    if not names:
        st.warning("Aucun résultat : lancer `anchor.py`.")
        return
    snapshot = st.sidebar.selectbox("Snapshot", names)
    figures, pairs, result, model_log = _load(snapshot, (DATA_DIR / snapshot / "anchor.json").stat().st_mtime)
    st.caption("Un jeu qui a déjà publié un chiffre total est estimé à partir de ce chiffre : ses ventes par review ce "
               "jour-là, multipliées par ses reviews ensuite. Les jeux sans chiffre gardent le modèle.")

    st.header("Le test")
    st.markdown("Chaque chiffre total est estimé avec seulement les chiffres **plus anciens** du même jeu. "
                "Le modèle, lui, n'a jamais vu le jeu.")
    everything = result["rows"][0]
    a, b, c, d = st.columns(4)
    a.metric("Chiffres testés", n(everything["anchored"]["figures"]), help=f"{n(everything['anchored']['games'])} jeux")
    b.metric("Modèle seul", x(everything["model"]["factor"]))
    c.metric("Avec l'ancrage", x(everything["anchored"]["factor"]))
    d.metric("Dans la fourchette", f"{result['coverage']:.0%}", help="Visé : 80 %")
    for cut in dict.fromkeys(r["cut"] for r in result["rows"][1:]):
        rows = [r for r in result["rows"] if r["cut"] == cut]
        table = pd.DataFrame({"Chiffres": [r["anchored"]["figures"] for r in rows],
                              "Modèle seul": [x(r["model"]["factor"]) for r in rows],
                              "Avec l'ancrage": [x(r["anchored"]["factor"]) for r in rows],
                              "Biais de l'ancrage": [x(r["anchored"]["bias"]) for r in rows]}, index=[r["name"] for r in rows])
        st.dataframe(table.rename_axis(cut), width="stretch")
    launch = result["settings"]["launch"]
    st.caption("Un jeu se vend avant d'être noté : dans ses premiers jours, il vend plus par review qu'ensuite. Une ancre "
               f"prise à ce moment-là est corrigée (force {str(launch['real']).replace('.', ',')} quand les reviews du jour "
               f"sont un vrai relevé, {str(launch['rebuilt']).replace('.', ',')} quand elles sont reconstruites). Sans reviews "
               "à la date de l'ancre, on prolonge par la croissance du modèle. L'estimation ne passe jamais sous le chiffre publié.")

    st.header("Le système complet")
    s = result["system"]
    st.markdown(f"Sur tous les chiffres totaux du développement : l'ancrage quand le jeu avait déjà un chiffre "
                f"({s['anchoredShare']:.0%} des cas), le modèle sinon.")
    table = pd.DataFrame({"Erreur typique": [x(s["model"]["factor"]), x(s["withAnchor"]["factor"])],
                          "À ±20 %": [f"{s['model']['within20']:.0%}", f"{s['withAnchor']['within20']:.0%}"],
                          "À ×2": [f"{s['model']['within2']:.0%}", f"{s['withAnchor']['within2']:.0%}"]},
                         index=["Modèle seul", "Modèle + ancrage"])
    st.dataframe(table, width="stretch")
    st.caption("Le premier chiffre d'un jeu n'a jamais d'ancre dans ce test. Sur le site, tout jeu qui a un chiffre en aurait une.")

    st.header("Un jeu")
    totals = figures[(figures.target == "TOTAL") & (figures.measure == "ventes")]
    counts = totals.groupby("game").size().sort_values(ascending=False)
    game = st.selectbox("Jeu", counts.index, format_func=lambda g: f"{g} ({counts[g]} chiffres)")
    rows = totals[totals.game == game].sort_values("reportedAt")
    line = anchor.curve(figures, game_signals(snapshot, rows.gameId.iloc[0]), rows.gameId.iloc[0], result["settings"])
    fig = go.Figure()
    if len(line):
        fig.add_scatter(x=line["at"], y=line.high, mode="lines", line=dict(width=0), hoverinfo="skip", showlegend=False)
        fig.add_scatter(x=line["at"], y=line.low, mode="lines", line=dict(width=0), fill="tonexty",
                        fillcolor="rgba(235,104,52,0.15)", hoverinfo="skip", showlegend=False)
        fig.add_scatter(x=line["at"], y=line.estimate, mode="lines", name="Estimation ancrée", line=dict(color=ORANGE, width=2),
                        hovertemplate="%{x|%d/%m/%Y} : %{y:,.0f}<extra>Estimation ancrée</extra>")
    model = np.exp(rows.figureId.map(model_log))
    if model.notna().any():
        fig.add_scatter(x=rows.reportedAt, y=model, mode="markers", name="Modèle seul", marker=dict(color=AQUA, size=9, symbol="diamond"),
                        hovertemplate="%{x|%d/%m/%Y} : %{y:,.0f}<extra>Modèle seul</extra>")
    fig.add_scatter(x=rows.reportedAt, y=rows.units, mode="markers", name="Chiffre publié",
                    marker=dict(color=BLUE, size=10, line=dict(width=2, color="rgba(255,255,255,0.9)")),
                    hovertemplate="%{x|%d/%m/%Y} : %{y:,.0f}<extra>Chiffre publié</extra>")
    fig.update_layout(height=420, margin=dict(l=0, r=10, t=10, b=0), yaxis_title="Ventes totales",
                      legend=dict(orientation="h", y=1.1), hovermode="closest")
    st.plotly_chart(fig, width="stretch")
    st.caption("La courbe repart de chaque chiffre publié et suit les reviews du jeu ; la bande est la fourchette. "
               "Les losanges sont ce que le modèle disait sans connaître les chiffres du jeu (jeux du développement seulement).")

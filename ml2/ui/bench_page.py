"""Page 2: the bench. How models are judged, and the scores of the ones that ran."""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import bench
from dataset import DATA_DIR
from models import EXTERNAL, LABELS
from ui.common import BLUE, TARGET_LABELS, n, snapshots

TESTS = {"cv": "Validation croisée", "time": "Test dans le temps"}


def x(value: float) -> str:
    return f"×{value:.2f}".replace(".", ",")


@st.cache_data(show_spinner=False)
def _figures(snapshot: str, built_at: float) -> pd.DataFrame:
    return bench.load_figures(DATA_DIR / snapshot)


@st.cache_data(show_spinner=False)
def _predictions(snapshot: str, key: str, built_at: float) -> pd.DataFrame:
    return pd.read_parquet(bench.predictions_dir(DATA_DIR / snapshot) / f"{key}.parquet")


@st.cache_data(show_spinner="Tirages…")
def _draws(snapshot: str, key: str, test: str, target: str, built_at: float, figure_ids: tuple) -> np.ndarray:
    p = _scored(snapshot, key, built_at)
    return bench.bootstrap_factor(p[(p.test == test) & (p.target == target) & p.figureId.isin(figure_ids)])


def _scored(snapshot: str, key: str, built_at: float) -> pd.DataFrame:
    figures = _figures(snapshot, (DATA_DIR / snapshot / "figures.parquet").stat().st_mtime)
    return bench.with_errors(_predictions(snapshot, key, built_at), figures)


def render() -> None:
    names = snapshots()
    if not names:
        st.error("Aucun snapshot. Lancer `export.py` puis `dataset.py`.")
        return
    snapshot = st.sidebar.selectbox("Snapshot", names)
    path = DATA_DIR / snapshot
    figures = _figures(snapshot, (path / "figures.parquet").stat().st_mtime)

    st.title("2 · Le banc")
    st.caption("Comment un modèle est jugé. Ces règles sont fixées avant d'écrire le premier modèle, "
               "et elles sont les mêmes pour tous.")

    st.header("Les règles")
    st.markdown(f"""
- **Toujours sur des jeux jamais vus.** Un jeu est soit dans l'apprentissage, soit dans le jugement, jamais dans les deux.
- **Validation croisée.** Les jeux sont coupés en {bench.FOLDS} groupes ; chaque groupe est estimé par un modèle appris sur les
  {bench.FOLDS - 1} autres. On recommence sur {bench.REPEATS} découpages différents : un seul découpage fait bouger le résultat d'environ ±0,02.
- **Test dans le temps.** Le modèle apprend des chiffres publiés avant 2025 et estime les jeux sortis depuis. C'est la situation réelle du site.
- **Test final sous clé.** 1 jeu sur {bench.LOCKED_ONE_IN} est mis de côté. Il ne sert qu'une fois, quand le modèle est choisi.
- **Chaque jeu compte une fois**, qu'il ait 1 ou 17 chiffres.
- **Le modèle répond toujours**, même sans aucune information à la date : tous les modèles sont jugés sur les mêmes chiffres.
- **Un gain est retenu** s'il tient sur la validation croisée et dans le temps, et s'il gagne dans au moins 9 tirages de jeux sur 10.
""")
    st.subheader("Les lots")
    sizes = bench.set_sizes(figures)
    short = {**TARGET_LABELS, bench.PLAYERS: "Petits jeux"}
    sizes.columns = [f"{short[c.split()[0]]} · {c.split()[1]}" for c in sizes.columns]
    st.dataframe(sizes, width="stretch")
    st.caption("Le total est la mesure principale, le PC la seconde. PlayStation et Xbox sont affichées pour information : "
               "trop peu de jeux pour départager deux modèles.")

    st.subheader("Les mesures")
    st.markdown("""
- **Erreur typique** : le facteur entre l'estimation et le chiffre publié, pour le jeu du milieu. ×1,50 = 50 % trop haut, ou un tiers trop bas.
- **À ±20 %** et **à ×2** : part des jeux dont l'estimation tombe à moins de ce facteur.
- **Biais** : ×1 = ni trop haut ni trop bas en général ; ×0,80 = 20 % trop bas.
- **Dans la fourchette** : part des chiffres publiés qui tombent dans la fourchette annoncée. Visé : 80 %.
- **Largeur** : la fourchette va de l'estimation ÷ largeur à l'estimation × largeur.
""")
    noise = bench.label_disagreement(figures)
    st.info(f"**Le plancher.** Quand un jeu de plus d'un an a deux chiffres totaux différents à moins de 30 jours d'écart, "
            f"ils diffèrent de {x(noise.median())} en médiane ({len(noise)} paires seulement, donc un ordre de grandeur). "
            f"89 % des chiffres sont des paliers ronds, annoncés après leur passage. Aucun modèle ne peut être mesuré plus précis que ça.")

    # ---- results --------------------------------------------------------------
    st.header("Les résultats")
    keys = [k for k in LABELS if (bench.predictions_dir(path) / f"{k}.parquet").exists()]
    if not keys:
        st.warning("Aucun modèle n'a encore tourné : lancer `bench.py`.")
        return
    built = {k: (bench.predictions_dir(path) / f"{k}.parquet").stat().st_mtime for k in keys}
    c1, c2, c3 = st.columns(3)
    test = c1.radio("Test", list(TESTS), format_func=TESTS.get, horizontal=True)
    target = c2.radio("Chiffre jugé", list(bench.SCORED), format_func=TARGET_LABELS.get, horizontal=True)
    scored = {k: _scored(snapshot, k, built[k]) for k in keys}
    part = {k: p[(p.test == test) & (p.target == target)] for k, p in scored.items()}
    available = [k for k in keys if len(part[k])]
    absent = [LABELS[k] for k in keys if k not in available]
    ours = [k for k in available if k not in EXTERNAL]
    compared = st.multiselect("Modèles comparés", available, default=ours, format_func=LABELS.get) or ours
    reference = c3.selectbox("Référence à battre", compared, format_func=LABELS.get, index=len(compared) - 1)
    # Every model is scored on the figures all the compared models cover.
    common = tuple(sorted(set.intersection(*[set(part[k].figureId) for k in compared])))
    widest = max(part[k].figureId.nunique() for k in compared)
    part = {k: part[k][part[k].figureId.isin(common)] for k in compared}
    keys = compared
    ref_draws = _draws(snapshot, reference, test, target, built[reference], common)
    rows = {}
    for k in keys:
        s = bench.score_repeats(part[k])
        if not s:
            continue
        draws = _draws(snapshot, k, test, target, built[k], common)
        rows[LABELS[k]] = {
            "Erreur typique": x(s["factor"]),
            "Entre découpages": f"{x(s['factorMin'])} à {x(s['factorMax'])}" if part[k].repeat.nunique() > 1 else "—",
            "Incertitude (9 tirages sur 10)": f"{x(np.quantile(draws, 0.05))} à {x(np.quantile(draws, 0.95))}",
            "À ±20 %": f"{s['within20']:.0%}", "À ×2": f"{s['within2']:.0%}", "Biais": x(s["bias"]),
            "Dans la fourchette": f"{s['coverage']:.0%}", "Largeur": x(s["width"]),
            "Bat la référence": "—" if k == reference else f"{(draws < ref_draws).mean():.0%} des tirages",
        }
    first = bench.score_repeats(part[keys[0]])
    note = f"{TESTS[test]}, {TARGET_LABELS[target]} : {n(first['figures'])} chiffres de {n(first['games'])} jeux"
    if len(common) < widest:
        note += f", ceux que tous les modèles comparés couvrent (sur {n(widest)}). Retirer un modèle élargit la comparaison"
    if absent:
        note += f". Sans résultat pour ce test : {', '.join(absent)}"
    st.caption(note + ".")
    st.dataframe(pd.DataFrame(rows).T.rename_axis("Modèle"), width="stretch")
    if first["games"] < 60:
        st.caption("Moins de 60 jeux : ces lignes ne peuvent pas départager deux modèles.")

    # ---- one model in detail -------------------------------------------------
    st.header("Un modèle en détail")
    key = st.selectbox("Modèle", keys, format_func=LABELS.get, index=len(keys) - 1)
    p = part[key]
    segment = st.radio("Découper par", list(bench.SEGMENTS), horizontal=True)
    seg = bench.by_segment(p, segment)
    shown = pd.DataFrame({"Jeux": seg.games.astype(int), "Chiffres": seg.figures.astype(int),
                          "Erreur typique": seg.factor.map(x), "À ±20 %": seg.within20.map("{:.0%}".format),
                          "À ×2": seg.within2.map("{:.0%}".format), "Biais": seg.bias.map(x),
                          "Dans la fourchette": seg.coverage.map("{:.0%}".format)})
    st.dataframe(shown.rename_axis(segment), width="stretch")
    if segment.startswith("Taille"):
        st.caption("Attention : découper par le chiffre publié fait toujours paraître les petits surestimés et les gros "
                   "sous-estimés, même avec un bon modèle. À lire avec le découpage par reviews.")

    one = p[p.repeat == p.repeat.min()]
    lo, hi = min(one.units.min(), one.estimate.min()) * 0.7, max(one.units.max(), one.estimate.max()) * 1.4
    fig = go.Figure()
    for factor, dash in ((1, "solid"), (2, "dot"), (0.5, "dot")):
        fig.add_scatter(x=[lo, hi], y=[lo * factor, hi * factor], mode="lines", hoverinfo="skip", showlegend=False,
                        line=dict(color="rgba(128,128,128,0.6)", width=1, dash=dash))
    fig.add_scatter(x=one.units, y=one.estimate, mode="markers", showlegend=False, customdata=np.stack(
        [one.game, one.reportedAt.dt.strftime("%d/%m/%Y"), one.factor.map(x)], axis=1),
        marker=dict(color=BLUE, size=8, opacity=0.6, line=dict(width=1, color="rgba(255,255,255,0.7)")),
        hovertemplate="%{customdata[0]} (%{customdata[1]})<br>publié %{x:,.0f}<br>estimé %{y:,.0f} (%{customdata[2]})<extra></extra>")
    fig.update_xaxes(type="log", title="Chiffre publié", range=[np.log10(lo), np.log10(hi)])
    fig.update_yaxes(type="log", title="Estimation", range=[np.log10(lo), np.log10(hi)])
    fig.update_layout(height=520, margin=dict(l=0, r=10, t=10, b=0))
    st.plotly_chart(fig, width="stretch")
    st.caption("Un point par chiffre. Sur la diagonale, l'estimation est exacte ; entre les pointillés, elle est à moins de ×2.")

    st.subheader("Les plus gros écarts")
    worst = one.sort_values("factor", ascending=False).head(40)
    st.dataframe(worst[["game", "reportedAt", "ageDays", "origin", "units", "estimate", "ratio", "steamReviews", "sourceUrl"]],
                 width="stretch", hide_index=True,
                 column_config={"game": "Jeu", "reportedAt": st.column_config.DateColumn("Date", format="DD/MM/YYYY"),
                                "ageDays": st.column_config.NumberColumn("Âge (jours)", format="%d"), "origin": "Origine",
                                "units": st.column_config.NumberColumn("Publié", format="localized"),
                                "estimate": st.column_config.NumberColumn("Estimé", format="localized"),
                                "ratio": st.column_config.NumberColumn("Estimé ÷ publié", format="×%.2f"),
                                "steamReviews": st.column_config.NumberColumn("Reviews à la date", format="localized"),
                                "sourceUrl": st.column_config.LinkColumn("Source", display_text="ouvrir")})

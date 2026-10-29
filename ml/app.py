"""Mini-UI pour lire le backtest et disséquer une estimation.

Tourne en local sur le dernier snapshot (`data/<date>/`), sans toucher la base.
Chaque chiffre affiché est expliqué en clair (texte visible + infobulle).

Usage (depuis ml/) :
    .venv/bin/streamlit run app.py
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

from backtest import compute_backtest, to_us
from bench import (PROD_MODEL, ABLATION_MODEL, error_by_age, load_final, load_saved_bench, paired_gain, run_bench, save_bench,
                   set_similarity)
from features import FeatureBuilder
from frozen import NEVER_DOWN_MIN_DAYS, NEVER_DOWN_MIN_REVIEWS, US_PER_DAY, never_down_dates
from playground import LEARNED_MODELS, train as train_playable
from baseline import Estimator
from metrics import add_error_columns, segment_table, summarize
from snapshot import load_snapshot

st.set_page_config(page_title="Labo estimation des ventes", page_icon=":material/query_stats:", layout="wide")

# ─── Couleurs (palette de référence dataviz, clair / sombre) ─────────────────
THEMES = {
    "light": dict(bg="#ffffff", model="#2a78d6", declared="#eb6834", under="#2a78d6", over="#e34948", neutral="#c3c2b7",
                  ink="#0b0b0b", ink2="#52514e", muted="#898781", grid="#e1e0d9", axis="#c3c2b7",
                  ramp=["#86b6ef", "#256abf", "#0d366b"]),
    "dark": dict(bg="#0e1117", model="#3987e5", declared="#d95926", under="#3987e5", over="#e66767", neutral="#5c5b57",
                 ink="#f0efec", ink2="#c3c2b7", muted="#898781", grid="#2c2c2a", axis="#383835",
                 ramp=["#5598e7", "#86b6ef", "#cde2fb"]),
}
C = THEMES["dark" if getattr(st.context.theme, "type", "light") == "dark" else "light"]
FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

PLATFORM_LABELS = {"GLOBAL": "Monde (toutes plateformes)", "PC": "PC", "PLAYSTATION": "PlayStation", "XBOX": "Xbox"}
SOURCE_HELP = {
    "MEDIA": "article de presse ou d'analyste",
    "WIKIPEDIA": "chiffre cité sur Wikipédia",
    "OFFICIAL": "communiqué ou rapport financier de l'éditeur",
    "ANNOUNCEMENT": "annonce sur les réseaux sociaux de l'éditeur",
    "STEAM_LEAK": "fuite Steam de juillet 2018 : nombre de joueurs PC de ~350 jeux",
    "PLAYSTATION_LEAK": "fuite Insomniac 2023 : ventes internes Sony au 27/02/2022",
}
METHOD_LABELS = {
    "boxleiter-default": "Reviews Steam × ventes par review",
    "ps-ratings-boxleiter-default": "Notes PlayStation Store × ventes par note",
    "xbox-ratings-boxleiter-default": "Notes Xbox Store × ventes par note",
    "first-week-extrapolation-pc": "Pic de joueurs au lancement → 1re semaine → aujourd'hui",
    "genre-console-split-from-pc-playstation": "Part PlayStation déduite du PC",
    "genre-console-split-from-ps-xbox": "Part Xbox déduite de PlayStation",
    "genre-console-split-from-pc-xbox": "Part Xbox déduite du PC",
}
SEGMENTS = {
    "Source du chiffre": ("source", "D'où vient le chiffre publié. " + " ; ".join(
        f"**{k}** = {v}" for k, v in SOURCE_HELP.items()) + "."),
    "Âge du jeu au moment du chiffre": ("ageAuReport",
                                        "Temps écoulé entre la sortie du jeu et la date du chiffre publié. "
                                        "« < 3 mois » = annonces de lancement ; « 3 ans + » = vieux jeux."),
    "Taille réelle du jeu": ("tailleReelle", "Le chiffre publié lui-même : petits jeux (< 100 000 ventes) jusqu'aux "
                                             "énormes succès (≥ 10 millions)."),
    "Année du chiffre": ("anneeReport", "L'année où le chiffre a été publié. Les vieux chiffres sont estimés avec "
                                        "des signaux de l'époque, souvent plus rares."),
    "Méthodes PC disponibles à cette date": ("methodesPC",
                                             "Quelles méthodes de calcul PC le site pouvait utiliser à la date du "
                                             "chiffre. **reviews + 1re semaine** = on avait le nombre de reviews Steam "
                                             "ET le pic de joueurs du lancement. **reviews seules** = pas de pic de "
                                             "joueurs mesuré au lancement (souvent des jeux sortis avant 2012-2017)."),
    "Signal console disponible": ("signalConsole",
                                                   "**ratings PS/Xbox dispo** = le "
                                                   "site avait le nombre de notes sur le store console. **splits seuls** "
                                                   "= les ventes console sont devinées à partir du PC, avec une "
                                                   "répartition typique (les notes PS ne sont collectées que depuis "
                                                   "2024, Xbox depuis 2026)."),
}
FACTOR_TICKS = [1 / 10, 1 / 5, 1 / 3, 1 / 2, 1 / 1.5, 1, 1.5, 2, 3, 5, 10]
FACTOR_TEXT = ["÷10", "÷5", "÷3", "÷2", "÷1,5", "=", "×1,5", "×2", "×3", "×5", "×10"]
UNIT_TICKS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
UNIT_TEXT = ["1 k", "10 k", "100 k", "1 M", "10 M", "100 M", "1 G"]

HELP = {
    "erreur": "Pour chaque chiffre publié, on compare le milieu de la fourchette du site au vrai chiffre, en "
              "multiplicateur : 2 M annoncés pour 1 M réel = ×2 ; 500 k annoncés pour 1 M réel = ×2 aussi. On range "
              "toutes ces erreurs de la plus petite à la plus grande et on prend celle du milieu (la médiane). "
              "×1 serait parfait.",
    "x15": "Part des chiffres où le milieu de la fourchette est entre les 2/3 et 1,5 fois le vrai chiffre. "
           "Pour un vrai chiffre de 1 M : entre 667 k et 1,5 M. Plus c'est haut, mieux c'est.",
    "x2": "Part des chiffres où le milieu de la fourchette est entre la moitié et le double du vrai chiffre. "
          "Pour un vrai chiffre de 1 M : entre 500 k et 2 M. Plus c'est haut, mieux c'est.",
    "couverture": "Part des chiffres où le vrai chiffre tombe entre le bas et le haut de la fourchette affichée. "
                  "Ici on ne regarde pas le milieu mais toute la fourchette : une fourchette annoncée comme fiable "
                  "devrait contenir le vrai chiffre la grande majorité du temps (8 fois sur 10, par exemple).",
    "biais": "Le modèle penche-t-il d'un côté ? On calcule estimation ÷ vrai chiffre pour chaque cas et on prend la "
             "médiane. −21 % veut dire : l'estimation « typique » vaut 79 % du vrai chiffre, donc le modèle annonce "
             "en général trop peu. 0 % = aucun penchant.",
    "n": "Nombre de chiffres publiés comparés (après filtres).",
    "jeux": "Nombre de jeux différents derrière ces chiffres (un jeu peut avoir plusieurs chiffres publiés).",
}


# ─── Formatage ───────────────────────────────────────────────────────────────

def rgba(hex_color: str, alpha: float) -> str:
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r},{g},{b},{alpha})"


def thousands(n: float) -> str:
    return f"{n:,.0f}".replace(",", " ")


def fr(x: float, digits: int = 2) -> str:
    return f"{x:.{digits}f}".replace(".", ",")


def units(n: float) -> str:
    if n is None or (isinstance(n, float) and math.isnan(n)):
        return "—"
    if n >= 1e6:
        return f"{fr(n / 1e6, 1 if n < 1e7 else 0)} M"
    if n >= 1e3:
        return f"{fr(n / 1e3, 0)} k"
    return f"{n:.0f}"


def pct(x: float) -> str:
    return f"{x * 100:.0f} %"


def signed_pct(b: float) -> str:
    return f"{'−' if b < 1 else '+'}{pct(abs(b - 1))}"


def bias_text(b: float) -> str:
    if b < 1:
        return f"sous-estime de {pct(1 - b)}"
    return f"surestime de {pct(b - 1)}" if b < 2 else f"surestime (×{fr(b, 1)})"


def style(fig: go.Figure, height: int, title: str | None = None, **layout) -> go.Figure:
    # Titre en haut du cadre, légende juste en dessous, au-dessus du tracé :
    # la marge haute réserve la place des deux pour qu'ils ne se chevauchent pas.
    has_legend = any(t.showlegend is not False for t in fig.data) and len(fig.data) > 1
    top = (34 if title else 8) + (30 if has_legend else 0) + 8
    fig.update_layout(
        height=height + top, margin=dict(l=8, r=8, t=top, b=8),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family=FONT, size=13, color=C["ink2"]),
        title=dict(text=title, x=0, xanchor="left", xref="paper", y=1, yref="container", yanchor="top",
                   pad=dict(t=8), font=dict(size=15, color=C["ink"])) if title else None,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0, title=None),
        hoverlabel=dict(font_family=FONT),
        **layout,
    )
    fig.update_xaxes(gridcolor=C["grid"], linecolor=C["axis"], zeroline=False, tickfont_color=C["muted"], automargin=True)
    fig.update_yaxes(gridcolor=C["grid"], linecolor=C["axis"], zeroline=False, tickfont_color=C["muted"], automargin=True)
    return fig


def show(fig: go.Figure) -> None:
    st.plotly_chart(fig, theme=None, width="stretch", config={"displayModeBar": False})


def how_to_read(text: str) -> None:
    """Encadré « Comment lire » placé juste sous un graphique."""
    st.markdown(f":material/lightbulb: **Comment lire :** {text}")


def three_panel(t: pd.DataFrame, by: str) -> go.Figure:
    """Erreur typique, couverture et tendance, une ligne par groupe (`by`)."""
    # Petits multiples : trois mesures, une colonne chacune, mêmes lignes.
    # Jamais deux échelles sur un même graphique.
    fig = make_subplots(rows=1, cols=3, shared_yaxes=True, horizontal_spacing=0.06, subplot_titles=[
        "Erreur typique (court = mieux)", "Dans la fourchette", "Tendance (− bas · + haut)"])
    fig.add_bar(y=t[by], x=t.facteur_median - 1, base=1, orientation="h", marker_color=C["model"],
                text=[f"×{fr(v)}" for v in t.facteur_median], textposition="outside", cliponaxis=False,
                customdata=t.n, hovertemplate="%{y} : %{text} — %{customdata} chiffres<extra></extra>", row=1, col=1)
    fig.add_bar(y=t[by], x=t.couverture, orientation="h", marker_color=C["model"],
                text=[pct(v) for v in t.couverture], textposition="outside", cliponaxis=False,
                hovertemplate="%{y} : %{text} dans la fourchette<extra></extra>", row=1, col=2)
    lb = np.log10(t.biais)
    fig.add_bar(y=t[by], x=lb, orientation="h", marker_color=[C["under"] if v < 0 else C["over"] for v in lb],
                text=[signed_pct(v) for v in t.biais], textposition="outside",
                cliponaxis=False, customdata=[bias_text(v) for v in t.biais],
                hovertemplate="%{y} : %{customdata}<extra></extra>", row=1, col=3)
    span = max(0.3, float(lb.abs().max()) * 1.5)
    style(fig, 40 + 46 * len(t), bargap=0.4, showlegend=False)
    fig.update_layout(margin=dict(t=44))
    fig.update_annotations(font=dict(size=14, color=C["ink"]), xanchor="left")
    for i, ann in enumerate(fig.layout.annotations):
        ann.x = fig.layout[f"xaxis{'' if i == 0 else i + 1}"].domain[0]
    fig.update_xaxes(range=[1, t.facteur_median.max() * 1.3], tickprefix="×", row=1, col=1)
    fig.update_xaxes(range=[0, 1.2], tickformat=".0%", row=1, col=2)
    fig.update_xaxes(range=[-span, span], tickvals=np.log10(FACTOR_TICKS), ticktext=FACTOR_TEXT, row=1, col=3)
    fig.add_vline(x=0, line=dict(color=C["ink2"], width=1), row=1, col=3)
    return fig


def range_chart(low: float, high: float, actual: float, height: int = 110) -> go.Figure:
    """Une fourchette (barre bleue), son milieu et le vrai chiffre (trait orange)."""
    mid = (low + high) / 2
    fig = go.Figure()
    fig.add_scatter(x=[max(low, 1), high], y=["", ""], mode="lines+markers", name="Fourchette du site",
                    line=dict(color=C["model"], width=10), marker=dict(size=12, color=C["model"]),
                    hovertemplate="%{x:,.0f}<extra></extra>")
    fig.add_scatter(x=[mid], y=[""], mode="markers", name="Milieu de la fourchette",
                    marker=dict(size=14, color=C["bg"], line=dict(width=3, color=C["model"])),
                    hovertemplate="milieu : %{x:,.0f}<extra></extra>")
    fig.add_scatter(x=[actual], y=[""], mode="markers", name="Vrai chiffre (publié)",
                    marker=dict(size=22, symbol="line-ns", line=dict(width=4, color=C["declared"])),
                    hovertemplate="vrai : %{x:,.0f}<extra></extra>")
    lo = min(low if low > 0 else high / 10, actual) / 1.6
    hi = max(high, actual) * 1.6
    style(fig, height)
    fig.update_xaxes(type="log", range=[math.log10(lo), math.log10(hi)], tickvals=UNIT_TICKS + [3e5, 3e6, 3e7],
                     ticktext=UNIT_TEXT + ["300 k", "3 M", "30 M"])
    fig.update_yaxes(showticklabels=False, showgrid=False)
    return fig


# ─── Données (calculées une fois, gardées en mémoire) ────────────────────────

@st.cache_resource(show_spinner="Chargement du snapshot, du modèle et du backtest…")
def load():
    snap = load_snapshot()
    est = Estimator(snap)
    res = compute_backtest(snap, est)
    urls = snap.milestones.set_index("id").sourceUrl
    for df in (res.rows, res.rows_leak):
        df["sourceUrl"] = df.milestoneId.map(urls)
        df["zone"] = np.select([df.logErr < -math.log(2), df.logErr > math.log(2)],
                               ["sous-estimé (au-delà de ×2)", "surestimé (au-delà de ×2)"], "à ×2 près")
    return snap, est, res


snap, est, res = load()


set_similarity(est)  # « Forêt + voisins » utilise la similarité du site


@st.cache_data(show_spinner="Duels entre modèles…")
def duels(snapshot: str, names: tuple[str, ...], clean: bool) -> pd.DataFrame:
    """m.loc[a, b] = part des tirages (bootstrap par jeu) où le modèle a bat le modèle b."""
    preds = load_bench().cv_preds
    scored = add_error_columns(preds[~preds.suspect] if clean and "suspect" in preds.columns else preds)
    rows = {n: scored[scored.model == n].set_index("milestoneId") for n in names}
    return pd.DataFrame({c: {r: np.nan if r == c else paired_gain(rows[c], rows[r], 300)["proba_meilleur"]
                             for r in names} for c in names})


@st.cache_resource(show_spinner=False)
def load_bench():
    """Résultats enregistrés par `bench.py` (l'entraînement prend ~1 minute)."""
    return load_saved_bench(snap.path.name)


SITE = "Modèle actuel (site)"
ERROR_COLS = ["estLow", "estHigh", "estMid", "logErr", "factor", "within1_5", "within2", "covered", "below", "above",
              "zone"]


@st.cache_data(show_spinner=False)
def learned_rows(name: str, snapshot: str) -> pd.DataFrame:
    """Les chiffres publiés, avec l'estimation d'un modèle appris à la place de celle du site.

    Estimations « hors pli » du banc d'essai : chaque jeu deviné par un modèle qui ne l'a jamais vu.
    """
    preds = load_bench().cv_preds
    p = preds[preds.model == name][["milestoneId", "estLow", "estHigh", "estPoint"]]
    out = add_error_columns(res.rows.drop(columns=ERROR_COLS, errors="ignore").merge(p, on="milestoneId"))
    out["hasEstimate"] = True
    out["zone"] = np.select([out.logErr < -math.log(2), out.logErr > math.log(2)],
                            ["sous-estimé (au-delà de ×2)", "surestimé (au-delà de ×2)"], "à ×2 près")
    return out

games = snap.games.set_index("id", drop=False)
anchors_by_id = {a.game_id: a for a in est.matcher.corpus}

# ─── Barre latérale : filtres (s'appliquent à tous les onglets) ──────────────

with st.sidebar:
    st.markdown(f"**Données du {snap.path.name}** · {thousands(len(res.rows))} chiffres de ventes totales à vérifier")
    st.caption("Les réglages ci-dessous filtrent tous les onglets. Survolez les :material/help: pour une explication.")
    bench_now = load_bench()
    evaluated = st.selectbox(
        "Modèle évalué", [SITE] + ([s.name for s in bench_now.specs if s.name != "Modèle actuel"] if bench_now else []),
        help="Le modèle regardé dans « Vue d'ensemble », « Où se trompe-t-il ? » et « Estimé vs réel ». Pour un "
             "modèle appris, chaque chiffre est deviné par une version du modèle qui n'a jamais vu ce jeu (banc "
             "d'essai). « Commencer ici » et la décomposition de « Un jeu à la loupe » parlent toujours du site.")
    is_site = evaluated == SITE
    variant = st.radio(
        "Variante du test", ["Honnête (holdout)", "Avec fuite (sans holdout)"],
        help="Le site s'aide de jeux qui ressemblent et dont on connaît les ventes. **Honnête** : on lui cache le "
             "jeu évalué, comme dans la vraie vie pour un jeu inconnu. **Avec fuite** : on le laisse voir son "
             "propre chiffre, ce qui rend le résultat trop beau. Comparez les deux pour voir l'écart.")
    holdout = variant.startswith("Honnête")
    if not is_site and not holdout:
        st.caption("Les modèles appris sont toujours évalués en mode honnête dans ces onglets (pour voir l'effet de "
                   "la fuite sur eux : « Un jeu à la loupe »).")
    site_rows = res.rows if holdout else res.rows_leak
    rows = site_rows if is_site else learned_rows(evaluated, snap.path.name)
    all_sources = sorted(site_rows.source.unique())
    sources = st.multiselect(
        "Sources", all_sources, default=all_sources,
        help=" · ".join(f"**{k}** : {v}" for k, v in SOURCE_HELP.items() if k in all_sources))
    include_third_party = st.checkbox(
        "Inclure les chiffres estimés par des tiers", value=True,
        help="Certains chiffres « publiés » sont eux-mêmes des estimations d'un cabinet d'analyse (colonne "
             "isEstimate). Décochez pour ne garder que de vrais chiffres.")
    site_years = site_rows.reportedAt.dt.year
    year_range = st.slider("Année du chiffre publié", int(site_years.min()), int(site_years.max()),
                           (int(site_years.min()), int(site_years.max())))
    per_game = st.radio(
        "Pondération", ["Chaque chiffre compte", "Chaque jeu compte autant"],
        help="Un jeu très suivi peut avoir 30 chiffres publiés, un petit jeu un seul. **Chaque jeu compte autant** "
             "évite que les gros jeux très suivis dominent le résultat.") == "Chaque jeu compte autant"

    with st.expander("Glossaire"):
        st.markdown(
            "- **Chiffre publié (milestone)** : un chiffre de ventes daté venant de l'éditeur, de la presse ou de "
            "Wikipédia. On le traite comme le *vrai chiffre*.\n"
            "- **Fourchette** : l'intervalle [bas, haut] que le site affiche pour un jeu.\n"
            "- **Milieu** : (bas + haut) ÷ 2, l'estimation « ponctuelle » du site.\n"
            "- **Facteur ×** : de combien on se trompe, en multiplicateur. ×2 = deux fois trop *ou* deux fois pas "
            "assez.\n"
            "- **Médiane** : la valeur du milieu quand on range tout du plus petit au plus grand.\n"
            "- **Review** : un avis laissé par un joueur sur Steam.\n"
            "- **Pic de joueurs** : le nombre maximum de joueurs connectés en même temps sur Steam.\n"
            "- **Boxleiter** : la règle « ventes ≈ nombre de reviews × un multiplicateur ».\n"
            "- **Matcher / voisins** : les 15 jeux les plus ressemblants dont on connaît les ventes ; le site leur "
            "emprunte leurs multiplicateurs.\n"
            "- **Holdout** : on cache au matcher le jeu évalué, pour qu'il ne triche pas.\n"
            "- **Régression linéaire** : une formule qui multiplie l'estimation par un facteur pour chaque "
            "information.\n"
            "- **Arbre de décision** : une suite de questions oui/non (« plus de 50 000 reviews ? ») qui mène à "
            "une estimation.\n"
            "- **Forêt aléatoire** : des centaines d'arbres indépendants dont on fait la moyenne.\n"
            "- **Gradient boosting** : des arbres construits l'un après l'autre, chacun corrigeant les erreurs "
            "des précédents.\n"
            "- **Backtest** : rejouer le passé pour vérifier ce que le modèle aurait dit."
        )

def apply_filters(df: pd.DataFrame) -> pd.DataFrame:
    return df[df.source.isin(sources) & df.reportedAt.dt.year.between(*year_range)
              & (include_third_party | ~df.isEstimate)]


scope = apply_filters(rows)
ok = scope[scope.hasEstimate]
site_ok = apply_filters(site_rows).pipe(lambda d: d[d.hasEstimate])
# Le site, sur exactement les mêmes chiffres que le modèle évalué (pour comparer à armes égales).
site_same = site_ok[site_ok.milestoneId.isin(ok.milestoneId)]
WHO = "le site" if is_site else "le modèle"
WHO_CAP = WHO.capitalize()
OF_WHO = "du site" if is_site else "du modèle"

st.title("Labo estimation des ventes")
st.caption("Le site affiche, pour chaque jeu, une fourchette de ventes totales estimées. Ici, on vérifie si ces "
           "fourchettes étaient justes en les comparant à des chiffres de ventes publiés. On ne regarde que le "
           "**total** (toutes plateformes confondues). Nouveau ici ? Commencez par le premier onglet.")

if ok.empty:
    st.warning("Aucun chiffre ne correspond aux filtres de la barre latérale.")
    st.stop()
if not is_site:
    st.info(f"Modèle évalué : **{evaluated}** (barre latérale). « Vue d'ensemble », « Où se trompe-t-il ? » et "
            "« Estimé vs réel » montrent ses estimations, chaque jeu deviné sans l'avoir vu ; les tuiles le comparent "
            "au site sur exactement les mêmes chiffres.", icon=":material/model_training:")

tab_start, tab_overview, tab_segments, tab_scatter, tab_game, tab_models, tab_data = st.tabs(
    ["Commencer ici", "Vue d'ensemble", "Où se trompe-t-il ?", "Estimé vs réel", "Un jeu à la loupe",
     "Comparer les modèles", "Qualité des données"])
s_all = summarize(ok, per_game=per_game)
s_site = summarize(site_ok, per_game=per_game)

# ─── 0. Commencer ici ────────────────────────────────────────────────────────

with tab_start:
    st.header("Ce que vous regardez, en 5 minutes")

    st.subheader("1. Ce que le site essaie de deviner")
    st.markdown(
        "Presque aucun éditeur ne publie ses ventes. Le site les **devine** à partir de signaux publics :\n"
        "- le nombre de **reviews Steam** (avis laissés par les joueurs) ;\n"
        "- le **pic de joueurs** connectés en même temps au lancement ;\n"
        "- le nombre de **notes** sur les stores PlayStation et Xbox.\n\n"
        "Il multiplie ces signaux par des ratios, par exemple « 1 review Steam ≈ 30 ventes ». Ces ratios sont "
        "empruntés aux **15 jeux les plus ressemblants** dont on connaît les ventes (même genre, même éditeur, même "
        "époque…). Il calcule PC, PlayStation et Xbox séparément puis les **additionne** : c'est ce **total** "
        "qu'on évalue ici. Comme ce n'est qu'une devinette, le site affiche une **fourchette** : « entre 4 et 9 "
        "millions ».")

    st.subheader("2. Comment on vérifie si la fourchette était juste")
    st.markdown(
        f"De temps en temps, un vrai chiffre est publié : « Hollow Knight a dépassé 15 millions de ventes ». On "
        f"appelle ça un **chiffre publié** (*milestone*) et on le considère comme la vérité. On en a "
        f"**{thousands(len(res.rows))}**.\n\n"
        "Pour chacun, on **remonte le temps** jusqu'au jour de la publication. On recalcule la fourchette que le "
        "site aurait affichée **ce jour-là**, avec uniquement les données connues à cette date. Puis on compare au "
        "vrai chiffre. Ce test s'appelle un **backtest**.\n\n"
        "Pour rester simple, on ne garde que les chiffres **monde** (toutes plateformes confondues), comparés au "
        "total affiché par le site. Les chiffres d'une seule plateforme (« 3 M sur PlayStation ») sont mis de côté "
        "pour l'instant.")

    pool = res.rows[res.rows.hasEstimate]
    example = pool[(pool.gameName == "Hollow Knight") & (pool.platform == "GLOBAL")].sort_values("reportedAt")
    if example.empty:
        example = pool.iloc[(pool.factor - pool.factor.median()).abs().argsort()[:1]]
    ex = example.iloc[0]
    ex_mid = (ex.estLow + ex.estHigh) / 2
    ex_where = ("dans la fourchette" if ex.covered else "au-dessus de la fourchette" if ex.above
                else "sous la fourchette")
    ex_dir = "trop bas" if ex_mid < ex.units else "trop haut"
    with st.container(border=True):
        st.markdown(
            f"**Exemple réel : {ex.gameName}.** Le {ex.reportedAt:%d/%m/%Y}, un chiffre est publié "
            f"({ex.source}) : **{units(ex.units)} ventes**, toutes plateformes confondues.\n\n"
            f"Ce jour-là, le site aurait affiché **{units(ex.estLow)} – {units(ex.estHigh)}**, "
            f"soit un milieu de **{units(ex_mid)}**.")
        show(range_chart(ex.estLow, ex.estHigh, ex.units))
        st.markdown(
            f"→ Le vrai chiffre tombe **{ex_where}**. Le milieu est **{ex_dir}** d'un facteur "
            f"**×{fr(ex.factor)}** ({units(min(ex_mid, ex.units))} × {fr(ex.factor)} ≈ {units(max(ex_mid, ex.units))}).")
        if ex.estLow <= 0 or ex.estHigh / ex.estLow > 10:
            st.caption(f"Remarquez la largeur de la fourchette (de {units(ex.estLow)} à {units(ex.estHigh)}) : ce "
                       "jour-là, les méthodes de calcul se contredisaient, et le site élargit alors la fourchette. "
                       "Le vrai chiffre tombe dedans, mais une fourchette aussi large n'apprend pas grand-chose. "
                       "C'est pour ça qu'on regarde aussi le milieu.")

    st.subheader("3. Les 5 chiffres de la « Vue d'ensemble »")
    st.markdown("On répète la comparaison ci-dessus pour tous les chiffres publiés, puis on résume avec 5 nombres. "
                "Valeurs actuelles avec vos filtres :")
    explain = [
        ("Erreur typique", f"×{fr(s_site['facteur_median'])}",
         "**De combien se trompe-t-on d'habitude ?** On prend l'écart en multiplicateur de chaque cas (×"
         f"{fr(ex.factor)} dans l'exemple), on les range, et on garde celui du milieu. La moitié des cas se trompent "
         "moins que ça, l'autre moitié plus. Idéal : proche de ×1."),
        ("À moins de ×1,5", pct(s_site["part_x1_5"]),
         "**Combien d'estimations sont assez précises ?** Part des cas où le milieu est entre les 2/3 et 1,5 fois "
         "le vrai chiffre (pour 1 M réel : entre 667 k et 1,5 M). "
         f"Dans l'exemple, l'erreur est ×{fr(ex.factor)} : il {'compte' if ex.within1_5 else '**ne compte pas**'}."),
        ("À moins de ×2", pct(s_site["part_x2"]),
         "**Combien d'estimations sont dans le bon ordre de grandeur ?** Milieu entre la moitié et le double du "
         f"vrai chiffre (pour 1 M réel : 500 k – 2 M). Dans l'exemple (×{fr(ex.factor)}), il "
         f"{'compte' if ex.within2 else '**ne compte pas**'}."),
        ("Vrai chiffre dans la fourchette", pct(s_site["couverture"]),
         "**La fourchette affichée est-elle fiable ?** Part des cas où le vrai chiffre est entre le bas et le haut. "
         f"L'exemple {'compte' if ex.covered else 'ne compte pas'} (il est {ex_where}). Une fourchette sérieuse "
         "devrait réussir la grande majorité du temps."),
        ("Tendance", signed_pct(s_site["biais"]),
         "**Le site vise-t-il trop haut ou trop bas ?** Négatif = il annonce en général moins que la réalité ; "
         "positif = plus. 0 % = aucun penchant."),
    ]
    for name, value, text in explain:
        with st.container(border=True):
            c1, c2 = st.columns([1, 4])
            c1.metric(name, value)
            c2.markdown(text)

    st.subheader("4. Lire un facteur ×")
    st.markdown("On parle en multiplicateur parce que les ventes vont de 10 000 à 100 millions : se tromper de "
                "50 000 est énorme pour un petit jeu et négligeable pour un gros. Pour un vrai chiffre de **1 M** :")
    st.table(pd.DataFrame({
        "Facteur": ["×1,25", "×1,5", "×2", "×3", "×5"],
        "Le milieu de la fourchette est entre…": ["800 k et 1,25 M", "667 k et 1,5 M", "500 k et 2 M",
                                                  "333 k et 3 M", "200 k et 5 M"],
        "En clair": ["très précis", "précis", "bon ordre de grandeur", "approximatif", "très loin"],
    }))

    st.subheader("5. Où aller ensuite")
    st.markdown(
        "- **Vue d'ensemble** : la note globale du modèle.\n"
        "- **Où se trompe-t-il ?** : les mêmes notes, groupe par groupe (plateforme, âge du jeu…).\n"
        "- **Estimé vs réel** : chaque chiffre publié devient un point ; les plus grosses erreurs sont listées.\n"
        "- **Un jeu à la loupe** : comment le site fabrique sa fourchette pour un jeu, étape par étape.\n"
        "- **Comparer les modèles** : des modèles appris (machine learning) face au modèle actuel, testés "
        "honnêtement.\n"
        "- **Qualité des données** : d'où viennent les chiffres et ce qu'on a dû nettoyer.")

# ─── 1. Vue d'ensemble ───────────────────────────────────────────────────────

with tab_overview:
    s = s_all
    st.markdown(f"Résumé de **{thousands(s['n'])} comparaisons** entre la fourchette {OF_WHO} et un chiffre publié, "
                f"sur **{s['jeux']} jeux**. Survolez les :material/help: pour le détail du calcul.")
    cols = st.columns(5)
    tiles = [
        ("Erreur typique", f"×{fr(s['facteur_median'])}", HELP["erreur"],
         f"La moitié des estimations sont à moins de ×{fr(s['facteur_median'])} du vrai chiffre, l'autre moitié "
         "plus loin."),
        ("À moins de ×1,5", pct(s["part_x1_5"]), HELP["x15"],
         f"{s['part_x1_5'] * 100:.0f} cas sur 100 : milieu entre les 2/3 et 1,5 fois le vrai chiffre."),
        ("À moins de ×2", pct(s["part_x2"]), HELP["x2"],
         f"{s['part_x2'] * 100:.0f} cas sur 100 : milieu entre la moitié et le double du vrai chiffre."),
        ("Vrai chiffre dans la fourchette", pct(s["couverture"]), HELP["couverture"],
         f"{s['couverture'] * 100:.0f} fois sur 100, le vrai chiffre est entre le bas et le haut affichés."),
        ("Tendance", signed_pct(s["biais"]), HELP["biais"],
         f"En général, {WHO} {'annonce moins que la réalité' if s['biais'] < 1 else 'annonce plus que la réalité'} "
         f"({bias_text(s['biais'])})."),
    ]
    # Écart avec le site, mesuré sur exactement les mêmes chiffres (seulement pour un modèle appris).
    deltas = [(None, "normal")] * 5
    if not is_site:
        sv = summarize(site_same, per_game=per_game)
        pts = lambda k: f"{(s[k] - sv[k]) * 100:+.0f} pts vs site"  # noqa: E731
        deltas = [
            (f"{s['facteur_median'] - sv['facteur_median']:+.2f} vs site (×{fr(sv['facteur_median'])})".replace(".", ",", 1),
             "inverse"),
            (pts("part_x1_5"), "normal"), (pts("part_x2"), "normal"), (pts("couverture"), "normal"),
            (f"site : {signed_pct(sv['biais'])}", "off"),
        ]
    for col, (label, value, help_text, caption), (delta, delta_color) in zip(cols, tiles, deltas):
        with col.container(border=True):
            st.metric(label, value, delta=delta, delta_color=delta_color, help=help_text)
            st.caption(caption)
    if is_site:
        n_missing = int((~scope.hasEstimate).sum())
        st.caption(f"{n_missing} autres chiffres publiés ne sont pas comptés : à leur date, le site n'avait encore "
                   "aucun signal pour ce jeu (pas encore de reviews ni de notes), donc aucune fourchette.")
    else:
        st.caption("Sous chaque chiffre : l'écart avec le site, calculé sur exactement les mêmes chiffres (vert = "
                   "mieux que le site). Les modèles appris sont évalués sur les chiffres réels que le site pouvait "
                   "estimer à leur date ; les chiffres estimés par des tiers n'en font pas partie.")

    # Où tombe le vrai chiffre par rapport à la fourchette ?
    w = (1.0 / ok.groupby("gameId").gameId.transform("size")) if per_game else pd.Series(1.0, index=ok.index)
    parts = [(f"Sous la fourchette → {WHO} annonçait trop", float((ok.below * w).sum() / w.sum()), C["over"]),
             ("Dans la fourchette", float((ok.covered * w).sum() / w.sum()), C["neutral"]),
             (f"Au-dessus → {WHO} annonçait trop peu", float((ok.above * w).sum() / w.sum()), C["under"])]
    fig = go.Figure()
    for name, share, color in parts:
        fig.add_bar(y=[""], x=[share], name=name, orientation="h", marker=dict(color=color, line=dict(width=2, color=C["bg"])),
                    text=[pct(share)] if share >= 0.08 else None, textposition="inside", insidetextanchor="middle",
                    textfont=dict(color="#ffffff" if color != C["neutral"] else C["ink"]),
                    hovertemplate=f"{name} : {pct(share)}<extra></extra>")
    style(fig, 120, barmode="stack", bargap=0.3, title=f"Où tombe le vrai chiffre par rapport à la fourchette {OF_WHO} ?")
    fig.update_layout(legend_traceorder="normal")
    fig.update_xaxes(range=[0, 1], showgrid=False, showticklabels=False)
    show(fig)
    how_to_read(
        f"sur 100 chiffres publiés, **{parts[0][1] * 100:.0f}** étaient plus petits que le bas de la fourchette "
        f"({WHO} annonçait trop), **{parts[1][1] * 100:.0f}** tombaient dedans, et **{parts[2][1] * 100:.0f}** "
        f"étaient plus grands que le haut ({WHO} annonçait trop peu). "
        + (f"La partie bleue est bien plus grande que la rouge : quand {WHO} se trompe, c'est surtout en "
           "annonçant trop peu." if parts[2][1] > 2 * parts[0][1] else
           f"La partie rouge est bien plus grande que la bleue : quand {WHO} se trompe, c'est surtout en "
           "annonçant trop." if parts[0][1] > 2 * parts[2][1] else ""))

    # Distribution de l'erreur
    ratio = np.log10((ok.estMid / ok.units).clip(1e-2, 1e2))
    bins = np.linspace(-2, 2, 81)
    fig = go.Figure()
    for zone, color in [("sous-estimé (au-delà de ×2)", C["under"]), ("à ×2 près", C["neutral"]),
                        ("surestimé (au-delà de ×2)", C["over"])]:
        sel = ok.zone == zone
        fig.add_histogram(x=ratio[sel], xbins=dict(start=-2, end=2, size=bins[1] - bins[0]), name=zone,
                          marker=dict(color=color, line=dict(width=1, color=C["bg"])),
                          hovertemplate="%{y} chiffres<extra>" + zone + "</extra>")
    style(fig, 330, barmode="overlay", bargap=0.08,
          title="Combien de chiffres pour chaque niveau d'erreur ?")
    fig.update_xaxes(tickvals=np.log10(FACTOR_TICKS), ticktext=FACTOR_TEXT, range=[-1.3, 1.3],
                     title=f"← {WHO} annonçait trop peu      {WHO} annonçait trop →")
    fig.add_vline(x=0, line=dict(color=C["ink2"], width=1))
    show(fig)
    left = float((ok.logErr < 0).mean())
    how_to_read(
        "chaque barre compte les chiffres publiés qui ont à peu près la même erreur. Le trait central (=) est "
        "l'estimation parfaite. « ÷2 » à gauche = le milieu de la fourchette valait la moitié du vrai chiffre ; "
        "« ×2 » à droite = le double. En gris : à un facteur 2 près. "
        f"**{pct(left)}** des cas sont à gauche du trait : "
        + (f"{WHO} annonce plus souvent trop peu que trop." if left > 0.55 else
           f"{WHO} annonce plus souvent trop que trop peu." if left < 0.45 else
           f"{WHO} se trompe à peu près autant dans les deux sens."))

    with st.expander("Pourquoi deux questions différentes (le centre et la fourchette) ?"):
        st.markdown(
            "- **Le centre est-il juste ?** → erreur typique, parts à ×1,5 et ×2, tendance. On compare le *milieu* "
            "de la fourchette au vrai chiffre.\n"
            "- **La fourchette est-elle honnête ?** → « dans la fourchette ». Une fourchette large est moins "
            "précise, mais elle contient plus souvent le vrai chiffre. Une fourchette étroite qui se trompe une "
            "fois sur deux donne une fausse impression de certitude.\n\n"
            "Un bon modèle a les deux : un centre proche du vrai chiffre, et une fourchette qui le contient "
            "presque toujours.")

# ─── 2. Segments ─────────────────────────────────────────────────────────────

with tab_segments:
    st.markdown("On découpe les chiffres publiés en **groupes** et on recalcule les mêmes notes dans chaque groupe. "
                f"Ça montre **où** {WHO} est fiable et où il ne l'est pas.")
    label = st.selectbox("Découper par", list(SEGMENTS))
    by, seg_help = SEGMENTS[label]
    if by == "source":  # seulement les sources présentes dans les chiffres filtrés
        seg_help = "D'où vient le chiffre publié. " + " ; ".join(
            f"**{k}** = {v}" for k, v in SOURCE_HELP.items() if k in set(ok.source)) + "."
    st.caption(seg_help)
    data = ok
    t = segment_table(data, by, per_game=per_game, min_n=5)
    if t.empty:
        st.info("Pas assez de chiffres (5 minimum par groupe) avec ces filtres.")
    else:
        t[by] = t[by].map(lambda v: PLATFORM_LABELS.get(v, str(v)))
        t = t.iloc[::-1]  # premier groupe en haut des barres horizontales
        worst, best = t.loc[t.facteur_median.idxmax()], t.loc[t.facteur_median.idxmin()]
        st.markdown(f"{WHO_CAP} se trompe le plus pour **{worst[by]}** (erreur typique ×{fr(worst.facteur_median)}, "
                    f"sur {worst.n} chiffres) et le moins pour **{best[by]}** (×{fr(best.facteur_median)}, "
                    f"sur {best.n} chiffres).")
        show(three_panel(t, by))
        how_to_read(
            f"une ligne par groupe, trois colonnes. **Gauche** : de combien {WHO} se trompe d'habitude (la barre part "
            "de ×1 = parfait ; plus elle est longue, pire c'est). **Milieu** : part des cas où le vrai chiffre est "
            f"dans la fourchette (plus long = mieux). **Droite** : vers où {WHO} penche. Une barre bleue vers la "
            "gauche = il annonce trop peu ; rouge vers la droite = trop. Groupes de moins de 5 chiffres masqués.")
        shown = t.iloc[::-1][[by, "n", "jeux", "facteur_median", "part_x1_5", "part_x2", "couverture", "biais"]].copy()
        shown[["part_x1_5", "part_x2", "couverture"]] *= 100
        shown["biais"] = (shown.biais - 1) * 100
        st.dataframe(
            shown, hide_index=True, width="stretch",
            column_config={
                by: label,
                "n": st.column_config.NumberColumn("chiffres", help=HELP["n"]),
                "jeux": st.column_config.NumberColumn("jeux", help=HELP["jeux"]),
                "facteur_median": st.column_config.NumberColumn("erreur typique", format="×%.2f", help=HELP["erreur"]),
                "part_x1_5": st.column_config.NumberColumn("à moins de ×1,5", format="%.0f %%", help=HELP["x15"]),
                "part_x2": st.column_config.NumberColumn("à moins de ×2", format="%.0f %%", help=HELP["x2"]),
                "couverture": st.column_config.NumberColumn("dans la fourchette", format="%.0f %%",
                                                            help=HELP["couverture"]),
                "biais": st.column_config.NumberColumn("tendance", format="%+.0f %%", help=HELP["biais"]),
            })

# ─── 3. Estimé vs réel ───────────────────────────────────────────────────────

with tab_scatter:
    st.markdown("Chaque point est **un chiffre publié**. On le place selon le vrai chiffre (à l'horizontale) et ce que "
                f"{WHO} annonçait ce jour-là (à la verticale). Survolez un point pour voir le jeu.")
    fig = go.Figure()
    for zone, color in [("sous-estimé (au-delà de ×2)", C["under"]), ("à ×2 près", C["neutral"]),
                        ("surestimé (au-delà de ×2)", C["over"])]:
        d = ok[ok.zone == zone]
        fig.add_scatter(
            x=d.units, y=d.estMid, mode="markers", name=zone,
            marker=dict(color=color, size=7, opacity=0.7, line=dict(width=0)),
            customdata=np.stack([d.gameName, d.source, d.reportedAt.dt.strftime("%d/%m/%Y"),
                                 d.estLow.map(units), d.estHigh.map(units), d.units.map(units),
                                 d.factor.map(lambda v: fr(v, 1))], axis=-1),
            hovertemplate="<b>%{customdata[0]}</b><br>%{customdata[1]} · %{customdata[2]}<br>"
                          "vrai : %{customdata[5]}<br>fourchette : %{customdata[3]} – %{customdata[4]}"
                          "<br>erreur ×%{customdata[6]}<extra></extra>")
    lim = [1e3, 3e8]
    fig.add_scatter(x=lim, y=lim, mode="lines", line=dict(color=C["ink2"], width=1.5), hoverinfo="skip", showlegend=False)
    for k in (2, 0.5):
        fig.add_scatter(x=lim, y=[v * k for v in lim], mode="lines", line=dict(color=C["muted"], width=1, dash="dot"),
                        hoverinfo="skip", showlegend=False)
    style(fig, 620)
    fig.update_xaxes(type="log", range=[3, 8.5], tickvals=UNIT_TICKS, ticktext=UNIT_TEXT, title="vrai chiffre (publié)")
    fig.update_yaxes(type="log", range=[3, 8.5], tickvals=UNIT_TICKS, ticktext=UNIT_TEXT,
                     title=f"ce que {WHO} annonçait (milieu)", scaleanchor="x", scaleratio=1)
    fig.update_layout(margin=dict(l=72, b=56))
    show(fig)
    how_to_read(
        f"**sur la diagonale = parfait.** Un point **au-dessus** = {WHO} annonçait plus que la réalité ; "
        "**en dessous** = moins. Entre les deux lignes pointillées = à un facteur 2 près (gris). Attention, les "
        "axes sont en échelle « ×10 » : chaque graduation vaut 10 fois la précédente (1 k, 10 k, 100 k, 1 M…), "
        "pour qu'un petit jeu et un énorme succès tiennent sur le même graphique.")

    st.subheader("Les plus grosses erreurs")
    st.markdown("Souvent un problème de **données** plutôt que de modèle : chiffre rattaché au mauvais jeu ou à la "
                "mauvaise édition, faute de frappe, annonce le jour de la sortie (on n'a alors que quelques "
                "heures de reviews)… Ouvrez la source pour vérifier. **Cliquez une ligne** pour ouvrir le jeu dans "
                "« Un jeu à la loupe ».")
    worst = ok.sort_values("factor", ascending=False).head(100)
    table = pd.DataFrame({
        "jeu": worst.gameName, "source": worst.source,
        "date": worst.reportedAt.dt.date, "vrai": worst.units, "estimé bas": worst.estLow, "estimé haut": worst.estHigh,
        "erreur": worst.factor, "sens": np.where(worst.logErr < 0, "trop bas", "trop haut"), "lien": worst.sourceUrl,
    })
    picked = st.dataframe(
        table, hide_index=True, width="stretch", height=380, on_select="rerun", selection_mode="single-row",
        column_config={
            "date": st.column_config.DateColumn("date", format="DD/MM/YYYY", help="Date du chiffre publié."),
            "vrai": st.column_config.NumberColumn(format="localized", help="Le chiffre publié."),
            "estimé bas": st.column_config.NumberColumn(format="localized", help=f"Bas de la fourchette {OF_WHO} ce jour-là."),
            "estimé haut": st.column_config.NumberColumn(format="localized", help=f"Haut de la fourchette {OF_WHO} ce jour-là."),
            "erreur": st.column_config.NumberColumn(format="×%.1f", help=HELP["erreur"]),
            "sens": st.column_config.TextColumn(help="Le milieu de la fourchette était-il trop bas ou trop haut ?"),
            "lien": st.column_config.LinkColumn(display_text="source", help="Page d'où vient le chiffre publié."),
        })
    if picked.selection.rows:
        st.session_state["game_id"] = worst.iloc[picked.selection.rows[0]].gameId
        st.success(f"« {worst.iloc[picked.selection.rows[0]].gameName} » est prêt dans l'onglet « Un jeu à la loupe ».")

# ─── 4. Un jeu à la loupe ────────────────────────────────────────────────────

@st.cache_data(show_spinner=False)
def timeline(game_id: str, platform: str, with_holdout: bool, end: str) -> pd.DataFrame:
    g = games.loc[game_id]
    rel = est.pc_release.get(game_id) or (to_us(g.releaseDate) if pd.notna(g.releaseDate) else None)
    start = pd.Timestamp(rel, unit="us", tz="UTC") if rel else site_rows[site_rows.gameId == game_id].reportedAt.min()
    start = max(start.normalize(), pd.Timestamp("2010-01-01", tz="UTC"))
    dates = pd.date_range(start, pd.Timestamp(end, tz="UTC"), periods=120) if start < pd.Timestamp(end, tz="UTC") else []
    out = []
    for d in dates:
        e = est.estimate(game_id, to_us(d), holdout_game_id=game_id if with_holdout else None)
        r = e.for_platform(platform) if e else None
        if r and r[1] > 0:
            out.append({"date": d, "low": r[0], "high": r[1]})
    return pd.DataFrame(out)


# Couleurs des modèles appris : emplacements catégoriels 3, 7 et 5 de la palette
# (le bleu reste au modèle actuel, l'orange aux chiffres publiés).
LEARNED_COLORS = {
    PROD_MODEL: ("#2e3a4d", "#c9d1de"),
    "Moyenne forêt + linéaire": ("#6250d6", "#9085e9"),
    "Forêt + voisins": ("#008300", "#008300"),
    "Forêt aléatoire": ("#1baf7a", "#199e70"),
    "Linéaire + interactions": ("#e87ba4", "#d55181"),
    "Gradient boosting": ("#eda100", "#c98500"),
}


def learned_color(name: str) -> str:
    light, dark = LEARNED_COLORS[name]
    return dark if C is THEMES["dark"] else light


@st.cache_resource(show_spinner="Entraînement des modèles appris (quelques secondes, une seule fois)…")
def playable(name: str):
    return train_playable(load_bench(), name)


@st.cache_resource(show_spinner=False)
def feature_builder():
    return FeatureBuilder(snap, est, [c for c in load_bench().table.columns if c.startswith("tag_")])


PROD_BASE = "Moyenne forêt + linéaire"  # le modèle suivi par la règle en prod


def prod_curve(game_id: str, X: pd.DataFrame, honest: bool) -> pd.DataFrame:
    """La règle en prod sur la frise, comme le backend : rien avant J+3, puis jamais en baisse."""
    base = playable(PROD_BASE)
    g = games.loc[game_id]
    rel = est.pc_release.get(game_id) or (to_us(g.releaseDate) if pd.notna(g.releaseDate) else None)
    t = np.array([to_us(pd.Timestamp(d)) for d in X.date])
    log = np.log(base.predict(game_id, X, honest).point.to_numpy())
    if rel is None:
        log[:] = np.nan
    else:
        fb = feature_builder()
        grid = [(tt, r) for tt in never_down_dates(rel, int(t.max())) if (r := fb.row(game_id, tt))
                and r["log_reviews"] >= math.log1p(NEVER_DOWN_MIN_REVIEWS)]
        if grid:
            gt = np.array([tt for tt, _ in grid])
            gp = np.log(base.predict(game_id, pd.DataFrame([r for _, r in grid]), honest).point.to_numpy())
            for i, ti in enumerate(t):
                past = gp[gt <= ti]
                if len(past):
                    log[i] = max(log[i], past.max())
        log[t - rel < NEVER_DOWN_MIN_DAYS * US_PER_DAY] = np.nan
    point = np.exp(log)
    k = math.exp(base.log_halfwidth)
    return pd.DataFrame({"point": point, "low": point / k, "high": point * k}, index=X.index)


@st.cache_data(show_spinner=False)
def learned_at(game_id: str, dates: tuple[str, ...], names: tuple[str, ...], honest: bool) -> pd.DataFrame:
    """Estimation de chaque modèle appris pour ce jeu, à chaque date demandée."""
    fb = feature_builder()
    feats = [{"date": pd.Timestamp(d), **r} for d in dates if (r := fb.row(game_id, to_us(pd.Timestamp(d))))]
    if not feats:
        return pd.DataFrame(columns=["date", "model", "point", "low", "high"])
    X = pd.DataFrame(feats)
    out = [(prod_curve(game_id, X, honest) if n == PROD_MODEL else playable(n).predict(game_id, X, honest))
           .assign(date=X.date.to_numpy(), model=n) for n in names]
    return pd.concat(out, ignore_index=True).dropna(subset=["point"])


def ranges_chart(df: pd.DataFrame, actual: list[float]) -> go.Figure:
    """Une fourchette par ligne (bas → haut, point = milieu), traits orange = chiffres publiés."""
    fig = go.Figure()
    for r in df.itertuples():
        fig.add_scatter(x=[max(r.low, 1e3), max(r.high, 1e3)], y=[r.modèle, r.modèle], mode="lines",
                        line=dict(color=r.color, width=8), showlegend=False, hoverinfo="skip")
        fig.add_scatter(x=[r.point], y=[r.modèle], mode="markers", showlegend=False,
                        marker=dict(size=14, color=C["bg"], line=dict(width=3, color=r.color)),
                        customdata=[[units(r.low), units(r.point), units(r.high)]],
                        hovertemplate="%{y}<br>%{customdata[0]} – %{customdata[2]}<br>milieu %{customdata[1]}"
                                      "<extra></extra>")
    for a in actual:
        fig.add_vline(x=a, line=dict(color=C["declared"], width=2),
                      annotation=dict(text=f"publié : {units(a)}", font_color=C["ink"], yanchor="bottom"),
                      annotation_position="top")
    style(fig, 50 + 46 * len(df))
    fig.update_xaxes(type="log", tickvals=UNIT_TICKS + [3e5, 3e6, 3e7], ticktext=UNIT_TEXT + ["300 k", "3 M", "30 M"])
    fig.update_yaxes(autorange="reversed", categoryorder="array", categoryarray=list(df.modèle))
    fig.update_layout(margin=dict(t=40))
    return fig


with tab_game:
    st.markdown("Choisissez un jeu : on rejoue l'estimation **à chaque date**, celle du site et celle des modèles "
                "appris, puis on décortique le calcul du site **étape par étape** pour une date précise.")
    counts = site_rows[site_rows.hasEstimate].groupby("gameId").size().sort_values(ascending=False)
    pool = st.radio(
        "Jeux proposés", ["Avec chiffres publiés", "Tout le catalogue"], horizontal=True,
        help="« Tout le catalogue » permet de voir ce que diraient les modèles sur n'importe quel jeu, même sans "
             "chiffre publié pour vérifier.")
    if pool == "Avec chiffres publiés":
        options = list(counts.index)
    else:
        catalog = snap.games[snap.games.deletedAt.isna() & ~snap.games.isFree].sort_values("name")
        options = list(catalog.id)
    default_id = st.session_state.get("game_id") or next(
        (gid for gid in options if games.loc[gid, "name"] == "Hollow Knight"), options[0])
    game_id = st.selectbox(
        "Jeu", options, index=options.index(default_id) if default_id in options else 0,
        format_func=lambda gid: games.loc[gid, "name"] + (f"  ({counts[gid]} chiffres publiés)" if gid in counts.index
                                                          else ""),
        help="Tapez pour chercher.")
    g = games.loc[game_id]
    platform = "GLOBAL"  # on n'évalue que le total
    p_rows = site_rows[site_rows.gameId == game_id].sort_values("reportedAt")

    bench_ready = load_bench() is not None
    if bench_ready:
        names = st.multiselect(
            "Modèles appris à comparer au site", [PROD_MODEL] + LEARNED_MODELS, default=[PROD_MODEL, PROD_BASE],
            help="Par défaut, le modèle en ligne et le modèle qu'il suit. « En prod » = la moyenne forêt + "
                 f"linéaire, rien avant {NEVER_DOWN_MIN_DAYS} jours après la sortie PC, puis jamais en baisse (le "
                 f"plus haut chiffre déjà donné aux dates où le jeu avait au moins {NEVER_DOWN_MIN_REVIEWS:,} "
                 "reviews Steam). Le site ne l'affiche que pour les jeux qu'il estime déjà à 300 000 ventes et plus.")
        st.caption(
            ("**Mode honnête** (barre latérale) : chaque modèle appris prédit ce jeu **sans l'avoir vu** à "
             "l'entraînement, comme un jeu nouveau. Passez en « Avec fuite » pour voir le modèle entraîné sur tous "
             "les jeux, celui-ci compris : il colle mieux aux chiffres publiés de ce jeu… parce qu'il les a déjà vus.")
            if holdout else
            ("**Mode avec fuite** : les modèles appris ont été entraînés sur tous les jeux, celui-ci compris. Ils "
             "ont déjà vu ses chiffres publiés : leur précision ici est trompeuse. Repassez en « Honnête » pour la "
             "vraie situation d'un jeu nouveau."))
    else:
        names = []
        st.info("Les modèles appris ne sont pas encore entraînés pour ce snapshot : lancez `python bench.py`.")

    tl = timeline(game_id, platform, holdout, snap.path.name)
    if tl.empty and p_rows.empty:
        st.warning("Aucune estimation possible pour ce jeu : pas de reviews ni de notes dans les données.")
    dates = sorted({d.date() for d in p_rows.reportedAt}) + [pd.Timestamp(snap.path.name).date()]
    chosen = st.select_slider("Date à décortiquer", options=dates,
                              value=dates[-2] if len(dates) > 1 else dates[-1],
                              format_func=lambda d: d.strftime("%d/%m/%Y") + (" (aujourd'hui)" if d == dates[-1] else ""),
                              help="Les dates proposées sont celles des chiffres publiés pour ce jeu, plus aujourd'hui.")
    lt = (learned_at(game_id, tuple(d.isoformat() for d in tl.date), tuple(names), holdout)
          if names and not tl.empty else pd.DataFrame(columns=["date", "model", "point", "low", "high"]))

    fig = go.Figure()
    if not tl.empty:
        fig.add_scatter(x=tl.date, y=tl.high, mode="lines", line=dict(color=C["model"], width=0), showlegend=False,
                        hoverinfo="skip")
        fig.add_scatter(x=tl.date, y=tl.low.clip(lower=tl.high.min() / 50), mode="lines", fill="tonexty",
                        line=dict(color=C["model"], width=0), fillcolor=rgba(C["model"], 0.25),
                        name="Site actuel : fourchette",
                        customdata=np.stack([tl.low.map(units), tl.high.map(units)], axis=-1),
                        hovertemplate="site : %{customdata[0]} – %{customdata[1]}<extra></extra>")
        fig.add_scatter(x=tl.date, y=(tl.low + tl.high) / 2, mode="lines", line=dict(color=C["model"], width=2),
                        name="Site actuel : milieu", hoverinfo="skip")
    for n in names:
        d = lt[lt.model == n]
        fig.add_scatter(x=d.date, y=d.point, mode="lines", name=n, line=dict(color=learned_color(n), width=2.5),
                        customdata=np.stack([d.point.map(units), d.low.map(units), d.high.map(units)], axis=-1),
                        hovertemplate=n + " : %{customdata[0]} (%{customdata[1]} – %{customdata[2]})<extra></extra>")
    fig.add_scatter(x=p_rows.reportedAt, y=p_rows.units, mode="markers", name="Chiffres publiés",
                    marker=dict(color=C["declared"], size=10, line=dict(width=2, color=C["bg"])),
                    customdata=np.stack([p_rows.source, p_rows.units.map(units)], axis=-1),
                    hovertemplate="publié : %{customdata[1]} (%{customdata[0]})<extra></extra>")
    fig.add_vline(x=chosen.isoformat(), line=dict(color=C["ink2"], width=1))
    style(fig, 400, hovermode="x unified", title=f"{g['name']} : ventes totales estimées au fil du temps")
    fig.update_yaxes(type="log", tickvals=UNIT_TICKS, ticktext=UNIT_TEXT)
    show(fig)
    how_to_read(
        "la **bande bleue** est la fourchette que le site aurait affichée à chaque date, avec les données connues à "
        "ce moment-là, et la **ligne bleue** son milieu. "
        + ("Chaque **ligne de couleur** est l'estimation d'un modèle appris à la même date (survolez pour voir sa "
           "fourchette). " if names else "")
        + "Les **points orange** sont les vrais chiffres publiés : plus une ligne passe près d'eux, mieux le modèle "
        "devinait. Le trait vertical marque la date décortiquée ci-dessous. Axe vertical en échelle ×10.")

    if names:
        as_of_learned = (pd.Timestamp(chosen, tz="UTC") + pd.Timedelta(hours=23, minutes=59)).isoformat()
        lc = learned_at(game_id, (as_of_learned,), tuple(names), holdout)
        e_site = est.estimate(game_id, to_us(pd.Timestamp(as_of_learned)), holdout_game_id=game_id if holdout else None)
        st.subheader(f"Ce que disent les modèles le {chosen:%d/%m/%Y}")
        if lc.empty or e_site is None or e_site.total is None:
            st.info("À cette date, le site n'avait encore aucun signal pour ce jeu : aucun modèle n'estime.")
        else:
            cmp_rows = [{"modèle": "Site actuel", "low": e_site.total[0], "point": sum(e_site.total) / 2,
                         "high": e_site.total[1], "color": C["model"]}]
            cmp_rows += [{"modèle": r.model, "low": r.low, "point": r.point, "high": r.high,
                          "color": learned_color(r.model)} for r in lc.itertuples()]
            cmp = pd.DataFrame(cmp_rows)
            declared_now = sorted(p_rows[p_rows.reportedAt.dt.date == chosen].units.unique())
            show(ranges_chart(cmp, declared_now))
            table = cmp[["modèle", "low", "point", "high"]].copy()
            if declared_now:
                truth = declared_now[-1]
                table["erreur"] = np.maximum(table.point / truth, truth / table.point)
                table["dans la fourchette ?"] = np.where((table.low <= truth) & (truth <= table.high), "oui", "non")
                table["sens"] = np.where(table.point < truth, "trop bas", "trop haut")
            st.dataframe(table, hide_index=True, width="stretch", column_config={
                "low": st.column_config.NumberColumn("bas", format="localized"),
                "point": st.column_config.NumberColumn("milieu", format="localized"),
                "high": st.column_config.NumberColumn("haut", format="localized"),
                "erreur": st.column_config.NumberColumn("erreur", format="×%.2f", help=HELP["erreur"]),
            })
            if declared_now:
                best_row = table.loc[table.erreur.idxmin()]
                how_to_read(
                    f"chaque ligne est une fourchette (rond = milieu). Le trait orange est le chiffre publié ce "
                    f"jour-là : **{units(declared_now[-1])}**. Ici, le plus proche est **{best_row.modèle}** "
                    f"(erreur ×{fr(best_row.erreur)}). Un seul jeu ne dit pas quel modèle est le meilleur en "
                    "général (c'est le rôle de l'onglet « Comparer les modèles ») ; il montre comment chacun "
                    "raisonne.")
            else:
                how_to_read(
                    "chaque ligne est une fourchette (rond = milieu). Pas de chiffre publié ce jour-là pour "
                    "vérifier : c'est exactement la situation du site pour la plupart des jeux. Quand les modèles "
                    "sont d'accord entre eux, l'estimation est plus sûre ; quand ils divergent, méfiance.")

    # Décomposition à la date choisie
    as_of = to_us(pd.Timestamp(chosen, tz="UTC") + pd.Timedelta(hours=23, minutes=59))
    e = est.estimate(game_id, as_of, holdout_game_id=game_id if holdout else None)
    st.subheader(f"Comment le site arrive à sa fourchette le {chosen:%d/%m/%Y}")
    if e is None or not e.aggregates or e.profile is None:
        st.info("Aucun signal disponible à cette date : le site ne pouvait rien estimer.")
    else:
        p = e.profile
        match = est.matcher.find_neighbours(game_id, holdout_game_id=game_id if holdout else None)
        st.markdown(
            f"**Étape 1 — Trouver des jeux qui ressemblent.** On compare {g['name']} à {len(est.matcher.corpus)} "
            "jeux dont on connaît les ventes, sur 13 critères (genre et tags Steam, éditeur, studio, époque, "
            "temps de jeu, nombre de DLC…). On garde les 15 plus proches : leurs ratios vont servir de "
            "multiplicateurs." + ("" if holdout else " ⚠️ Variante avec fuite : le jeu peut être son propre "
                                                      "voisin, ce qui l'avantage."))
        wsum = sum(w for _, _, w in match.anchors) or 1
        neigh = pd.DataFrame([{
            "jeu voisin": games.loc[gid, "name"] if gid in games.index else gid,
            "ressemblance": sim, "poids dans la moyenne": w / wsum * 100,
            "ventes par review (PC)": fr(anchors_by_id[gid].reviews_to_units, 1)
            if anchors_by_id[gid].reviews_to_units else "— (non mesuré)",
            "ratio pic de joueurs → semaine 1": fr(anchors_by_id[gid].peak_ccu_ratio, 1)
            if anchors_by_id[gid].peak_ccu_ratio else "— (non mesuré)",
        } for gid, sim, w in match.anchors])
        st.dataframe(neigh, hide_index=True, width="stretch", height=250, column_config={
            "ressemblance": st.column_config.ProgressColumn(
                format="percent", min_value=0, max_value=1,
                help="Score de ressemblance sur 13 critères pondérés. 100 % = identique sur tous les critères."),
            "poids dans la moyenne": st.column_config.NumberColumn(
                format="%.0f %%", help="Part de ce voisin dans la moyenne. Les plus ressemblants pèsent beaucoup "
                                       "plus (poids = ressemblance² × qualité des données du voisin)."),
            "ventes par review (PC)": st.column_config.TextColumn(
                help="Combien de copies PC ce voisin a vendu par review Steam. « non mesuré » = on ne connaît pas "
                     "ses ventes PC seules ; il compte alors pour les autres ratios."),
            "ratio pic de joueurs → semaine 1": st.column_config.TextColumn(
                help="Ventes de la 1re semaine ÷ pic de joueurs simultanés au lancement, mesuré sur ce voisin."),
        })

        st.markdown("**Étape 2 — En déduire les ratios de ce jeu** (moyenne pondérée des voisins).")
        c1, c2 = st.columns(2)
        c3, c4 = st.columns(2)
        if p.pc_boxleiter_low:
            c1.metric("Ventes par review Steam", f"{fr(p.pc_boxleiter_low, 1)} – {fr(p.pc_boxleiter_high, 1)}",
                      help="Moyenne des voisins, ±25 % pour faire une fourchette.")
            c1.caption(f"1 review Steam ≈ {fr(p.pc_boxleiter_low, 0)} à {fr(p.pc_boxleiter_high, 0)} copies vendues sur PC.")
        else:
            c1.metric("Ventes par review Steam", "25 – 65", help="Aucun voisin mesuré : valeur par défaut du site.")
            c1.caption("Valeur par défaut : les voisins n'avaient pas ce ratio.")
        c2.metric("Pic de joueurs → 1re semaine", f"×{fr(p.peak_ccu_to_week_one_low, 1)} – ×{fr(p.peak_ccu_to_week_one_high, 1)}",
                  help="Moyenne des voisins, ±30 %.")
        c2.caption("Ventes de la 1re semaine ≈ pic de joueurs simultanés au lancement × ce ratio.")
        c3.metric("An 1 ÷ semaine 1", f"×{fr(p.m1, 1)}", help="Tiré de la courbe de vie des voisins.")
        c3.caption(f"En un an, le jeu vend {fr(p.m1, 1)} fois ses ventes de la 1re semaine (puis ça continue, plus "
                   "lentement).")
        c4.metric("Répartition PC · PS · Xbox",
                  f"{p.pc_share * 100:.0f} · {p.playstation_share * 100:.0f} · {p.xbox_share * 100:.0f} %",
                  help="Répartition typique des ventes chez les voisins. Le reste = Switch, que le site n'estime pas.")
        c4.caption(f"Sur 100 ventes : {p.pc_share * 100:.0f} sur PC, {p.playstation_share * 100:.0f} sur PlayStation, "
                   f"{p.xbox_share * 100:.0f} sur Xbox. Sert à deviner les consoles à partir du PC.")

        st.markdown("**Étape 3 — Calculer avec chaque méthode, faire la moyenne par plateforme, additionner.**")
        lines = []
        for m in e.methods:
            d = m.detail
            if "signal" in d:
                what = {"PC": "reviews Steam", "PLAYSTATION": "notes PS Store", "XBOX": "notes Xbox Store"}[m.platform]
                calc = f"{thousands(d['signal'])} {what} × {fr(d['multiplierLow'], 1)} à {fr(d['multiplierHigh'], 1)}"
            elif "launchPeakCcu" in d:
                calc = (f"pic de {thousands(d['launchPeakCcu'])} joueurs × {fr(p.peak_ccu_to_week_one_low, 1)} à "
                        f"{fr(p.peak_ccu_to_week_one_high, 1)} = ventes semaine 1, puis × {fr(d['projection'], 2)} "
                        f"pour aller jusqu'au jour {d['ageDays']:.0f}")
            else:
                calc = f"estimation de la plateforme source × {fr(d['ratio'], 2)} (rapport des parts de ventes)"
            lines.append({"étape": f"{PLATFORM_LABELS[m.platform]} · {METHOD_LABELS.get(m.method, m.method)}",
                          "low": m.low, "high": m.high, "niveau": 0, "calcul": calc})
        for plat, a in e.aggregates.items():
            dis = a.detail.get("disagreement", 0)
            lines.append({"étape": f"{PLATFORM_LABELS[plat]} · moyenne des méthodes", "low": a.low, "high": a.high,
                          "niveau": 1,
                          "calcul": (f"les méthodes s'écartent de {pct(dis)} → fourchette élargie de ±{pct(dis / 2)}"
                                     if dis else "une seule méthode : recopiée telle quelle")})
        lines.append({"étape": "TOTAL affiché sur le site", "low": e.total[0], "high": e.total[1], "niveau": 2,
                      "calcul": "somme PC + PlayStation + Xbox"})
        bd = pd.DataFrame(lines)

        fig = go.Figure()
        names = ["Une méthode de calcul", "Moyenne par plateforme", "Total affiché"]
        for level in (0, 1, 2):
            d = bd[bd.niveau == level]
            xs, ys = [], []
            for r in d.itertuples():
                xs += [max(r.low, 1e3), max(r.high, 1e3), None]
                ys += [r.étape, r.étape, None]
            fig.add_scatter(x=xs, y=ys, mode="lines+markers", name=names[level],
                            line=dict(color=C["ramp"][level], width=7), marker=dict(size=9, color=C["ramp"][level]),
                            hoverinfo="skip")
            fig.add_scatter(x=np.sqrt(d.low.clip(lower=1e3) * d.high), y=d.étape, mode="markers", showlegend=False,
                            marker=dict(size=24, opacity=0), customdata=np.stack([d.low.map(units), d.high.map(units), d.calcul], axis=-1),
                            hovertemplate="%{y}<br>%{customdata[0]} – %{customdata[1]}<br>%{customdata[2]}<extra></extra>")
        declared = p_rows[p_rows.reportedAt.dt.date == chosen]
        for r in declared.drop_duplicates("units").itertuples():
            fig.add_vline(x=r.units, line=dict(color=C["declared"], width=2),
                          annotation=dict(text=f"publié : {units(r.units)}", font_color=C["ink"], yanchor="bottom"),
                          annotation_position="top")
        style(fig, 140 + 40 * len(bd))
        fig.update_xaxes(type="log", tickvals=UNIT_TICKS, ticktext=UNIT_TEXT)
        fig.update_yaxes(autorange="reversed", categoryorder="array", categoryarray=list(bd.étape))
        fig.update_layout(margin=dict(t=60))
        show(fig)
        how_to_read(
            "chaque ligne horizontale est une fourchette, de son bas (gauche) à son haut (droite). On lit de haut "
            "en bas : d'abord **chaque méthode de calcul**, puis **la moyenne par plateforme**, et en dernier le "
            "**total affiché sur le site** (la légende donne la teinte de chaque niveau). Le **trait orange** = le "
            "chiffre publié à cette date (s'il y en a un). Si "
            "les méthodes d'une plateforme ne sont pas d'accord, sa moyenne est volontairement élargie : c'est pour "
            "ça qu'elle peut être plus large que chaque méthode. Le détail de chaque calcul est dans le tableau.")
        st.dataframe(bd.drop(columns="niveau"), hide_index=True, width="stretch", column_config={
            "low": st.column_config.NumberColumn("bas", format="localized", help="Bas de la fourchette."),
            "high": st.column_config.NumberColumn("haut", format="localized", help="Haut de la fourchette."),
            "calcul": st.column_config.TextColumn(help="Le calcul fait, avec les vrais nombres de ce jeu.")})

        rng = e.for_platform(platform)
        for r in declared.drop_duplicates("units").itertuples():
            mid = (rng[0] + rng[1]) / 2
            f = max(mid / r.units, r.units / mid)
            where = ("dans la fourchette" if rng[0] <= r.units <= rng[1]
                     else "au-dessus de la fourchette" if r.units > rng[1] else "sous la fourchette")
            st.markdown(f"**Étape 4 — Verdict.** Chiffre publié : **{units(r.units)}** ({r.source}). Il tombe "
                        f"**{where}** [{units(rng[0])} – {units(rng[1])}]. Le milieu ({units(mid)}) est "
                        f"{'trop bas' if mid < r.units else 'trop haut'} d'un facteur **×{fr(f)}**.")

# ─── 6. Comparer les modèles ─────────────────────────────────────────────────

# Du plus simple au plus lourd/risqué à mettre en prod (sert à départager les égalités). « Forêt + voisins »
# passe après la moyenne : il s'appuie encore plus sur la similarité du site (à re-challenger) et sur une
# table d'erreurs des jeux connus à maintenir.
COMPLEXITY = {"Linéaire (sans les voisins)": 1, "Linéaire (toutes les infos)": 1, "Linéaire + interactions": 2,
              "Gradient boosting": 3, "Forêt aléatoire": 4, "Moyenne forêt + linéaire": 5, PROD_MODEL: 5.5,
              "Forêt + voisins": 6}
NOT_CANDIDATES = {"Modèle actuel", "Actuel recalibré"}


def render_checks(b) -> None:
    """Contrôles au-delà de l'erreur moyenne (checks.py)."""
    c = b.checks
    st.subheader("Au lancement : l'erreur selon l'âge du jeu au chiffre")
    st.dataframe(c["age"], width="stretch", hide_index=True)
    how_to_read(
        "chaque case donne l'erreur typique, puis entre parenthèses le **biais** : ×0,80 veut dire 20 % trop bas en "
        "médiane. Entre parenthèses dans les titres, le nombre de chiffres. Les chiffres publiés 0 à 3 jours après "
        "la sortie sont les plus durs, et beaucoup sont faux (voir plus bas). La règle en prod laisse ces 3 premiers "
        "jours au site : d'où son erreur sur cette colonne.")

    st.subheader("La courbe d'un jeu baisse-t-elle ?")
    st.markdown(
        "Des ventes **cumulées** ne baissent jamais. On fait prédire chaque jeu à une série de dates (J+1, J+3, … "
        f"puis tous les 180 jours, {thousands(c['timeline_dates'])} dates en tout), par un modèle qui n'a jamais vu "
        "ce jeu, et on compte les baisses de plus de 5 % d'une date à la suivante.")
    st.dataframe(c["drops"], width="stretch", hide_index=True, column_config={
        "modèle": "modèle",
        "pas_en_baisse": st.column_config.NumberColumn("dates en baisse", format="percent"),
        "jeux_avec_baisse": st.column_config.NumberColumn("jeux avec au moins une baisse", format="percent"),
        "pire_baisse": st.column_config.NumberColumn("pire baisse", format="×%.2f")})
    how_to_read(
        "les modèles appris baissent plus souvent que le site, à cause des informations « du moment » (joueurs "
        "connectés, reviews récentes). La règle en prod ne baisse plus une fois le modèle affiché ; les baisses "
        "restantes sont au passage entre le chiffre du site (avant J+3, ou trop peu de reviews) et le modèle.")

    st.subheader("Tout le catalogue, pas seulement les jeux qui publient leurs ventes")
    st.dataframe(c["catalog"], width="stretch", hide_index=True)
    how_to_read(
        "chaque case est la médiane de **modèle ÷ site actuel** pour les jeux du catalogue d'une taille donnée "
        "(nombre de reviews Steam). Les modèles appris n'ont vu que des jeux qui publient leurs ventes, presque "
        "tous des succès : sur les petits jeux, ils donnent 5 à 35 fois le site, ce qui est absurde. C'est pour ça "
        "que le site n'affiche le modèle que dans la « zone affichée » (site ≥ 300 000 ventes et ≥ 1 000 reviews).")

    st.subheader("Chiffres « de lancement » à vérifier dans la base")
    suspects = c["launch_suspects"]
    if suspects.empty:
        st.success("Aucun chiffre de lancement suspect.")
    else:
        st.dataframe(suspects, width="stretch", hide_index=True)
        how_to_read(
            "chiffres publiés 3 jours ou moins après la sortie PC, plus de 3 fois au-dessus de **tous** les "
            "modèles. Le plus souvent : un chiffre daté du jour de sortie mais publié bien plus tard, le chiffre "
            "de toute une série rattaché à une réédition, une date de première sortie fausse, ou des joueurs d'un "
            "free-to-play comptés comme des ventes.")


def render_models(b) -> None:
    n_games = b.table.gameId.nunique()
    has_clean = getattr(b, "cv_scores_clean", None) is not None
    n_suspect = int(b.table.suspect.sum()) if "suspect" in b.table.columns else 0
    st.markdown(
        "Ici, on ne se contente plus de mesurer la formule du site : on **entraîne des modèles** (du machine "
        "learning) sur les chiffres publiés, et on vérifie s'ils devinent mieux. Le piège classique est de "
        "tester un modèle sur les jeux qui ont servi à l'entraîner : il paraît génial alors qu'il a juste "
        "« appris par cœur ». Pour l'éviter, les règles sont fixées à l'avance :")
    st.markdown(
        f"1. **Chaque jeu est deviné par un modèle qui ne l'a jamais vu.** Les {n_games} jeux sont répartis en "
        "5 groupes ; chaque groupe est prédit par un modèle entraîné sur les 4 autres, comme un nouveau jeu sur le "
        "site.\n"
        "2. **Test dans le temps** : on entraîne sur les chiffres d'avant 2025 et on prédit ceux de 2025 et après, "
        "sur des jeux jamais vus. C'est la situation réelle : prédire le présent avec le passé.\n"
        + (f"3. **{n_suspect} chiffres suspects ne servent pas à l'entraînement** ({n_suspect / len(b.table):.0%} : "
           "chiffres partiels, incohérents ou rattachés au mauvais jeu). La base n'est pas modifiée ; la liste est "
           "dans « Qualité des données ».\n" if n_suspect else "")
        + "4. **Le test final sous clé a servi le 28/10** (résultat en bas de page) : ses jeux ont rejoint les "
        "autres. Le prochain test neutre sera fait des chiffres publiés après ce snapshot.")
    use_clean = has_clean and st.radio(
        "Juger les modèles sur", ["Tous les chiffres", "Les chiffres nettoyés (sans les suspects)"], horizontal=True,
        help="Les chiffres suspects ne servent jamais à l'entraînement. Ici on choisit sur quels chiffres on NOTE "
             "les modèles. Retirer des chiffres « difficiles » améliore les scores de tous les modèles : comparez "
             "les modèles entre eux avec le même choix, pas d'un choix à l'autre.").startswith("Les chiffres nettoyés")
    st.caption("Cet onglet n'utilise pas les filtres de gauche : tous les modèles sont jugés sur exactement les "
               "mêmes chiffres (monde, réels).")

    st.subheader("Les modèles en compétition")
    for spec in b.specs:
        st.markdown(f"- **{spec.name}** : {spec.description}")

    st.subheader("Résultat : chaque jeu deviné sans l'avoir vu")
    cv = (b.cv_scores_clean if use_clean else b.cv_scores).copy()
    show(three_panel(cv.iloc[::-1].reset_index(drop=True), "modèle"))
    base = cv[cv.modèle == "Modèle actuel"].iloc[0]
    best = cv.loc[cv.facteur_median.idxmin()]
    halfwidth = b.choices[b.choices.modèle == best.modèle]["demi-largeur"].mean()
    how_to_read(
        f"une ligne par modèle. Le meilleur score est pour **{best.modèle}** : il se trompe d'un facteur "
        f"**×{fr(best.facteur_median)}** d'habitude, contre **×{fr(base.facteur_median)}** pour le modèle actuel. "
        f"**{pct(best.part_x2)}** de ses estimations sont à moins de ×2 du vrai chiffre, contre {pct(base.part_x2)}. "
        f"Sa fourchette contient le vrai chiffre **{pct(best.couverture)}** du temps, contre {pct(base.couverture)} : "
        f"elle a été calculée pour ça, et elle est plus large en échange (le milieu ÷ ou × {fr(halfwidth, 1)}).")
    shown = cv[["modèle", "facteur_median", "facteur_median_ic90", "part_x1_5", "part_x2", "couverture", "biais",
                "proba_meilleur"]].copy()
    shown[["part_x1_5", "part_x2", "couverture"]] *= 100
    shown["biais"] = (shown.biais - 1) * 100
    shown["proba_meilleur"] = shown.proba_meilleur * 100
    st.dataframe(shown, hide_index=True, width="stretch", column_config={
        "facteur_median": st.column_config.NumberColumn("erreur typique", format="×%.2f", help=HELP["erreur"]),
        "facteur_median_ic90": st.column_config.TextColumn(
            "marge d'incertitude", help="Avec d'autres jeux, l'erreur typique aurait pu varier dans cette marge "
                                        "(intervalle à 90 %, par tirages au hasard des jeux)."),
        "part_x1_5": st.column_config.NumberColumn("à moins de ×1,5", format="%.0f %%", help=HELP["x15"]),
        "part_x2": st.column_config.NumberColumn("à moins de ×2", format="%.0f %%", help=HELP["x2"]),
        "couverture": st.column_config.NumberColumn("dans la fourchette", format="%.0f %%", help=HELP["couverture"]),
        "biais": st.column_config.NumberColumn("tendance", format="%+.0f %%", help=HELP["biais"]),
        "proba_meilleur": st.column_config.NumberColumn(
            "bat l'actuel", format="%.0f %%",
            help="On refait la comparaison avec des tirages au hasard des jeux. Part des tirages où ce modèle a "
                 "une erreur typique plus basse que le modèle actuel. Au-dessus de 95 % : gain solide. Autour de "
                 "50 % : pile ou face, le modèle n'est pas vraiment meilleur."),
    })

    st.subheader("Test dans le temps : apprendre avant 2025, prédire 2025 et après")
    st.markdown(f"{b.temporal_n[0]} chiffres de {b.temporal_n[1]} jeux que les modèles n'ont jamais vus. "
                "Si un modèle ne marche que sur le passé, c'est ici qu'on le voit.")
    tm = (b.temporal_scores_clean if use_clean else b.temporal_scores).copy()
    show(three_panel(tm.iloc[::-1].reset_index(drop=True), "modèle"))
    recal = tm[tm.modèle == "Actuel recalibré"]
    how_to_read(
        "même lecture que plus haut. "
        + (f"**« Actuel recalibré » se dégrade** (×{fr(recal.facteur_median.iloc[0])}, tendance "
           f"{signed_pct(recal.biais.iloc[0])}) : il a appris sur des jeux anciens que le site sous-estimait "
           "beaucoup, et applique cette correction à des jeux récents qui en avaient moins besoin. C'est un "
           "exemple de **changement de contexte** entre l'entraînement et la réalité."
           if not recal.empty and recal.facteur_median.iloc[0] > tm.facteur_median.iloc[0] else ""))
    cvi, tmi = cv.set_index("modèle"), tm.set_index("modèle")

    st.subheader("Taille des modèles à arbres")
    st.dataframe(b.trees, hide_index=True, width="stretch", column_config={
        "réglage": st.column_config.TextColumn("réglage"),
        "nœuds": st.column_config.NumberColumn(
            "taille (nœuds)", format="localized",
            help="Nombre total de questions et de réponses dans tous les arbres : ce qu'il faudrait recopier dans "
                 "le backend. Plus c'est petit, plus c'est simple."),
        "demi-largeur": st.column_config.NumberColumn(
            "fourchette", format="÷/× %.1f",
            help="La fourchette va du milieu divisé par ce nombre au milieu multiplié par ce nombre."),
    })
    st.caption("Le réglage automatique des arbres (16 combinaisons par modèle) a été testé le 28/10 : aucun gain "
               "mesurable. On garde des réglages par défaut prudents.")

    st.subheader("Verdict")
    cands = [n for n in cvi.index if n not in NOT_CANDIDATES]
    m = duels(b.snapshot, tuple(cands), bool(use_clean))
    best_name = min(cands, key=lambda n: cvi.loc[n, "facteur_median"])
    # Égalité = le meilleur ne bat pas l'autre dans au moins 9 tirages sur 10.
    tied = [n for n in cands if n == best_name or m.loc[best_name, n] < 0.9]
    winner = min(tied, key=lambda n: (COMPLEXITY.get(n, 9), cvi.loc[n, "facteur_median"]))
    w = cvi.loc[winner]
    reasons = [f"**Meilleur score : « {best_name} »** (×{fr(cvi.loc[best_name, 'facteur_median'])})."]
    if len(tied) > 1:
        others = [n for n in tied if n != best_name]
        reasons.append("**Font jeu égal** (il ne les bat pas dans au moins 9 tirages sur 10) : "
                       + ", ".join(f"« {n} » (×{fr(cvi.loc[n, 'facteur_median'])})" for n in others) + ".")
    else:
        reasons.append("Il bat tous les autres modèles appris dans au moins 9 tirages sur 10.")
    if winner != best_name:
        reasons.append(f"**À précision égale, on prend le plus simple** : « {winner} ».")
    st.success(
        f"**Modèle à garder aujourd'hui : {winner}**\n\n" + "\n".join(f"- {r}" for r in reasons) + "\n\n"
        f"Sur des jeux jamais vus, il se trompe d'un facteur **×{fr(w.facteur_median)}** d'habitude (contre "
        f"×{fr(cvi.loc['Modèle actuel', 'facteur_median'])} pour le modèle actuel), **{pct(w.part_x2)}** de ses "
        f"estimations sont à moins de ×2 (contre {pct(cvi.loc['Modèle actuel', 'part_x2'])}), et sa fourchette "
        f"contient le vrai chiffre **{pct(w.couverture)}** du temps (contre "
        f"{pct(cvi.loc['Modèle actuel', 'couverture'])}). Dans le temps (2025 et après) : "
        f"×{fr(tmi.loc[winner, 'facteur_median'])} contre ×{fr(tmi.loc['Modèle actuel', 'facteur_median'])}.")
    st.caption(f"Verdict sur {'les chiffres nettoyés' if use_clean else 'tous les chiffres'}. Il se confirmera sur "
               "les chiffres publiés après ce snapshot : ce sera le prochain test neutre.")
    with st.expander("Duels deux à deux entre modèles appris"):
        st.dataframe((m * 100).rename_axis("ce modèle…"), width="stretch", column_config={
            c: st.column_config.NumberColumn(f"…bat « {c} »", format="%.0f %%") for c in m.columns})
        how_to_read(
            "chaque case donne la part des tirages au hasard de jeux où le modèle de la ligne a une erreur "
            "typique plus basse que celui de la colonne. Au-dessus de 90 % : il est vraiment meilleur. Entre 10 "
            "et 90 % : on ne peut pas les départager avec nos données.")

    st.subheader("Test final du 28/10 (déjà utilisé)")
    final = load_final(b.snapshot)
    if final is None:
        st.info("Aucun test final enregistré pour ce snapshot.")
    else:
        fs = final["scores"]
        fsi, ch = fs.set_index("modèle"), final["chosen"]
        st.markdown(
            f"Lancé **une seule fois**, le 28/10, sur {final['n']} chiffres de {final['games']} jeux que personne "
            f"n'avait regardés, avec la **version précédente** des modèles (sans nettoyage des chiffres ni nouvelles "
            f"informations). Le modèle avait été choisi avant : **{ch}**. Ce test a servi : ses jeux font "
            "maintenant partie du développement.")
        show(three_panel(fs.iloc[::-1].reset_index(drop=True), "modèle"))
        base_f, chosen_f = fsi.loc["Modèle actuel"], fsi.loc[ch]
        how_to_read(
            f"**{ch}** s'y trompait d'un facteur ×{fr(chosen_f.facteur_median)} contre ×{fr(base_f.facteur_median)} "
            f"pour le modèle actuel (gain de précision non confirmé : {pct(chosen_f.proba_meilleur)} des tirages), "
            f"mais avec une fourchette honnête ({pct(chosen_f.couverture)} contre {pct(base_f.couverture)}) et sans "
            "viser trop bas. Leçon retenue : le classement entre modèles appris change selon les jeux testés ; on "
            "juge désormais sur la moyenne et la stabilité, et on ne retient un modèle plus complexe que s'il bat "
            "nettement les plus simples.")

    st.subheader("Où les modèles font la différence : selon l'âge du jeu")
    ages = error_by_age(b).T  # une ligne par modèle, une colonne par tranche d'âge
    ages.index.name = "modèle"
    st.dataframe(ages, width="stretch", column_config={
        col: st.column_config.NumberColumn(col, format="×%.2f") for col in ages.columns})
    old = ages["plus de 3 ans"]
    best_old = old.idxmin()
    how_to_read(
        "chaque case est l'erreur typique d'un modèle pour les jeux d'un âge donné au moment du chiffre (plus petit "
        f"= mieux). Le gain le plus net concerne les **jeux de plus de 3 ans** : ×{fr(old['Modèle actuel'])} pour le "
        f"modèle actuel, ×{fr(old['Linéaire (toutes les infos)'])} pour le linéaire, **×{fr(old[best_old])}** pour "
        f"« {best_old} ». Pour ces vieux jeux, le lien entre reviews et ventes dépend de l'âge et de l'époque ; une "
        "formule unique le rate, alors que les arbres posent des questions différentes selon le jeu.")

    if getattr(b, "checks", None):
        render_checks(b)

    st.subheader(f"Qu'apporte chaque type d'information ? (testé avec le {ABLATION_MODEL.lower()})")
    abl = b.ablation[b.ablation.modèle != "toutes les infos"].sort_values("écart")
    ref = b.ablation[b.ablation.modèle == "toutes les infos"].facteur_median.iloc[0]
    labels = abl.modèle.str.replace("sans ", "", n=1)
    texts = [f"×{fr(ref)} → ×{fr(v)}" for v in abl.facteur_median]
    fig = go.Figure(go.Bar(
        y=labels, x=abl["écart"], orientation="h",
        marker_color=[C["model"] if v > 0 else C["neutral"] for v in abl["écart"]],
        customdata=texts, hovertemplate="sans %{y} : %{customdata}<extra></extra>", showlegend=False))
    # Étiquettes toujours à droite du zéro, pour ne pas chevaucher les libellés.
    fig.add_scatter(y=labels, x=abl["écart"].clip(lower=0), mode="text", text=["  " + t for t in texts],
                    textposition="middle right", hoverinfo="skip", showlegend=False, cliponaxis=False)
    style(fig, 40 + 46 * len(abl), title="Hausse de l'erreur typique quand on retire cette information",
          bargap=0.4)
    fig.update_xaxes(range=[min(-0.05, abl["écart"].min() * 1.6), abl["écart"].max() * 1.6])
    fig.add_vline(x=0, line=dict(color=C["ink2"], width=1))
    show(fig)
    how_to_read(
        "on retire une famille d'informations, on réentraîne et on remesure. **Plus la barre est longue, plus "
        "cette information était utile.** Une barre grise à gauche du trait veut dire que le modèle fait aussi "
        "bien ou mieux sans : l'information n'aide pas (ou ajoute du bruit). Ce test s'appelle une *ablation*. "
        "Les tags Steam n'y figurent pas : ils n'aidaient déjà pas le modèle linéaire, et les arbres ne les "
        "utilisent pas.")

    st.subheader("Ce que les modèles linéaires ont appris")
    st.caption("Les arbres (gradient boosting, forêt aléatoire) n'ont pas de coefficients : ils raisonnent par "
               "questions successives, différentes d'un jeu à l'autre. Pour savoir ce qui compte pour eux, voir "
               "l'ablation ci-dessus. « Linéaire + interactions » n'est pas détaillé non plus : avec des produits "
               "d'informations, un coefficient seul ne se lit plus.")
    name = st.radio("Modèle", list(b.coefs), horizontal=True)
    c = b.coefs[name]
    c = c[~c.technique].head(12)
    lines = []
    for r in c.itertuples():
        verb = "plus" if r.effet > 1 else "moins"
        lines.append({"information": r.description, "effet sur l'estimation": r.effet, "quand": r.quand,
                      "en clair": f"{r.quand.capitalize()}, le modèle estime ×{fr(r.effet)} "
                                  f"({'+' if r.effet > 1 else '−'}{pct(abs(r.effet - 1))}) : {verb} de ventes."})
    st.dataframe(pd.DataFrame(lines)[["information", "effet sur l'estimation", "en clair"]], hide_index=True,
                 width="stretch", column_config={
                     "effet sur l'estimation": st.column_config.NumberColumn(format="×%.2f"),
                 })
    how_to_read(
        "une régression linéaire est une formule : elle multiplie l'estimation par un facteur pour chaque "
        "information. Exemple : « nombre de reviews Steam ×1,2 si la valeur double » veut dire qu'un jeu avec deux "
        "fois plus de reviews est estimé 20 % plus haut, **toutes choses égales par ailleurs**. Attention : "
        "plusieurs informations disent en partie la même chose (reviews et pic de joueurs montent ensemble), donc "
        "elles se partagent l'effet. Ne lisez pas une ligne seule comme une loi.")

    with st.expander("Et maintenant ?"):
        st.markdown(
            "- **Le modèle à garder** : voir le verdict et le test final plus haut.\n"
            "- **Un nouveau test neutre** : le test final est maintenant « utilisé ». Pour départager à nouveau "
            "des modèles sans tricher, on prendra les chiffres publiés **après** ce snapshot : de nouveaux jeux, "
            "que personne n'aura regardés.\n"
            "- **De meilleures informations** : followers Steam (collectés depuis 2024), prix, nettoyage des "
            "chiffres mal rattachés.\n"
            "- **Mettre en prod** : un modèle à arbres s'enregistre dans un fichier. Le backend peut relire ces "
            "arbres en TypeScript (export JSON) ou appeler un petit service Python ; dans les deux cas, on "
            "vérifiera qu'il donne les mêmes chiffres, comme pour le portage du modèle actuel (test de parité).")


with tab_models:
    b = load_bench()
    if b is None:
        st.info("Les modèles n'ont pas encore été entraînés sur ce snapshot. Lancez `python bench.py` depuis "
                "`ml/`, ou cliquez ci-dessous (environ 1 minute).")
        if st.button("Entraîner et tester les modèles"):
            with st.spinner("Entraînement et test des modèles…"):
                save_bench(run_bench(snap, est, res))
            load_bench.clear()
            st.rerun()
    else:
        render_models(b)

# ─── 5. Qualité des données ──────────────────────────────────────────────────

with tab_data:
    st.markdown("Le test ne vaut que ce que valent les chiffres publiés. Cet onglet montre d'où ils viennent et ce "
                "qu'il a fallu écarter.")
    m = snap.milestones
    usable = m[~m.rejected & ~m.isEngagement & m.reportedAt.notna()]
    funnel = pd.DataFrame({"étape": [
        "Chiffres en base", "Non rejetés", "Hors chiffres d'engagement", "Datés (= utilisables)",
        "Chiffres monde (le total)", "Sur un jeu actif et payant", "Sans les chiffres à 0 ni les doublons", "Estimables à leur date",
    ], "n": [
        len(m), int((~m.rejected).sum()), int((~m.rejected & ~m.isEngagement).sum()), len(usable),
        int((usable.platform == "GLOBAL").sum()), res.n_start, len(res.rows), int(res.rows.hasEstimate.sum()),
    ]})
    fig = go.Figure(go.Bar(y=funnel.étape, x=funnel.n, orientation="h", marker_color=C["model"],
                           text=[thousands(v) for v in funnel.n], textposition="outside", cliponaxis=False,
                           hovertemplate="%{y} : %{x}<extra></extra>"))
    style(fig, 330, title="Des chiffres en base aux chiffres comparés", bargap=0.4)
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(range=[0, funnel.n.max() * 1.15])
    show(fig)
    st.markdown(
        ":material/lightbulb: **Comment lire :** chaque barre enlève une catégorie de chiffres à la précédente.\n"
        "- **Non rejetés** : un admin a écarté les autres à la main (faux, mal rattachés…).\n"
        "- **Hors engagement** : on retire les « X millions de joueurs », qui comptent les abonnés Game Pass et "
        "ne sont pas des ventes.\n"
        "- **Datés** : sans date, impossible de remonter le temps.\n"
        "- **Chiffres monde** : pour l'instant on n'évalue que le total ; les chiffres d'une seule plateforme "
        "(PC, PlayStation, Xbox, Switch) sont mis de côté.\n"
        "- **Jeu actif et payant** : les jeux gratuits ou supprimés ne sont pas estimés par le site.\n"
        "- **Sans les chiffres à 0 ni les doublons** : un chiffre à 0 est une erreur de saisie ; un doublon est la "
        "même annonce (même jeu, plateforme, chiffre et jour) reprise par plusieurs médias, qu'on ne compte "
        "qu'une fois.\n"
        "- **Estimables à leur date** : le site avait au moins un signal ce jour-là (reviews ou notes).")
    c1, c2 = st.columns(2)
    c1.metric("Doublons exacts retirés", thousands(res.n_dup),
              help="Même jeu, même plateforme, même chiffre, même jour : la même annonce reprise par plusieurs médias.")
    c2.metric("Chiffres à 0 retirés", res.n_zero, help="Un chiffre de ventes à 0 est une erreur d'extraction.")

    st.subheader("Étape 0 : chiffres utilisables par plateforme, source et type")
    st.caption("Inventaire complet, toutes plateformes (seule la colonne GLOBAL est évaluée pour l'instant). "
               "Lignes = source et type de chiffre ; colonnes = plateforme ; cases = nombre de chiffres. "
               "« estimé par un tiers » = le chiffre publié est lui-même une estimation d'un cabinet d'analyse.")
    labelled = usable.assign(isEstimate=usable.isEstimate.map({True: "estimé par un tiers", False: "chiffre réel"}))
    pivot = labelled.pivot_table(index=["source", "isEstimate"], columns="platform", values="id", aggfunc="count",
                                 fill_value=0, margins=True, margins_name="Total")
    st.dataframe(pivot, width="stretch")

    bench_b = load_bench()
    if bench_b is not None and "suspect" in bench_b.table.columns:
        st.subheader("Chiffres écartés de l'entraînement des modèles")
        sus = bench_b.table[bench_b.table.suspect].copy()
        st.markdown(
            f"**{len(sus)} chiffres** ({len(sus) / len(bench_b.table):.0%}) ne servent pas à **entraîner** les modèles "
            "appris. **La base n'est pas modifiée** : ils restent dans `milestone`, s'affichent ailleurs dans cette "
            "UI, et les modèles sont aussi jugés sur eux (« Comparer les modèles » → « Tous les chiffres »). Trois "
            "règles prudentes, avec des estimations faites par des modèles qui n'avaient pas vu le jeu :\n"
            "- **incohérent dans le temps** : moins de la moitié d'un chiffre antérieur du même jeu (les ventes "
            "cumulées ne baissent pas, c'est donc un chiffre partiel) ;\n"
            "- **partiel probable** : plus de 4 fois plus petit que ce que disent le site, la forêt et le linéaire, "
            "alors qu'ils sont d'accord entre eux ;\n"
            "- **écart extrême** : plus de ×20 avec les trois modèles (mauvais jeu, ou annonce du jour de sortie).\n\n"
            "On ne retire **pas** les chiffres bien plus **grands** que les modèles (sauf écart extrême) : ce sont "
            "souvent de vrais succès console que tous les modèles sous-estiment, et les cacher masquerait un défaut.")
        urls = snap.milestones.set_index("id").sourceUrl
        table = pd.DataFrame({
            "jeu": sus.gameName, "date": sus.reportedAt.dt.date, "chiffre publié": sus.units,
            "raison": sus.suspectReason, "site": sus.pred_Site, "forêt": sus["pred_Forêt aléatoire"],
            "linéaire": sus["pred_Linéaire + interactions"], "source": sus.milestoneId.map(urls),
        }).sort_values(["raison", "jeu"])
        st.dataframe(table, hide_index=True, width="stretch", height=380, column_config={
            "chiffre publié": st.column_config.NumberColumn(format="localized"),
            "site": st.column_config.NumberColumn("estimation site", format="localized",
                                                  help="Estimation du modèle actuel à cette date."),
            "forêt": st.column_config.NumberColumn("estimation forêt", format="localized",
                                                   help="Forêt aléatoire n'ayant jamais vu ce jeu."),
            "linéaire": st.column_config.NumberColumn("estimation linéaire", format="localized",
                                                      help="Linéaire + interactions n'ayant jamais vu ce jeu."),
            "source": st.column_config.LinkColumn(display_text="source"),
        })

    st.subheader("Jeux avec le plus de doublons")
    st.caption("Surtout des jeux attendus ou récents, dont la même annonce a été reprise par de nombreux médias.")
    u = usable.assign(day=usable.reportedAt.dt.date)
    dups = u[u.duplicated(["gameId", "platform", "units", "day"])]
    top = dups.groupby("gameId").size().sort_values(ascending=False).head(15)
    st.dataframe(pd.DataFrame({"jeu": top.index.map(games.name), "doublons": top.values}), hide_index=True)

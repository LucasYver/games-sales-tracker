"""Page 5: the whole catalog estimated today, and what the numbers look like."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from dataset import DATA_DIR
from ui.common import n, snapshots, units


def x(value: float) -> str:
    return "—" if pd.isna(value) else f"×{value:.2f}".replace(".", ",")


@st.cache_data(show_spinner=False)
def _load(snapshot: str, built_at: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    path = DATA_DIR / snapshot
    return pd.read_parquet(path / "catalog_estimates.parquet"), pd.read_parquet(path / "catalog.parquet")


def render() -> None:
    names = [s for s in snapshots() if (DATA_DIR / s / "catalog_estimates.parquet").exists()]
    st.title("5 · Le catalogue")
    if not names:
        st.warning("Aucun résultat : lancer `estimate_catalog.py`.")
        return
    snapshot = st.sidebar.selectbox("Snapshot", names)
    e, catalog = _load(snapshot, (DATA_DIR / snapshot / "catalog_estimates.parquet").stat().st_mtime)
    st.caption("Tous les jeux du catalogue estimés à aujourd'hui. Seuls des chiffres publiés peuvent dire si une "
               "estimation est juste, et 89 % des jeux n'en ont pas : cette page ne note pas le modèle, elle vérifie que "
               "ses chiffres se tiennent.")

    blind = e[e.estimate.isna()]
    a, b, c, d = st.columns(4)
    a.metric("Jeux estimés", n(e.estimate.notna().sum()),
             help=f"{n(len(catalog) - len(e))} pas encore sortis ou exclus, {n(len(blind))} sans aucun signal")
    b.metric("Ancrés sur un chiffre publié", n((e.basis == "ancré sur un chiffre publié").sum()))
    c.metric("Estimés par le modèle", n(e.basis.str.startswith("modèle").sum()))
    d.metric("Non estimés", n(len(blind)))

    st.header("Comment chaque jeu est estimé")
    methods = e.groupby("basis").agg(Jeux=("gameId", "size"), mediane=("estimate", "median")).sort_values("Jeux", ascending=False)
    st.dataframe(pd.DataFrame({"Jeux": methods.Jeux, "Estimation médiane": methods.mediane.map(lambda v: "—" if pd.isna(v) else units(v))})
                 .rename_axis("Méthode"), width="stretch")
    st.caption("Notes console : les ventes PlayStation et Xbox viennent du nombre de notes sur les stores aujourd'hui "
               "(environ 37 ventes par note PlayStation, 53 par note Xbox, 21 pour un jeu du Game Pass). Elles relèvent le "
               "modèle quand consoles + PC dépassent son total, et servent seules quand Steam n'a presque aucune review.")
    st.info(f"**{n(len(blind))} jeux ne sont pas estimés** : moins de 10 reviews Steam, aucune note console et aucun "
            f"chiffre publié. Le modèle seul leur donnait {units(blind.model.median())} en médiane, parce qu'il n'a appris "
            "ce cas que sur des succès console.")

    st.header("Par taille de jeu")
    pc_only = e[e.onPc & ~e.onPlaystation & ~e.onXbox]
    by = e.groupby("bucket", observed=True)
    table = pd.DataFrame({
        "Jeux": by.size(), "Estimation médiane": by.estimate.median().map(units),
        "1 jeu sur 10 sous": by.estimate.quantile(0.1).map(units), "1 jeu sur 10 au-dessus de": by.estimate.quantile(0.9).map(units),
        "Ventes par review (jeux PC seuls)": pc_only.groupby("bucket", observed=True).perReview.median().round(0)})
    st.dataframe(table.rename_axis("Reviews Steam aujourd'hui"), width="stretch")
    per = pc_only.groupby("bucket", observed=True).perReview.median()
    st.warning(f"**Le niveau des petits jeux reste peu vérifié.** Pour un jeu PC seul, le modèle donne "
               f"{per.get('100–1 000', float('nan')):.0f} ventes par review entre 100 et 1 000 reviews et "
               f"{per.get('1 000–10 000', float('nan')):.0f} entre 1 000 et 10 000. Les chiffres connus de jeux PC seuls "
               "donnent environ 65 à cette taille (fuite Steam de 2018 et totaux publiés), et presque aucun petit jeu "
               "récent n'a publié de ventes.")

    st.header("Contrôle : la fuite Steam de 2018")
    leak = e[e.playersLeak.notna() & e.modelPc.notna()]
    below = (leak.modelPc < leak.playersLeak).mean()
    st.markdown(f"{n(len(leak))} jeux ont un nombre de joueurs PC connu en juillet 2018. Un jeu ne peut pas avoir vendu "
                f"moins aujourd'hui qu'il n'avait de joueurs alors : l'estimation PC est en dessous pour **{below:.0%}** d'entre eux. "
                f"En médiane, elle vaut **{x((leak.modelPc / leak.playersLeak).median())}** leurs joueurs de 2018.")

    st.header("À vérifier dans la base")
    odd = e[(e.steamReviews < 200) & (e.consoleUnits > 20_000)].merge(catalog[["gameId", "psRatings", "xboxRatings"]], on="gameId")
    st.markdown(f"**{n(len(odd))} jeux ont moins de 200 reviews Steam mais des notes console qui indiquent plus de 20 000 ventes.** "
                "Soit le jeu se vend surtout sur console, soit sa fiche Steam pointe vers le mauvais produit (démo, bande-son).")
    st.dataframe(odd[["game", "steamReviews", "psRatings", "xboxRatings", "consoleUnits", "estimate", "basis"]]
                 .sort_values("consoleUnits", ascending=False), width="stretch", hide_index=True,
                 column_config={"game": "Jeu", "steamReviews": st.column_config.NumberColumn("Reviews Steam", format="localized"),
                                "psRatings": st.column_config.NumberColumn("Notes PS", format="localized"),
                                "xboxRatings": st.column_config.NumberColumn("Notes Xbox", format="localized"),
                                "consoleUnits": st.column_config.NumberColumn("Ventes console estimées", format="localized"),
                                "estimate": st.column_config.NumberColumn("Estimation", format="localized"), "basis": "Méthode"})

    st.header("Tous les jeux")
    basis = st.multiselect("Méthode", sorted(e.basis.unique()), default=[])
    view = e[e.basis.isin(basis)] if basis else e
    st.dataframe(view[["game", "steamReviews", "estimate", "low", "high", "basis", "anchorUnits", "anchorDate"]]
                 .sort_values("estimate", ascending=False), width="stretch", hide_index=True,
                 column_config={"game": "Jeu", "steamReviews": st.column_config.NumberColumn("Reviews Steam", format="localized"),
                                "estimate": st.column_config.NumberColumn("Estimation", format="localized"),
                                "low": st.column_config.NumberColumn("Bas", format="localized"),
                                "high": st.column_config.NumberColumn("Haut", format="localized"), "basis": "Méthode",
                                "anchorUnits": st.column_config.NumberColumn("Dernier chiffre publié", format="localized"),
                                "anchorDate": st.column_config.DateColumn("Publié le", format="DD/MM/YYYY")})

"""Page 1: the data, before any model."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from dataset import KEPT
from ui.common import BLUE, TARGET_LABELS, game_signals, load, n, snapshots, units

SIZE_BINS = [0, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7, 3e7, float("inf")]
SIZE_LABELS = ["< 10 k", "10–30 k", "30–100 k", "100–300 k", "300 k–1 M", "1–3 M", "3–10 M", "10–30 M", "30 M +"]
REVIEW_BINS = [-1, 0, 100, 1_000, 10_000, 100_000, float("inf")]
REVIEW_LABELS = ["aucune review Steam", "1–100", "100–1 000", "1 000–10 000", "10 000–100 000", "100 000 +"]
SIGNALS = {
    "steamReviews": "Reviews Steam",
    "steamPeakPlayers": "Pic de joueurs Steam",
    "psRatings": "Notes PlayStation",
    "xboxRatings": "Notes Xbox",
    "steamFollowers": "Followers Steam",
    "steamBestSalesRank": "Rang des ventes Steam",
    "twitchViewers30d": "Spectateurs Twitch",
    "steamMedianPlaytime": "Temps de jeu médian",
}
SINCE = {"steamReviews": "2010, par mois jusqu'en août 2026", "steamPeakPlayers": "2012, par mois jusqu'en août 2026",
         "psRatings": "juin 2026 (quelques jeux avant)", "xboxRatings": "septembre 2026", "steamFollowers": "mars 2024",
         "steamBestSalesRank": "avril 2023 à juillet 2026, 897 jeux", "twitchViewers30d": "juillet 2026",
         "steamMedianPlaytime": "juillet 2026"}


def _bar(fig: go.Figure, height: int) -> go.Figure:
    fig.update_traces(marker_color=BLUE, marker_cornerradius=4)
    fig.update_layout(height=height, margin=dict(l=0, r=10, t=10, b=0), bargap=0.25, showlegend=False,
                      xaxis_title=None, yaxis_title=None)
    return fig


def _kind(row) -> str:
    label = TARGET_LABELS[row.target]
    return f"{label} (joueurs, fuite)" if row.measure == "joueurs" else label


def render() -> None:
    names = snapshots()
    if not names:
        st.error("Aucun snapshot. Lancer `export.py` puis `dataset.py`.")
        return
    snapshot = st.sidebar.selectbox("Snapshot", names)
    figures, catalog, manifest = load(snapshot)
    kept = figures[figures.status == KEPT].copy()
    kept["kind"] = [_kind(r) for r in kept.itertuples()]
    kinds = [k for k in ["Total", "PC", "PC (joueurs, fuite)", "PlayStation", "PlayStation (joueurs, fuite)", "Xbox"]
             if k in set(kept.kind)]

    st.title("1 · Les données")
    st.caption(f"Copie de la base du {pd.Timestamp(manifest['exportedAt']).strftime('%d/%m/%Y à %H:%M')} UTC. "
               "Jeux payants sortis depuis 2017. Aucun modèle ici : seulement ce qu'on a pour apprendre et pour juger.")

    with_total = int((catalog.figuresTotal > 0).sum())
    a, b, c, d = st.columns(4)
    a.metric("Chiffres gardés", n(len(kept)))
    b.metric("Jeux avec un chiffre", n(kept.gameId.nunique()))
    c.metric("Jeux à estimer", n(len(catalog)))
    d.metric("Jeux avec un chiffre total", f"{with_total / len(catalog):.0%}", help=f"{n(with_total)} jeux sur {n(len(catalog))}")

    # ---- what we keep -------------------------------------------------------
    st.header("Ce qu'on garde")
    st.markdown("Un chiffre **total** est un chiffre monde, ou le chiffre d'une plateforme quand le jeu ne se vendait "
                "sur aucune autre à cette date. Les **fuites** comptent des joueurs, pas des ventes.")
    left, right = st.columns(2)
    summary = kept.groupby("kind").agg(Chiffres=("units", "size"), Jeux=("gameId", "nunique"),
                                       Médiane=("units", "median")).reindex(kinds)
    summary["Médiane"] = summary["Médiane"].map(units)
    left.subheader("Par type de chiffre")
    left.dataframe(summary.rename_axis("Type"), width="stretch")
    origin = kept.pivot_table(index="kind", columns="origin", values="units", aggfunc="size", fill_value=0).reindex(kinds)
    right.subheader("Par origine")
    right.dataframe(origin.rename_axis("Type"), width="stretch")

    st.subheader("D'où viennent les chiffres totaux")
    totals = kept[kept.target == "TOTAL"]
    why = totals.groupby("totalBecause").agg(Chiffres=("units", "size"), Jeux=("gameId", "nunique"))
    only = totals.groupby("gameId").totalBecause.agg(lambda r: (r != "chiffre monde").all()).sum()
    st.dataframe(why.sort_values("Chiffres", ascending=False).rename_axis("Raison"), width="stretch")
    st.caption(f"{n(only)} jeux n'ont un chiffre total que grâce à un chiffre de plateforme. « À cette date » : les autres "
               "plateformes du jeu sont sorties plus tard, d'après les dates de sortie par plateforme de la base.")

    st.subheader("Combien de jeux à chaque taille")
    st.caption("Un jeu compte une fois, à son plus gros chiffre gardé.")
    best = kept.groupby(["kind", "gameId"]).units.max().reset_index()
    best["size"] = pd.cut(best.units, SIZE_BINS, labels=SIZE_LABELS, right=False)
    sizes = best.groupby(["kind", "size"], observed=False).size().rename("Jeux").reset_index()
    fig = px.bar(sizes, x="size", y="Jeux", facet_col="kind", facet_col_wrap=3, category_orders={"kind": kinds},
                 labels={"size": "Plus gros chiffre"}, facet_row_spacing=0.22)
    fig.for_each_annotation(lambda t: t.update(text=t.text.split("=")[-1]))
    fig.update_yaxes(matches=None, showticklabels=True, title=None)
    fig.update_xaxes(title=None, tickangle=-45)
    fig.update_traces(marker_color=BLUE, marker_cornerradius=4, hovertemplate="%{x} : %{y} jeux<extra></extra>")
    fig.update_layout(height=520, margin=dict(l=0, r=10, t=30, b=0), bargap=0.25)
    st.plotly_chart(fig, width="stretch")

    # ---- what we drop -------------------------------------------------------
    st.header("Ce qu'on écarte")
    dropped = figures[figures.status != KEPT].status.value_counts().sort_values()
    fig = px.bar(x=dropped.values, y=dropped.index, orientation="h", text=[n(v) for v in dropped.values])
    fig.update_traces(hovertemplate="%{y} : %{x} chiffres<extra></extra>", textposition="outside", cliponaxis=False)
    fig.update_xaxes(showticklabels=False, showgrid=False)
    st.plotly_chart(_bar(fig, 34 * len(dropped) + 20), width="stretch")
    st.caption(f"{n(len(figures))} chiffres en base, {n(len(kept))} gardés. « Même chiffre répété » : un palier cité "
               "plusieurs fois, on garde sa première date. Rien n'est modifié dans la base.")

    # ---- who publishes ------------------------------------------------------
    st.header("Quels jeux publient un chiffre")
    st.markdown("Le modèle doit estimer tout le catalogue, mais il n'apprend que des jeux qui ont un chiffre. "
                "Plus un jeu est petit, plus c'est rare.")
    cat = catalog.assign(bucket=pd.cut(catalog.steamReviews.fillna(0), REVIEW_BINS, labels=REVIEW_LABELS))
    cover = cat.groupby("bucket", observed=False).agg(
        Jeux=("gameId", "size"), total=("figuresTotal", lambda s: (s > 0).sum()),
        pc=("figuresPc", lambda s: (s > 0).sum()), leak=("playersLeak", lambda s: s.notna().sum()))
    share = (cover.total / cover.Jeux).fillna(0)
    fig = px.bar(x=cover.index.astype(str), y=share, text=[f"{v:.0%}" for v in share],
                 custom_data=[cover.total, cover.Jeux])
    fig.update_traces(hovertemplate="%{x}<br>%{customdata[0]} jeux sur %{customdata[1]} ont un chiffre total<extra></extra>",
                      textposition="outside", cliponaxis=False)
    fig.update_yaxes(tickformat=".0%", range=[0, 1])
    st.plotly_chart(_bar(fig, 300), width="stretch")
    st.caption("Part des jeux du catalogue qui ont au moins un chiffre total, selon leur nombre de reviews Steam aujourd'hui.")
    table = cover.rename(columns={"total": "Avec un chiffre total", "pc": "Avec un chiffre PC",
                                  "leak": "Avec des joueurs de la fuite"}).rename_axis("Reviews Steam aujourd'hui")
    st.dataframe(table, width="stretch")

    # ---- what was known at the date -----------------------------------------
    st.header("Ce qu'on savait à la date du chiffre")
    st.markdown("Part des chiffres gardés pour lesquels chaque information existait **avant** la date du chiffre. "
                "Une information relevée après serait une fuite : le modèle verrait le futur.")
    known = kept.groupby("kind")[list(SIGNALS)].agg(lambda s: s.notna().mean()).reindex(kinds).T
    known.index = [SIGNALS[i] for i in known.index]
    known.insert(0, "Relevé depuis", [SINCE[k] for k in SIGNALS])
    st.dataframe(known.rename_axis("Information"), width="stretch",
                 column_config={k: st.column_config.ProgressColumn(k, format="percent", min_value=0, max_value=1)
                                for k in kinds})
    total = kept[kept.kind == "Total"]
    strict, stamped = total.steamReviews.notna().mean(), total.steamReviewsStamped.notna().mean()
    early = total[total.ageDays <= 30]
    st.info(f"**Relevés mensuels.** Jusqu'en août 2026, les reviews et les joueurs Steam sont relevés une fois par mois. "
            f"La ligne est datée du 1er du mois mais contient la valeur de fin de mois. Lue à sa date, elle montre "
            f"jusqu'à un mois de futur. Ici, une ligne mensuelle n'est connue qu'à la fin de son mois : "
            f"{strict:.0%} des chiffres totaux ont alors des reviews, contre {stamped:.0%} en la lisant à sa date. "
            f"Pour les {n(len(early))} chiffres publiés dans les 30 jours après la sortie : "
            f"{early.steamReviews.notna().mean():.0%} contre {early.steamReviewsStamped.notna().mean():.0%}.")
    rebuilt = total.steamReviewsBasis.value_counts()
    st.info(f"**Reviews reconstruites à la date.** Entre deux relevés, le nombre de reviews est replacé sur la courbe "
            f"habituelle d'un lancement (37 % des reviews du 30e jour au 3e jour, 60 % au 7e). Vérifié sur des jeux relevés "
            f"chaque jour : l'écart avec le vrai nombre est de ×1,21 la première semaine, contre ×1,89 en lisant la fin du "
            f"mois précédent ou du mois en cours. {early.steamReviewsAtDate.gt(0).mean():.0%} des chiffres des 30 premiers "
            f"jours ont alors des reviews. Sur les chiffres totaux : "
            + ", ".join(f"{k} {n(v)}" for k, v in rebuilt.items()) + ".")

    # ---- explorer -----------------------------------------------------------
    st.header("Explorer")
    tab_figures, tab_game = st.tabs(["Les chiffres", "Un jeu"])
    with tab_figures:
        f1, f2, f3 = st.columns(3)
        status = f1.multiselect("Statut", sorted(figures.status.unique()), default=[KEPT])
        target = f2.multiselect("Type", ["TOTAL", "PC", "PLAYSTATION", "XBOX"], default=[], format_func=TARGET_LABELS.get)
        origins = f3.multiselect("Origine", sorted(figures.origin.unique()), default=[])
        view = figures[figures.status.isin(status or figures.status.unique())]
        if target:
            view = view[view.target.isin(target)]
        if origins:
            view = view[view.origin.isin(origins)]
        st.caption(f"{n(len(view))} chiffres sur {n(view.gameId.nunique())} jeux")
        st.dataframe(
            view[["game", "target", "totalBecause", "measure", "units", "reportedAt", "ageDays", "origin", "status", "steamReviews",
                  "steamPeakPlayers", "psRatings", "xboxRatings", "steamFollowers", "sourceUrl"]].sort_values("reportedAt", ascending=False),
            width="stretch", hide_index=True,
            column_config={"game": "Jeu", "target": "Type", "totalBecause": "Total parce que", "measure": "Mesure",
                           "units": st.column_config.NumberColumn("Chiffre", format="localized"),
                           "reportedAt": st.column_config.DateColumn("Date", format="DD/MM/YYYY"),
                           "ageDays": st.column_config.NumberColumn("Âge (jours)", format="%d"),
                           "origin": "Origine", "status": "Statut",
                           "steamReviews": st.column_config.NumberColumn("Reviews Steam", format="localized"),
                           "steamPeakPlayers": st.column_config.NumberColumn("Pic joueurs", format="localized"),
                           "psRatings": st.column_config.NumberColumn("Notes PS", format="localized"),
                           "xboxRatings": st.column_config.NumberColumn("Notes Xbox", format="localized"),
                           "steamFollowers": st.column_config.NumberColumn("Followers", format="localized"),
                           "sourceUrl": st.column_config.LinkColumn("Source", display_text="ouvrir")})
    with tab_game:
        counts = kept.groupby("game").size().sort_values(ascending=False)
        game = st.selectbox("Jeu", counts.index, format_func=lambda g: f"{g} ({counts[g]} chiffres)")
        rows = kept[kept.game == game].sort_values("reportedAt")
        fig = go.Figure()
        for kind, colour in zip(kinds, [BLUE, "#eb6834", "#eb6834", "#1baf7a", "#1baf7a", "#eda100"]):
            part = rows[rows.kind == kind]
            if len(part):
                fig.add_scatter(x=part.reportedAt, y=part.units, mode="lines+markers", name=kind,
                                line=dict(color=colour, width=2, dash="dot" if "joueurs" in kind else "solid"),
                                marker=dict(size=9, line=dict(width=2, color="rgba(255,255,255,0.9)")),
                                hovertemplate="%{x|%d/%m/%Y} : %{y:,.0f}<extra>" + kind + "</extra>")
        fig.update_layout(height=320, margin=dict(l=0, r=10, t=10, b=0), yaxis_title="Chiffre publié", showlegend=True,
                          legend=dict(orientation="h", y=1.12), hovermode="closest")
        st.plotly_chart(fig, width="stretch")
        signals = game_signals(snapshot, rows.gameId.iloc[0])
        reviews = signals[signals.metric == "STEAM_REVIEWS"].sort_values("capturedAt")
        if len(reviews):
            fig = px.line(reviews, x="capturedAt", y="value")
            fig.update_traces(line=dict(color=BLUE, width=2), hovertemplate="%{x|%d/%m/%Y} : %{y:,.0f} reviews<extra></extra>")
            fig.update_layout(height=260, margin=dict(l=0, r=10, t=10, b=0), xaxis_title=None, yaxis_title="Reviews Steam")
            fig.update_xaxes(range=[min(rows.reportedAt.min(), reviews.capturedAt.min()), reviews.capturedAt.max()])
            st.plotly_chart(fig, width="stretch")
        else:
            st.caption("Aucune review Steam relevée pour ce jeu.")

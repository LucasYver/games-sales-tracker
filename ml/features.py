"""Table d'apprentissage : une ligne par chiffre de ventes publié (milestone).

En ML, on apprend une fonction  features → étiquette  :
  - l'ÉTIQUETTE (label, `y`) est ce qu'on veut prédire : le chiffre publié ;
  - les FEATURES (`X`) sont ce que le site sait du jeu à ce moment-là.

Règle d'or : chaque feature est calculée À LA DATE DU CHIFFRE (`reportedAt`).
Une valeur connue seulement plus tard serait une fuite de données : le
modèle « verrait le futur » et paraîtrait meilleur qu'il ne l'est.

Lignes retenues : chiffres monde (GLOBAL), réels (pas `isEstimate`),
nettoyés (sans 0 ni doublon) et estimables par le modèle actuel à leur date,
pour comparer tous les modèles sur exactement les mêmes cas.

Le split « test final » est aussi défini ici : un jeu y est affecté par un
hachage de son identifiant, donc de façon stable d'un snapshot à l'autre, y
compris pour les jeux ajoutés plus tard.
"""

from __future__ import annotations

import hashlib
import math

import numpy as np
import pandas as pd

from backtest import BacktestResult, to_us
from baseline import Estimator
from baseline.constants import LAUNCH_PEAK_CCU_WINDOW_MONTHS
from baseline.estimator import SignalStore, _month_start_us
from baseline.matcher import _none, _time_us, parse_text_array, play_mode_from_categories

US_PER_DAY = 86_400 * 1_000_000
N_TAGS = 12  # tags Steam les plus fréquents, transformés en colonnes oui/non
FINAL_TEST_SHARE = 5  # 1 jeu sur 5 → test final

# Colonnes de features, par famille (utile pour expliquer et pour choisir).
SIGNAL_FEATURES = [
    "log_reviews", "has_reviews", "log_reviews_stale_days",
    "log_launch_ccu", "has_launch_ccu", "log_peak_ccu", "log_ccu_now",
    "log_ps_ratings", "has_ps_ratings", "log_xbox_ratings", "has_xbox_ratings",
]
TIME_FEATURES = ["log_age_days", "release_year", "report_year"]
GAME_FEATURES = ["on_ps", "on_xbox", "multiplayer", "mmo", "franchise", "live_service", "annual_iteration",
                 "log_dlc", "has_dlc_info"]
MATCHER_FEATURES = ["log_matcher_reviews_to_units", "log_matcher_m1", "matcher_pc_share"]
# Vitesse des reviews : un jeu qui démarre fort ne ressemble pas à un jeu qui
# a accumulé lentement le même total.
REVIEW_DYNAMICS_FEATURES = ["log_reviews_30d", "log_reviews_90d", "has_early_reviews",
                            "log_reviews_growth_90d", "has_reviews_growth"]
# Followers Steam (games-popularity.com) : collectés depuis mars 2024 seulement.
FOLLOWER_FEATURES = ["log_followers", "has_followers"]
# Sortie PC après les consoles (ou après une exclusivité) : les reviews Steam
# sous-estiment alors les ventes totales.
RELEASE_FEATURES = ["log_pc_delay_days", "pc_later"]
# v2. Informations « du moment » : elles peuvent baisser (joueurs connectés,
# reviews récentes…) alors que les ventes cumulées ne baissent jamais. Elles
# font descendre la courbe d'un jeu dans le temps.
MOMENTARY_FEATURES = ["log_ccu_now", "log_reviews_growth_90d", "has_reviews_growth", "log_reviews_stale_days",
                      "log_followers"]
# v2. Attente et lancement : ce qui distingue un jeu vendu à 1 million le
# jour de sa sortie, quand les reviews n'ont pas encore suivi. Toutes ne font
# que monter dans le temps (record, valeur figée à la sortie, caractéristique).
LAUNCH_FEATURES = ["log_topseller_best", "has_topseller", "log_followers_max", "log_followers_at_release",
                   "has_followers_at_release", "log_price", "has_price"]
# v2. Vitesse des reviews depuis la sortie : forte au lancement, puis baisse.
VELOCITY_FEATURES = ["log_reviews_per_day"]
# Alternative simple aux jeux voisins : ce que la série et le studio ont
# déjà vendu, d'après les chiffres monde publiés AVANT la date (jeux sortis
# avant celui-ci). Ex. Transport Fever 3 → le meilleur chiffre de Transport
# Fever 2 connu à la date.
TRACK_RECORD_FEATURES = ["log_series_best", "has_series_best", "log_developer_best", "has_developer_best"]
# Détails des jeux voisins (pistes 2, 5 et 6 du banc des voisins) :
# - où en est le jeu sur la courbe de vie des voisins à son âge ;
# - à quel point les voisins ressemblent au jeu ;
# - à quel point leurs ventes par review se contredisent.
CURVE_FEATURES = ["log_curve_position", "has_curve"]
SIMILARITY_FEATURES = ["matcher_sim_mean", "matcher_sim_max"]
SPREAD_FEATURES = ["matcher_ratio_spread", "has_ratio_spread"]
# Points de la courbe des voisins : part de la 1re année vendue à cet âge (jours).
CURVE_POINTS = (("s1", 7), ("m1", 30), ("m3", 91), ("m6", 182), ("a1", 365), ("a2", 730))
CURVE_DEFAULTS = {"s1": 0.37, "m1": 0.46, "m3": 0.59, "m6": 0.74, "a1": 1.0, "a2": 1.47}  # médianes du corpus
BASELINE_FEATURE = "log_baseline"
# Produits de deux informations : permettent à un modèle linéaire d'appliquer
# une règle différente selon le contexte (ex. le poids des reviews qui
# change avec l'année de sortie), ce que les arbres font naturellement.
INTERACTION_FEATURES = ["reviews_x_release", "reviews_x_report", "launch_x_age", "reviews_x_age", "reviews_x_onps"]

FEATURE_LABELS = {
    "log_reviews": "nombre de reviews Steam",
    "has_reviews": "a des reviews Steam",
    "log_reviews_stale_days": "ancienneté du dernier relevé de reviews",
    "log_launch_ccu": "pic de joueurs au lancement",
    "has_launch_ccu": "pic de lancement mesuré",
    "log_peak_ccu": "pic de joueurs (record à la date)",
    "log_ccu_now": "joueurs connectés à la date",
    "log_ps_ratings": "notes PlayStation Store",
    "has_ps_ratings": "a des notes PlayStation",
    "log_xbox_ratings": "notes Xbox Store",
    "has_xbox_ratings": "a des notes Xbox",
    "log_age_days": "âge du jeu",
    "release_year": "année de sortie",
    "report_year": "année du chiffre",
    "on_ps": "sorti sur PlayStation",
    "on_xbox": "sorti sur Xbox",
    "multiplayer": "multijoueur",
    "mmo": "MMO",
    "franchise": "fait partie d'une franchise",
    "live_service": "jeu service (live service)",
    "annual_iteration": "épisode annuel",
    "log_dlc": "nombre de DLC",
    "has_dlc_info": "liste de DLC connue",
    "log_matcher_reviews_to_units": "ventes par review des jeux voisins",
    "log_matcher_m1": "croissance an 1 des jeux voisins",
    "matcher_pc_share": "part PC des jeux voisins",
    "log_baseline": "estimation actuelle du site",
    "log_reviews_30d": "reviews Steam 30 jours après la sortie",
    "log_reviews_90d": "reviews Steam 90 jours après la sortie",
    "has_early_reviews": "reviews du lancement connues",
    "log_reviews_growth_90d": "nouvelles reviews sur les 90 derniers jours",
    "has_reviews_growth": "rythme récent des reviews connu",
    "log_followers": "followers Steam",
    "has_followers": "followers connus",
    "log_pc_delay_days": "retard de la sortie PC sur la première sortie",
    "pc_later": "sorti sur PC plus d'un mois après les consoles",
    "reviews_x_release": "reviews × année de sortie",
    "reviews_x_report": "reviews × année du chiffre",
    "launch_x_age": "pic de lancement × âge",
    "reviews_x_age": "reviews × âge",
    "reviews_x_onps": "reviews × sorti sur PlayStation",
    "log_topseller_best": "meilleur rang dans les ventes Steam",
    "has_topseller": "classé dans les ventes Steam",
    "log_followers_max": "record de followers Steam",
    "log_followers_at_release": "followers Steam le jour de la sortie",
    "has_followers_at_release": "followers de la sortie connus",
    "log_price": "prix plein Steam",
    "has_price": "prix Steam connu",
    "log_reviews_per_day": "reviews par jour depuis la sortie",
    "log_series_best": "meilleur chiffre publié d'un jeu précédent de la série",
    "has_series_best": "un jeu précédent de la série a publié un chiffre",
    "log_developer_best": "meilleur chiffre publié d'un jeu précédent du studio",
    "log_curve_position": "part de la 1re année que les voisins avaient vendue à cet âge",
    "has_curve": "courbe de vie des voisins connue",
    "matcher_sim_mean": "similarité moyenne des voisins",
    "matcher_sim_max": "similarité du voisin le plus proche",
    "matcher_ratio_spread": "désaccord des voisins sur les ventes par review",
    "has_ratio_spread": "désaccord des voisins mesurable",
    "has_developer_best": "un jeu précédent du studio a publié un chiffre",
}


def curve_position(curve: dict | None, age_days: float) -> tuple[float, bool]:
    """Part de la 1re année vendue à `age_days`, d'après la courbe des voisins.

    Interpolation en log(âge) entre les points connus ; avant 7 jours, au
    prorata de la 1re semaine ; après 2 ans, la valeur de la 2e année.
    """
    known = {k: curve.get(k) for k, _ in CURVE_POINTS} if curve else {}
    has = any(v is not None and v > 0 for v in known.values())
    pts = [(d, known[k] if known.get(k) is not None and known[k] > 0 else CURVE_DEFAULTS[k]) for k, d in CURVE_POINTS]
    age = max(age_days, 1.0)
    if age <= pts[0][0]:
        return pts[0][1] * age / pts[0][0], has
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if age <= d1:
            w = (math.log(age) - math.log(d0)) / (math.log(d1) - math.log(d0))
            return v0 + w * (v1 - v0), has
    return pts[-1][1], has


def neighbour_details(match) -> dict[str, float]:
    """Similarité et désaccord des voisins retenus par le matcher (jeu exclu)."""
    anchors = getattr(match, "anchors", None) or []
    if not anchors:
        return {"matcher_sim_mean": 0.0, "matcher_sim_max": 0.0, "matcher_ratio_spread": 0.0, "has_ratio_spread": 0.0}
    sims = np.array([s for _, s, _ in anchors])
    weights = np.array([w for _, _, w in anchors])
    return {"matcher_sim_mean": float(np.average(sims, weights=weights)) if weights.sum() > 0 else float(sims.mean()),
            "matcher_sim_max": float(sims.max()), "matcher_ratio_spread": 0.0, "has_ratio_spread": 0.0}


def is_final_test(game_id: str) -> bool:
    """Le jeu est-il dans le test final mis sous clé ? (≈ 20 % des jeux)"""
    return int(hashlib.md5(game_id.encode()).hexdigest(), 16) % FINAL_TEST_SHARE == 0


def _log1p(v) -> float:
    return math.log1p(v) if v is not None and v > 0 else 0.0


def tag_col(tag: str) -> str:
    return f"tag_{tag.replace(' ', '_').replace('-', '_')}"


def game_tags(games: pd.DataFrame, game_id: str) -> list[str]:
    """Les 10 premiers tags Steam du jeu (les plus votés), en minuscules."""
    return [t.strip().lower() for t in parse_text_array(games.loc[game_id, "steamTags"], trim=True)[:10]]


class FeatureBuilder:
    """Calcule les features d'un jeu à N'IMPORTE QUELLE date `t` (µs UTC).

    Sert à construire la table d'apprentissage (t = date du chiffre publié)
    et à faire prédire un modèle sur la frise d'un jeu (t = chaque date).
    """

    def __init__(self, snap, est: Estimator, tag_cols: list[str]):
        self.games = snap.games.set_index("id")
        self.est = est
        self.tag_cols = tag_cols
        followers = snap.followers
        self.followers = SignalStore(followers.assign(metric="STEAM_FOLLOWERS", synthetic=False)) \
            if len(followers) else None
        # Rang inversé : le plus grand « −rang » jusqu'à une date est le meilleur rang.
        ranks = snap.signals[snap.signals.metric == "STEAM_TOPSELLER_RANK"]
        self.ranks = SignalStore(ranks.assign(value=-ranks.value)) if len(ranks) else None
        self.prices = snap.prices.set_index("gameId").priceCents if len(snap.prices) else pd.Series(dtype=float)
        # Chiffres monde réels publiés, par jeu : (date en µs, ventes), pour le
        # palmarès de la série et du studio.
        ms = snap.milestones
        ms = ms[~ms.rejected & ~ms.isEngagement & ~ms.isEstimate & (ms.platform == "GLOBAL") & ms.reportedAt.notna()
                & (ms.units > 0)]
        self.figures = {gid: (d.reportedAt.map(_time_us).to_numpy(), d.units.to_numpy())
                        for gid, d in ms.sort_values("reportedAt").groupby("gameId")}
        self.release_us = {gid: _time_us(r) for gid, r in self.games.releaseDate.items()}
        self.anchors = {a.game_id: a for a in est.matcher.corpus}
        self.by_series: dict[str, list[str]] = {}
        self.by_developer: dict[str, list[str]] = {}
        for gid, g in self.games.iterrows():
            if _none(g.deletedAt) is not None:
                continue
            if isinstance(g.franchiseSlug, str) and g.franchiseSlug:
                self.by_series.setdefault(g.franchiseSlug, []).append(gid)
            if isinstance(g.developer, str) and g.developer.strip():
                self.by_developer.setdefault(g.developer.strip().lower(), []).append(gid)

    def _best_before(self, game_id: str, others: list[str], t: int) -> float | None:
        """Meilleur chiffre publié avant t par un autre jeu sorti avant celui-ci."""
        mine = self.release_us.get(game_id)
        best = None
        for o in others:
            rel = self.release_us.get(o)
            if o == game_id or o not in self.figures or (mine is not None and (rel is None or rel >= mine)):
                continue
            ts, units = self.figures[o]
            known = units[ts <= t]
            if len(known):
                best = max(best or 0, float(known.max()))
        return best

    def row(self, game_id: str, t: int) -> dict | None:
        """None si le modèle actuel n'a aucun signal à cette date (comme à l'entraînement)."""
        est, g = self.est, self.games.loc[game_id]
        e = est.estimate(game_id, t, holdout_game_id=game_id)
        if e is None or e.total is None or e.total[1] <= 0:
            return None
        p = e.profile
        reviews = est.signals.latest(game_id, "STEAM_REVIEWS", t)
        ps = est.signals.latest(game_id, "PS_RATINGS", t)
        xbox = est.signals.latest(game_id, "XBOX_RATINGS", t)
        ccu_now = est.signals.latest(game_id, "STEAM_CONCURRENT", t)
        peak_ccu = est.signals.max_between(game_id, "STEAM_CONCURRENT", 0, t)
        release = est.pc_release.get(game_id) or _time_us(g.releaseDate)
        launch_ccu = None
        if release is not None:
            start = _month_start_us(release)
            end = min(t, _month_start_us(release, LAUNCH_PEAK_CCU_WINDOW_MONTHS))
            if end > start:
                launch_ccu = est.signals.max_between(game_id, "STEAM_CONCURRENT", start, end)
        age_days = max((t - release) / US_PER_DAY, 0.0) if release is not None else 0.0
        platforms = set(_none(g.platforms) if _none(g.platforms) is not None else [])
        mode = play_mode_from_categories(parse_text_array(g.categories, trim=False))
        dlc = _none(g.dlcCount)
        mid = (e.total[0] + e.total[1]) / 2
        year = float(pd.Timestamp(t, unit="us").year)
        rv30 = est.signals.latest(game_id, "STEAM_REVIEWS", min(t, release + 30 * US_PER_DAY)) if release else None
        rv90 = est.signals.latest(game_id, "STEAM_REVIEWS", min(t, release + 90 * US_PER_DAY)) if release else None
        rv_before = est.signals.latest(game_id, "STEAM_REVIEWS", t - 90 * US_PER_DAY)
        followers = self.followers.latest(game_id, "STEAM_FOLLOWERS", t) if self.followers else None
        first_release = _time_us(g.releaseDate)
        best_rank = self.ranks.max_between(game_id, "STEAM_TOPSELLER_RANK", 0, t) if self.ranks else None
        followers_max = self.followers.max_between(game_id, "STEAM_FOLLOWERS", 0, t) if self.followers else None
        followers_release = self.followers.latest(game_id, "STEAM_FOLLOWERS", min(t, release)) \
            if self.followers and release else None
        price = self.prices.get(game_id)
        series = g.franchiseSlug if isinstance(g.franchiseSlug, str) and g.franchiseSlug else None
        developer = g.developer.strip().lower() if isinstance(g.developer, str) and g.developer.strip() else None
        match = est.match(game_id, game_id)
        curve_pos, has_curve = curve_position(match.curve if match else None, age_days)
        details = neighbour_details(match)
        if match and match.anchors:
            ratios, weights = [], []
            for gid, _, w in match.anchors:
                a = self.anchors.get(gid)
                r = a.reviews_to_units if a else None
                if r is None and a and a.global_reviews_to_units and a.platform_shares and a.platform_shares.get("pc"):
                    r = a.global_reviews_to_units * a.platform_shares["pc"]
                if r and r > 0:
                    ratios.append(math.log(r))
                    weights.append(w)
            if len(ratios) >= 2 and sum(weights) > 0:
                mean = np.average(ratios, weights=weights)
                details["matcher_ratio_spread"] = float(math.sqrt(np.average((np.array(ratios) - mean) ** 2,
                                                                                weights=weights)))
                details["has_ratio_spread"] = 1.0
        series_best = self._best_before(game_id, self.by_series.get(series, []), t) if series else None
        developer_best = self._best_before(game_id, self.by_developer.get(developer, []), t) if developer else None
        pc_delay = max((release - first_release) / US_PER_DAY, 0.0) if release and first_release else 0.0

        row = {
            # modèle actuel (référence), à la même date
            "estLow": float(e.total[0]), "estHigh": float(e.total[1]), "baselineMid": mid,
            # signaux à la date
            "log_reviews": _log1p(reviews[0] if reviews else None),
            "has_reviews": float(reviews is not None),
            "log_reviews_stale_days": _log1p((t - reviews[1]) / US_PER_DAY) if reviews else 0.0,
            "log_launch_ccu": _log1p(launch_ccu),
            "has_launch_ccu": float(bool(launch_ccu)),
            "log_peak_ccu": _log1p(peak_ccu),
            "log_ccu_now": _log1p(ccu_now[0] if ccu_now else None),
            "log_ps_ratings": _log1p(ps[0] if ps else None),
            "has_ps_ratings": float(ps is not None),
            "log_xbox_ratings": _log1p(xbox[0] if xbox else None),
            "has_xbox_ratings": float(xbox is not None),
            # temps
            "log_age_days": math.log1p(age_days),
            "release_year": float(pd.Timestamp(release, unit="us").year) if release else year,
            "report_year": year,
            # le jeu (valeurs actuelles, quasi fixes dans le temps)
            "on_ps": float("PLAYSTATION" in platforms),
            "on_xbox": float("XBOX" in platforms),
            "multiplayer": float(mode in ("MULTI", "MIXED", "COOP", "MMO")),
            "mmo": float(mode == "MMO"),
            "franchise": float(_none(g.franchiseSlug) is not None),
            "live_service": float(bool(g.liveService)),
            "annual_iteration": float(bool(g.isAnnualIteration)),
            "log_dlc": _log1p(dlc),
            "has_dlc_info": float(dlc is not None),
            # ce que le matcher a appris des jeux voisins (jeu évalué exclu)
            "log_matcher_reviews_to_units": math.log((p.pc_boxleiter_low + p.pc_boxleiter_high) / 2)
            if p and p.pc_boxleiter_low else math.log(45),
            "log_matcher_m1": math.log(p.m1) if p else math.log(2.5),
            "matcher_pc_share": p.pc_share if p else 0.5,
            # l'estimation actuelle du site, en log
            "log_baseline": math.log(max(mid, 1.0)),
            # vitesse des reviews
            "log_reviews_30d": _log1p(rv30[0] if rv30 else None),
            "log_reviews_90d": _log1p(rv90[0] if rv90 else None),
            "has_early_reviews": float(rv30 is not None),
            "log_reviews_growth_90d": _log1p(reviews[0] - rv_before[0]) if reviews and rv_before else 0.0,
            "has_reviews_growth": float(bool(reviews and rv_before)),
            # followers Steam à la date
            "log_followers": _log1p(followers[0] if followers else None),
            "has_followers": float(followers is not None),
            # sortie PC différée
            "log_pc_delay_days": math.log1p(pc_delay),
            "pc_later": float(pc_delay > 30),
            # v2 : attente et lancement
            "log_topseller_best": math.log(10_000 / -best_rank) if best_rank else 0.0,
            "has_topseller": float(best_rank is not None),
            "log_followers_max": _log1p(followers_max),
            "log_followers_at_release": _log1p(followers_release[0] if followers_release else None),
            "has_followers_at_release": float(followers_release is not None),
            "log_price": _log1p(price / 100 if price is not None and not pd.isna(price) else None),
            "has_price": float(price is not None and not pd.isna(price)),
            "log_reviews_per_day": _log1p(reviews[0] / max(age_days, 1.0) if reviews else None),
            # palmarès de la série et du studio
            "log_series_best": _log1p(series_best),
            "has_series_best": float(series_best is not None),
            "log_developer_best": _log1p(developer_best),
            "has_developer_best": float(developer_best is not None),
            # détails des voisins
            "log_curve_position": math.log(max(curve_pos, 1e-3)),
            "has_curve": float(has_curve),
            **details,
        }
        tags = {tag_col(tag) for tag in game_tags(self.games, game_id)}
        for col in self.tag_cols:
            row[col] = float(col in tags)
        row["reviews_x_release"] = row["log_reviews"] * (row["release_year"] - 2018)
        row["reviews_x_report"] = row["log_reviews"] * (row["report_year"] - 2022)
        row["launch_x_age"] = row["log_launch_ccu"] * row["log_age_days"]
        row["reviews_x_age"] = row["log_reviews"] * row["log_age_days"]
        row["reviews_x_onps"] = row["log_reviews"] * row["on_ps"]
        return row


def build_feature_table(snap, est: Estimator, res: BacktestResult) -> tuple[pd.DataFrame, list[str]]:
    """Renvoie (table, colonnes de tags). Une ligne par milestone retenu."""
    rows = res.rows
    rows = rows[rows.hasEstimate & ~rows.isEstimate & (rows.platform == "GLOBAL")].copy()
    games = snap.games.set_index("id")

    # Tags Steam les plus fréquents parmi les jeux de la table (on ne regarde
    # que les tags, jamais les chiffres de ventes : pas de fuite).
    tags_by_game = {gid: game_tags(games, gid) for gid in rows.gameId.unique()}
    counts = pd.Series([t for tags in tags_by_game.values() for t in tags if t != "indie"]).value_counts()
    top_tags = list(counts.index[:N_TAGS])
    tag_cols = [tag_col(t) for t in top_tags]
    for t, col in zip(top_tags, tag_cols):
        FEATURE_LABELS[col] = f"tag « {t} »"

    builder = FeatureBuilder(snap, est, tag_cols)
    out = []
    for r in rows.itertuples(index=False):
        feats = builder.row(r.gameId, to_us(r.reportedAt))
        out.append({
            # identifiants et étiquette
            "milestoneId": r.milestoneId, "gameId": r.gameId, "gameName": r.gameName, "source": r.source,
            "reportedAt": r.reportedAt, "units": r.units, "y": math.log(r.units),
            **feats,
        })

    table = pd.DataFrame(out)
    table["finalTest"] = table.gameId.map(is_final_test)
    return table, tag_cols

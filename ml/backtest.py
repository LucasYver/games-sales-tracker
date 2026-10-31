"""Backtest du modèle actuel sur les milestones.

Pour chaque milestone utilisable (non rejeté, hors engagement, daté) :
  1. on remonte le temps à `reportedAt` : seuls les signaux capturés avant
     cette date sont visibles ;
  2. on retire l'ancre du jeu lui-même du matcher (`holdoutGameId`) ;
  3. on recalcule l'estimation exactement comme la prod (portage validé
     par `check_parity.py`) ;
  4. on compare au chiffre déclaré.

Par défaut on n'évalue que le TOTAL : les milestones GLOBAL (chiffre monde,
toutes plateformes) comparés à la somme PC + PS + Xbox (= `estimatedToday`).
C'est la cible unique sur laquelle on compare les algorithmes. Avec
`--toutes-plateformes`, les milestones PC / PLAYSTATION / XBOX sont aussi
comparés à l'agrégat de leur plateforme (SWITCH reste non estimable).

Métriques : facteur × médian, part à ×1,5 et ×2, couverture de [low, high],
biais. Voir `metrics.py`.

Usage (depuis ml/) :
    .venv/bin/python backtest.py               # rapport + détail par milestone
    .venv/bin/python backtest.py --bootstrap 0 # plus rapide, sans IC
    .venv/bin/python backtest.py --toutes-plateformes
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from baseline import Estimator
from metrics import add_error_columns, format_table, segment_table, summarize
from snapshot import load_snapshot, released_in_scope, usable_milestones

REPORTS = Path(__file__).resolve().parent / "reports"
EPOCH = pd.Timestamp("1970-01-01", tz="UTC")
ESTIMABLE = {"GLOBAL", "PC", "PLAYSTATION", "XBOX"}


def to_us(ts: pd.Timestamp) -> int:
    return int((ts - EPOCH) // pd.Timedelta(microseconds=1))


def run(est: Estimator, milestones: pd.DataFrame, holdout: bool) -> pd.DataFrame:
    rows = []
    cache: dict[tuple[str, int], object] = {}
    for m in milestones.itertuples(index=False):
        as_of = to_us(m.reportedAt)
        key = (m.gameId, as_of)
        if key not in cache:
            cache[key] = est.estimate(m.gameId, as_of, holdout_game_id=m.gameId if holdout else None)
        e = cache[key]
        rng = e.for_platform(m.platform) if (e and m.platform in ESTIMABLE) else None
        methods = {x.method for x in e.methods} if e else set()
        pc_box = next((x for x in e.methods if x.method == "boxleiter-default"), None) if e else None
        rows.append({
            "milestoneId": m.id, "gameId": m.gameId, "gameName": m.gameName,
            "platform": m.platform, "source": m.source, "isEstimate": m.isEstimate,
            "units": m.units, "reportedAt": m.reportedAt,
            "estLow": rng[0] if rng else np.nan, "estHigh": rng[1] if rng else np.nan,
            "estimable": m.platform in ESTIMABLE,
            "hasEstimate": rng is not None and rng[1] > 0,
            "pcReviews": "boxleiter-default" in methods,
            "pcFirstWeek": "first-week-extrapolation-pc" in methods,
            "psRatings": "ps-ratings-boxleiter-default" in methods,
            "xboxRatings": "xbox-ratings-boxleiter-default" in methods,
            "pcReviewsSignalAgeDays": pc_box.detail["signalAgeDays"] if pc_box else np.nan,
            "pcBoxleiterSource": pc_box.detail["multiplierSource"] if pc_box else None,
            "matcherColdStart": e.profile.cold_start if e and e.profile else None,
        })
    return pd.DataFrame(rows)


def add_segments(df: pd.DataFrame, games: pd.DataFrame, release: dict[str, pd.Timestamp]) -> pd.DataFrame:
    g = games.set_index("id")
    rel = df.gameId.map(release).fillna(df.gameId.map(g.releaseDate))
    age_days = (df.reportedAt - rel).dt.total_seconds() / 86400
    df["ageAuReport"] = pd.cut(age_days, [-np.inf, 90, 365, 3 * 365, np.inf],
                               labels=["< 3 mois", "3-12 mois", "1-3 ans", "3 ans +"])
    df["tailleReelle"] = pd.cut(df.units, [0, 1e5, 1e6, 1e7, np.inf],
                                labels=["< 100 k", "100 k-1 M", "1-10 M", "≥ 10 M"], right=False)
    df["anneeReport"] = pd.cut(df.reportedAt.dt.year, [0, 2017, 2018, 2022, 2024, 9999],
                               labels=["≤ 2017", "2018", "2019-2022", "2023-2024", "2025+"])
    df["methodesPC"] = np.select(
        [df.pcReviews & df.pcFirstWeek, df.pcReviews, df.pcFirstWeek],
        ["reviews + 1re semaine", "reviews seules", "1re semaine seule"], "aucune méthode PC")
    df["signalConsole"] = np.where(df.psRatings | df.xboxRatings, "ratings PS/Xbox dispo", "splits seuls")
    return df


@dataclass
class BacktestResult:
    rows: pd.DataFrame       # une ligne par milestone, avec holdout (honnête)
    rows_leak: pd.DataFrame  # mêmes milestones SANS holdout (fuite), pour comparer
    n_start: int
    n_zero: int
    n_dup: int


def compute_backtest(snap, est: Estimator, platforms: set[str] | None = frozenset({"GLOBAL"})) -> BacktestResult:
    """Backtest complet ; colonnes d'erreur à NaN quand rien n'est estimable.

    `platforms` : plateformes de milestones évaluées (défaut : le total
    GLOBAL seulement ; `None` = toutes). Partagé par ce script et l'UI.
    """
    ms = usable_milestones(snap)
    ms = ms[~ms.gameDeleted & ~ms.gameIsFree].sort_values(["gameId", "reportedAt"])
    ms = ms[released_in_scope(ms.gameId.map(snap.games.set_index("id").releaseDate))]
    if platforms is not None:
        ms = ms[ms.platform.isin(platforms)]

    # Nettoyage des étiquettes (labels). Un chiffre à 0 n'est pas une vente
    # (erreur d'extraction) ; un doublon exact (même jeu, plateforme, chiffre
    # et jour, souvent repris par plusieurs médias) compterait deux fois le
    # même fait.
    n_start = len(ms)
    n_zero = int((ms.units <= 0).sum())
    ms = ms[ms.units > 0]
    dup = ms.assign(day=ms.reportedAt.dt.date).duplicated(["gameId", "platform", "units", "day"])
    n_dup = int(dup.sum())
    ms = ms[~dup]

    release = {r.gameId: r.releaseDate for r in snap.platform_release_dates.itertuples(index=False) if r.platform == "PC"}
    rows = add_error_columns(add_segments(run(est, ms, holdout=True), snap.games, release))
    rows_leak = add_error_columns(add_segments(run(est, ms, holdout=False), snap.games, release))
    return BacktestResult(rows, rows_leak, n_start, n_zero, n_dup)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap", type=int, default=500, help="rééchantillonnages pour les IC (0 = aucun)")
    parser.add_argument("--toutes-plateformes", action="store_true",
                        help="évaluer aussi les milestones PC / PS / Xbox (défaut : total GLOBAL seulement)")
    args = parser.parse_args()

    snap = load_snapshot()
    est = Estimator(snap)
    t0 = time.time()
    res = compute_backtest(snap, est, platforms=None if args.toutes_plateformes else {"GLOBAL"})
    scope_label = ("toutes plateformes" if args.toutes_plateformes
                   else "total seulement : chiffres monde (GLOBAL) vs somme PC + PS + Xbox")
    df, n_start, n_zero, n_dup = res.rows, res.n_start, res.n_zero, res.n_dup
    print(f"{len(df)} milestones backtestés ×2 en {time.time() - t0:.1f}s "
          f"({n_start} au départ, {n_zero} à 0 unité et {n_dup} doublons exacts retirés)")

    ok = df[df.hasEstimate]
    ok_leak = res.rows_leak[res.rows_leak.hasEstimate]
    actuals = ok[~ok.isEstimate]

    # ── Couverture du modèle : combien de milestones peut-il seulement estimer ?
    coverage = pd.DataFrame({
        "milestones": df.groupby("platform").size(),
        "estimable": df.groupby("platform").estimable.sum(),
        "avec estimation à date": df.groupby("platform").hasEstimate.sum(),
    })
    coverage["taux"] = (coverage["avec estimation à date"] / coverage.milestones).map(lambda v: f"{v:.0%}")

    headline = pd.DataFrame([
        {"périmètre": "tous (par milestone)", **summarize(ok, bootstrap=args.bootstrap)},
        {"périmètre": "tous (chaque jeu pèse 1)", **summarize(ok, per_game=True, bootstrap=args.bootstrap)},
        {"périmètre": "réels seulement, isEstimate=false (par milestone)", **summarize(actuals, bootstrap=args.bootstrap)},
        {"périmètre": "réels seulement (chaque jeu pèse 1)", **summarize(actuals, per_game=True, bootstrap=args.bootstrap)},
    ])
    leak_cmp = pd.DataFrame([
        {"variante": "avec holdout (honnête)", **summarize(ok)},
        {"variante": "SANS holdout (fuite : le jeu est sa propre ancre)", **summarize(ok_leak)},
    ])

    sections = [("Par plateforme", "platform")] if args.toutes_plateformes else []
    sections += [
        ("Par source × isEstimate", ["source", "isEstimate"]),
        ("Par âge du jeu au moment du chiffre", "ageAuReport"),
        ("Par taille réelle", "tailleReelle"),
        ("Par année du chiffre", "anneeReport"),
        ("Méthodes PC disponibles à date", "methodesPC"),
    ]
    worst = ok.sort_values("factor", ascending=False).head(20)[
        ["gameName", "platform", "source", "reportedAt", "units", "estLow", "estHigh", "factor"]]
    worst = worst.assign(reportedAt=worst.reportedAt.dt.date, factor=worst.factor.map(lambda v: f"×{v:.1f}"))

    lines = [
        f"# Backtest du modèle actuel (snapshot {snap.path.name}, {scope_label})\n",
        "Estimation recalculée à la date `reportedAt` de chaque milestone, ancre du jeu "
        "retirée du matcher. Estimation ponctuelle = milieu de la fourchette.\n",
        f"{n_start} milestones utilisables ({scope_label}) sur des jeux actifs et payants ; retirés : {n_zero} à 0 unité, "
        f"{n_dup} doublons exacts → {len(df)} évalués.\n",
        "## Le modèle peut-il estimer ?\n", coverage.to_markdown(), "",
        "## Résultat principal\n", format_table(headline), "",
        "`biais` < 1 = le modèle sous-estime en médiane. `sous_fourchette` = réel < low ; "
        "`au_dessus` = réel > high.\n",
        "## Effet de la fuite de données (holdout)\n", format_table(leak_cmp), "",
    ]
    for title, by in sections:
        lines += [f"## {title} (réels seulement)\n", format_table(segment_table(actuals, by, min_n=5)), ""]
    glob = actuals[actuals.platform == "GLOBAL"]
    lines += ["## Chiffres monde : signal console disponible à date ?\n", format_table(segment_table(glob, "signalConsole")), "",
              "## 20 pires cas (toutes sources)\n", worst.to_markdown(index=False)]
    text = "\n".join(lines)
    print(text)

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "backtest.md").write_text(text)
    df.to_parquet(REPORTS / "backtest_rows.parquet", index=False)
    print(f"\n→ {REPORTS / 'backtest.md'}\n→ {REPORTS / 'backtest_rows.parquet'} (une ligne par milestone)")


if __name__ == "__main__":
    main()

"""Chiffres de ventes à vérifier dans la base : une liste de travail.

Rien n'est modifié en base. Chaque ligne est un chiffre publié (milestone)
actif, avec la ou les raisons qui le rendent douteux, l'estimation des
modèles à la même date (faite sans avoir vu le jeu) et les liens vers la
source et la page admin du jeu.

Raisons :
  Sur les chiffres monde réels du banc (estimations « hors pli ») :
  - incohérent dans le temps, partiel probable, écart extrême (labels.py) ;
  - bien au-dessus de tous les modèles : plus de 4 fois l'estimation la plus
    haute (souvent un total de série, une date de chiffre fausse, ou un vrai
    succès console : à vérifier) ;
  - lancement suspect : publié 3 jours ou moins après la sortie PC et plus de
    3 fois au-dessus de tous les modèles.
  Sur tous les chiffres actifs :
  - daté dans le futur, ou plus de 30 jours avant la sortie du jeu ;
  - jeu marqué gratuit : le chiffre compte sans doute des joueurs ;
  - chiffre monde inférieur aux joueurs PC de la fuite Steam de 2018, alors
    qu'il est publié après : impossible si les deux sont justes.

Usage (depuis ml/) :
    .venv/bin/python suspects.py     → reports/milestones_a_verifier.csv et .md
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

import bench
from labels import REASONS
from snapshot import load_snapshot, usable_milestones

ADMIN_URL = "https://www.gamesalestracker.tech/admin/games/{}"
LEAK_DATE = pd.Timestamp("2018-07-01", tz="UTC")
PRIORITY = {  # 1 = à regarder d'abord
    "écart extrême": 1, "monde < fuite PC": 1, "daté dans le futur": 1, "jeu gratuit": 1,
    "partiel probable": 2, "bien au-dessus des modèles": 2, "lancement suspect": 2,
    "incohérent dans le temps": 3, "avant la sortie": 3,
}
REASON_LABELS = {REASONS["temps"]: "incohérent dans le temps", REASONS["partiel"]: "partiel probable",
                 REASONS["extrême"]: "écart extrême"}


def review_list(snap, b) -> pd.DataFrame:
    games = snap.games.set_index("id")
    ms = usable_milestones(snap)
    ms = ms[~ms.gameDeleted]
    reasons: dict[str, list[str]] = {}

    def flag(ids, reason: str) -> None:
        for i in ids:
            reasons.setdefault(i, []).append(reason)

    # Estimations hors pli des modèles, par chiffre du banc.
    preds = b.cv_preds.pivot_table(index="milestoneId", columns="model", values="estPoint")
    learned = preds.drop(columns=["Modèle actuel"], errors="ignore")
    t = b.table.set_index("milestoneId")
    for mid, r in t[t.suspect].iterrows():
        flag([mid], REASON_LABELS.get(r.suspectReason, r.suspectReason))
    above = t.units > 4 * preds.max(axis=1).reindex(t.index)
    flag(t.index[above & ~t.suspect], "bien au-dessus des modèles")
    early = np.expm1(t.log_age_days) <= 3
    flag(t.index[early & (t.units > 3 * learned.max(axis=1).reindex(t.index))], "lancement suspect")

    # Règles sur tous les chiffres actifs.
    exported = pd.Timestamp(json.loads((snap.path / "manifest.json").read_text())["exportedAt"])
    flag(ms.id[ms.reportedAt > exported], "daté dans le futur")
    release = pd.to_datetime(ms.gameId.map(games.releaseDate), utc=True)
    flag(ms.id[release.notna() & (ms.reportedAt < release - pd.Timedelta(days=30))], "avant la sortie")
    flag(ms.id[ms.gameIsFree.astype(bool)], "jeu gratuit")
    leak = ms[ms.source == "STEAM_LEAK"].groupby("gameId").units.max()
    glob = ms[(ms.platform == "GLOBAL") & (ms.reportedAt >= LEAK_DATE)]
    flag(glob.id[glob.units < glob.gameId.map(leak)], "monde < fuite PC")

    rows = ms[ms.id.isin(reasons)].copy()
    if rows.empty:
        return pd.DataFrame()
    rows["raisons"] = rows.id.map(lambda i: " ; ".join(sorted(set(reasons[i]), key=lambda x: PRIORITY.get(x, 9))))
    rows["priorité"] = rows.id.map(lambda i: min(PRIORITY.get(x, 9) for x in reasons[i]))
    ml = preds.get(bench.PROD_MODEL, pd.Series(dtype=float))
    site = preds.get("Modèle actuel", pd.Series(dtype=float))
    rows["estimation ML"] = rows.id.map(ml)
    rows["estimation site"] = rows.id.map(site)
    rows["écart ML"] = rows.units / rows["estimation ML"]
    order = rows["écart ML"].map(lambda v: -abs(math.log(v)) if pd.notna(v) and v > 0 else 0.0)
    rows = rows.assign(_o=order).sort_values(["priorité", "_o", "gameName"])
    return pd.DataFrame({
        "priorité": rows["priorité"], "raisons": rows.raisons, "jeu": rows.gameName,
        "plateforme": rows.platform, "date": rows.reportedAt.dt.date, "chiffre": rows.units,
        "estimation ML": rows["estimation ML"].round(-3), "estimation site": rows["estimation site"].round(-3),
        "chiffre ÷ ML": rows["écart ML"].round(2), "source": rows.source,
        "estimé par la source": rows.isEstimate, "lien source": rows.sourceUrl,
        "page admin": rows.gameId.map(ADMIN_URL.format), "milestoneId": rows.id,
    }).reset_index(drop=True)


def write_report(snap, b) -> pd.DataFrame:
    review = review_list(snap, b)
    bench.REPORTS.mkdir(exist_ok=True)
    review.to_csv(bench.REPORTS / "milestones_a_verifier.csv", index=False)
    counts = review.raisons.str.split(" ; ").explode().value_counts() if len(review) else pd.Series(dtype=int)
    lines = [f"# Chiffres à vérifier — snapshot {snap.path.name}\n",
             f"{len(review)} chiffres actifs à regarder (rien n'est modifié en base). Liste complète : "
             "`reports/milestones_a_verifier.csv`.\n",
             "## Par raison\n", counts.rename("chiffres").to_markdown(), "",
             "## Priorité 1\n",
             review[review.priorité == 1].drop(columns=["milestoneId", "lien source", "page admin"])
             .to_markdown(index=False) if len(review) else "Aucun.", ""]
    (bench.REPORTS / "milestones_a_verifier.md").write_text("\n".join(lines))
    return review


def main() -> None:
    snap = load_snapshot()
    b = bench.load_saved_bench(snap.path.name)
    if b is None:
        raise SystemExit("Lancer d'abord bench.py sur ce snapshot.")
    review = write_report(snap, b)
    print(review.raisons.str.split(" ; ").explode().value_counts().to_string())
    print(f"\n{len(review)} chiffres à vérifier → {bench.REPORTS / 'milestones_a_verifier.csv'}")


if __name__ == "__main__":
    main()

"""Test neutre : les modèles figés, jugés sur des chiffres publiés APRÈS leur gel.

Le banc d'essai a servi à choisir : ses scores sont un peu flatteurs. Ici,
rien n'est choisi ni réentraîné. Les modèles de `models/<date>/` ont été figés
avant que ces chiffres n'arrivent dans la base : c'est l'examen le plus
honnête possible.

Deux groupes de chiffres sont jugés :
  - tous les nouveaux chiffres (le modèle a parfois vu d'anciens chiffres du
    même jeu : un peu plus facile) ;
  - les chiffres de jeux jamais vus à l'entraînement (le cas le plus dur).

Comme au banc : chiffres monde (GLOBAL) réels, sans 0 ni doublon, et
seulement là où le site donne une estimation à la date du chiffre.

Usage (depuis ml/) :
    # 1. nouveau snapshot, rangé à part pour ne pas changer celui de l'UI
    .venv/bin/python export_snapshot.py --out data/neutral/$(date +%F)
    # 2. le test
    .venv/bin/python prospective_test.py
    .venv/bin/python prospective_test.py --models models/2026-10-27 --snapshot data/neutral/2027-02-01
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

import bench
from backtest import to_us
from baseline import Estimator
from features import FeatureBuilder
from frozen import MODELS, FrozenEnsemble, FrozenForestKnn
from metrics import add_error_columns, format_table, summarize
from snapshot import DATA_DIR, load_snapshot, released_in_scope, usable_milestones

NEUTRAL_DIR = DATA_DIR / "neutral"
REPORTS = Path(__file__).resolve().parent / "reports"
BOOTSTRAP = 500
MIN_FIGURES = 30  # en dessous, le verdict tient surtout du hasard


def new_figures(snap, training: dict) -> pd.DataFrame:
    """Chiffres monde réels absents de la base au moment du gel."""
    ms = usable_milestones(snap)
    ms = ms[~ms.gameDeleted & ~ms.gameIsFree & (ms.platform == "GLOBAL") & ~ms.isEstimate & (ms.units > 0)]
    ms = ms[released_in_scope(ms.gameId.map(snap.games.set_index("id").releaseDate))]
    # Doublon d'un chiffre déjà connu (même jeu, chiffre et jour) : même fait, déjà vu.
    ms = ms.sort_values(["gameId", "reportedAt", "capturedAt"])
    ms = ms[~ms.assign(day=ms.reportedAt.dt.date).duplicated(["gameId", "units", "day"])]
    return ms[~ms.id.isin(set(training["snapshotMilestoneIds"]))]


def predictions(snap, ensemble: FrozenEnsemble, knn: FrozenForestKnn, figures: pd.DataFrame) -> pd.DataFrame:
    est = Estimator(snap)
    builder = FeatureBuilder(snap, est, [t["column"] for t in ensemble.tags])
    bench.set_similarity(est)
    rows = []
    for m in figures.itertuples(index=False):
        feats = builder.row(m.gameId, to_us(m.reportedAt))
        if feats is not None:
            rows.append({"milestoneId": m.id, "gameId": m.gameId, "gameName": m.gameName, "source": m.source,
                         "reportedAt": m.reportedAt, "units": m.units, **feats})
    table = pd.DataFrame(rows)
    if table.empty:
        return table
    keep = ["milestoneId", "gameId", "gameName", "source", "reportedAt", "units"]
    site = table[keep].assign(model="Modèle actuel", estLow=table.estLow, estHigh=table.estHigh,
                              estPoint=table.baselineMid)
    out = [site]
    for name, pred in ((ensemble.name, ensemble.predict(table)),
                       (knn.name, knn.predict(table, bench.SIMILARITY))):
        out.append(table[keep].assign(model=name, estLow=pred.low, estHigh=pred.high, estPoint=pred.point))
    return add_error_columns(pd.concat(out, ignore_index=True))


def score(preds: pd.DataFrame) -> pd.DataFrame:
    base = preds[preds.model == "Modèle actuel"].set_index("milestoneId")
    rows = []
    for name, df in preds.groupby("model", sort=False):
        s = summarize(df, bootstrap=BOOTSTRAP, seed=bench.SEED)
        if name != "Modèle actuel":
            s["proba_meilleur_que_le_site"] = bench.paired_gain(base, df.set_index("milestoneId"), BOOTSTRAP)[
                "proba_meilleur"]
        rows.append({"modèle": name, **s})
    t = pd.DataFrame(rows)
    keep = ["modèle", "n", "jeux", "facteur_median", "part_x1_5", "part_x2", "couverture", "biais",
            "proba_meilleur_que_le_site"]
    t = t[[c for c in keep if c in t.columns]]
    if "proba_meilleur_que_le_site" in t:
        t["proba_meilleur_que_le_site"] = t.proba_meilleur_que_le_site.map(
            lambda v: "" if pd.isna(v) else f"{v:.0%}")
    return t


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, default=None, help="dossier des modèles figés (défaut : le plus récent)")
    parser.add_argument("--snapshot", type=Path, default=None,
                        help="snapshot récent (défaut : le plus récent de data/neutral/)")
    args = parser.parse_args()

    models = args.models or sorted(p for p in MODELS.iterdir() if p.is_dir())[-1]
    training = json.loads((models / "training.json").read_text())
    path = args.snapshot or (sorted(NEUTRAL_DIR.iterdir())[-1] if NEUTRAL_DIR.exists() else None)
    if path is None:
        raise SystemExit("Aucun snapshot récent : lancer d'abord "
                         "`.venv/bin/python export_snapshot.py --out data/neutral/$(date +%F)`.")
    snap = load_snapshot(path)
    manifest = json.loads((path / "manifest.json").read_text())
    if manifest["exportedAt"] <= training["snapshotExportedAt"]:
        raise SystemExit(f"Le snapshot {path.name} n'est pas plus récent que le gel des modèles ({models.name}).")

    ensemble = FrozenEnsemble.load(models / "ensemble.json")
    knn = FrozenForestKnn.load(ensemble, models / "forest_knn.json")
    figures = new_figures(snap, training)
    preds = predictions(snap, ensemble, knn, figures)
    seen = set(training["trainingGameIds"])

    lines = [f"# Test neutre — modèles figés le {models.name}, jugés sur le snapshot {path.name}\n",
             f"{len(figures)} chiffres monde réels arrivés dans la base depuis le gel ; "
             f"{preds.milestoneId.nunique() if len(preds) else 0} estimables à leur date.\n"]
    if preds.empty:
        lines.append("Aucun chiffre à juger pour l'instant : revenir quand de nouveaux chiffres seront publiés.")
    else:
        groups = {"Tous les nouveaux chiffres": preds,
                  "Jeux jamais vus à l'entraînement": preds[~preds.gameId.isin(seen)]}
        for title, df in groups.items():
            n = df.milestoneId.nunique()
            lines.append(f"## {title} ({n} chiffres, {df.gameId.nunique()} jeux)\n")
            if n == 0:
                lines.append("Aucun pour l'instant.\n")
                continue
            if n < MIN_FIGURES:
                lines.append(f"⚠️ Moins de {MIN_FIGURES} chiffres : le classement peut encore changer par hasard.\n")
            lines += [format_table(score(df)), ""]
        detail = preds.pivot_table(index=["gameName", "reportedAt", "units"], columns="model", values="estPoint")
        detail = detail.reset_index().assign(reportedAt=lambda d: d.reportedAt.dt.date)
        lines += ["## Détail\n", detail.round(0).to_markdown(index=False, floatfmt=",.0f"), ""]
    text = "\n".join(lines)
    print(text)
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"prospective_{models.name}_vs_{path.name}.md"
    out.write_text(text)
    print(f"→ {out}")


if __name__ == "__main__":
    main()

"""La fuite Steam peut-elle servir à entraîner le modèle ?

Depuis le 04/11, un chiffre PC ou PlayStation d'un jeu qui n'existe que sur
cette plateforme compte comme chiffre monde (`snapshot.as_worldwide`) : il fait
partie du banc. Reste la fuite Steam de juillet 2018 : des joueurs, pas des
ventes, mais proches des ventes sur les rares jeux qui ont les deux chiffres.
Ce banc mesure ce qu'elle apporte, pour les jeux PC seuls :

  A. Actuel : les chiffres monde du banc (mono-plateforme compris).
  B. + fuite Steam : A + les joueurs de la fuite des jeux PC seuls.
  C. + fuite Steam marquée : B, avec une information « ce chiffre vient de la
     fuite » ; à la prédiction, le modèle la met toujours à non.

Même protocole que `exclusions.py` : mêmes plis (par jeu) pour toutes les
variantes, jugées sur exactement les mêmes chiffres. Un seul découpage en plis
peut tromper (écarts de ±0,02 sur l'erreur typique) : on en fait plusieurs et
on compte ceux où la variante bat A. Jugements :
  - les chiffres monde publiés (le juge principal), dont les mono-plateforme à part ;
  - les joueurs de la fuite, pour information : c'est là que la fuite pèse.

Seul l'ENTRAÎNEMENT change : les informations des jeux (palmarès de la série et
du studio compris) restent celles du banc. La base et le site ne changent pas.

Usage (depuis ml/, après `bench.py` sur le même snapshot) :
    .venv/bin/python bench_labels.py   → reports/bench_labels.md + bench_labels.pkl (lu par l'UI)
"""

from __future__ import annotations

import argparse
import math
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import bench
from backtest import to_us
from baseline import Estimator
from bench import ML_MODEL, N_FOLDS, SEED, TIME_CUTOFF, ModelSpec, _fit_core, paired_gain
from features import FeatureBuilder, is_final_test
from labels import flag_suspects
from snapshot import NOT_WORLDWIDE_SOURCES, _single_platform, load_snapshot, released_in_scope, usable_milestones

REPORTS = Path(__file__).resolve().parent / "reports"
SAVED = REPORTS / "bench_labels.pkl"
LEAK_FLAG = "label_leak"
BOOTSTRAP = 1000
SPLIT_SEEDS = [SEED, 1, 2, 3, 4, 5, 6, 7]

MONDE, MONO, FUITE = "monde", "mono-plateforme", "fuite Steam"
VARIANTS = {
    "A. Actuel": {MONDE},
    "B. + fuite Steam": {MONDE, FUITE},
    "C. + fuite Steam marquée": {MONDE, FUITE},
}
FLAGGED = "C. + fuite Steam marquée"
BASE = "A. Actuel"
JUDGED = {MONDE: "Chiffres monde publiés (juge principal)",
          MONO: "Dont chiffres mono-plateforme",
          FUITE: "Joueurs de la fuite Steam (pour information)"}
SIZE_BINS = [0, 1e5, 1e6, 1e7, np.inf]
SIZE_LABELS = ["< 100 k", "100 k-1 M", "1-10 M", "≥ 10 M"]


def leak_figures(snap, dev: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Joueurs de la fuite Steam des jeux qui n'existent que sur PC."""
    games = snap.games.set_index("id")
    ms = usable_milestones(snap)
    ms = ms[~ms.gameDeleted & ~ms.gameIsFree & ~ms.isEstimate & (ms.units > 0)
            & ms.source.isin(NOT_WORLDWIDE_SOURCES)]
    ms = ms[released_in_scope(ms.gameId.map(games.releaseDate)).to_numpy()]
    counts = {"chiffres de la fuite (jeux sortis depuis 2017)": len(ms)}
    only = ms.gameId.map(lambda g: _single_platform(games.platforms.get(g)))
    ms = ms[(ms.platform == only).to_numpy()].copy()
    counts["sur un jeu PC seul"] = len(ms)
    known = set(zip(dev.gameId, dev.units, dev.reportedAt.dt.date))
    ms = ms[[k not in known for k in zip(ms.gameId, ms.units, ms.reportedAt.dt.date)]]
    ms["labelSource"] = FUITE
    return ms, counts


def feature_rows(snap, est: Estimator, ms: pd.DataFrame, tag_cols: list[str]) -> pd.DataFrame:
    """Une ligne par chiffre, avec les mêmes informations que le banc à sa date."""
    builder = FeatureBuilder(snap, est, tag_cols)
    out = []
    for r in ms.itertuples(index=False):
        feats = builder.row(r.gameId, to_us(r.reportedAt))
        if feats is None:
            continue  # aucun signal à cette date : le banc écarte aussi ces chiffres
        out.append({"milestoneId": r.id, "gameId": r.gameId, "gameName": r.gameName, "source": r.source,
                    "reportedAt": r.reportedAt, "units": r.units, "y": math.log(r.units),
                    "labelSource": r.labelSource, **feats})
    table = pd.DataFrame(out)
    table["finalTest"] = table.gameId.map(is_final_test)
    table["t_us"] = table.reportedAt.map(to_us)
    return table


def flagged_spec(spec: ModelSpec) -> ModelSpec:
    """Le modèle en prod avec, en plus, l'information « chiffre de la fuite »."""
    members = [ModelSpec(m.name, "", m.kind, m.features + [LEAK_FLAG]) for m in spec.members]
    return ModelSpec(FLAGGED, "", spec.kind, members=members)


def predict_variants(specs: dict[str, ModelSpec], train: pd.DataFrame, test: pd.DataFrame) -> dict[str, np.ndarray]:
    clean = train[~train.suspect]
    test0 = test.assign(**{LEAK_FLAG: 0.0})  # on prédit toujours des ventes, jamais des joueurs
    return {name: _fit_core(specs[name], clean[clean.labelSource.isin(sources)], None)[0](test0) - test.y.to_numpy()
            for name, sources in VARIANTS.items()}


def cross_validate(specs, union: pd.DataFrame, seed: int) -> dict[str, np.ndarray]:
    err = {name: np.full(len(union), np.nan) for name in VARIANTS}
    for tr, te in GroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=seed).split(union, groups=union.gameId):
        for name, e in predict_variants(specs, union.iloc[tr], union.iloc[te]).items():
            err[name][te] = e
    return err


def typical(e: np.ndarray) -> float:
    return math.exp(np.median(np.abs(e)))


def summarize_errors(err: dict[str, np.ndarray], table: pd.DataFrame, mask: np.ndarray,
                     per_split: list[dict[str, np.ndarray]] | None = None) -> pd.DataFrame:
    """Une ligne par variante. `per_split` : les erreurs des autres découpages en plis."""
    frames = {k: pd.DataFrame({"gameId": table.gameId[mask].to_numpy(), "logErr": v[mask]},
                              index=table.milestoneId[mask].to_numpy()) for k, v in err.items()}
    rows = []
    for name, f in frames.items():
        row = {"variante": name, "chiffres": len(f), "jeux": f.gameId.nunique(),
               "facteur": typical(f.logErr.to_numpy()),
               "part_x2": float((f.logErr.abs() <= math.log(2)).mean()),
               "biais": math.exp(f.logErr.median())}
        if per_split:
            row["facteur"] = float(np.mean([typical(s[name][mask]) for s in per_split]))
            row["decoupages_gagnes"] = (np.nan if name == BASE else
                                        sum(typical(s[name][mask]) < typical(s[BASE][mask]) for s in per_split))
        row["mieux_que_A"] = np.nan if name == BASE else paired_gain(frames[BASE], f, BOOTSTRAP)["proba_meilleur"]
        rows.append(row)
    return pd.DataFrame(rows)


def by_size(err: dict[str, np.ndarray], table: pd.DataFrame, mask: np.ndarray) -> pd.DataFrame:
    size = pd.cut(table.units, SIZE_BINS, labels=SIZE_LABELS, right=False).to_numpy()
    rows = []
    for name, v in err.items():
        row = {"variante": name}
        for label in SIZE_LABELS:
            m = mask & (size == label)
            row[label] = typical(v[m]) if m.any() else np.nan
        rows.append(row)
    counts = {label: int((mask & (size == label)).sum()) for label in SIZE_LABELS}
    return pd.DataFrame(rows).rename(columns={k: f"{k} ({n})" for k, n in counts.items()})


def md_table(df: pd.DataFrame) -> str:
    t = df.copy()
    for col in t.columns:
        if col in ("part_x2", "mieux_que_A"):
            t[col] = t[col].map(lambda v: "" if pd.isna(v) else f"{v:.0%}")
        elif col == "decoupages_gagnes":
            t[col] = t[col].map(lambda v: "" if pd.isna(v) else f"{v:.0f}/{len(SPLIT_SEEDS)}")
        elif col in ("facteur", "biais") or col.startswith(tuple(SIZE_LABELS)):
            t[col] = t[col].map(lambda v: "" if pd.isna(v) else f"×{v:.3f}")
    return t.to_markdown(index=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", default=None, help="dossier de snapshot (défaut : le dernier de data/)")
    args = parser.parse_args()
    t0 = time.time()
    snap = load_snapshot(args.snapshot)
    b = bench.load_saved_bench(snap.path.name)
    if b is None:
        raise SystemExit("Lancer d'abord bench.py sur ce snapshot.")
    est = Estimator(snap)
    by_name = {s.name: s for s in b.specs}
    prod = by_name[ML_MODEL]
    tag_cols = sorted({f for m in prod.members for f in m.features if f.startswith("tag_")})
    dev = b.table.reset_index(drop=True).assign(labelSource=MONDE)
    ms = usable_milestones(snap)
    mono_ids = set(ms.id[ms.platform != ms.reportedPlatform])

    leak, counts = leak_figures(snap, dev)
    extras = feature_rows(snap, est, leak, tag_cols)
    counts["avec signaux à leur date"] = len(extras)
    counts["chiffres monde du banc, dont mono-plateforme"] = int(dev.milestoneId.isin(mono_ids).sum())
    print(f"{len(extras)} chiffres de la fuite ({time.time() - t0:.0f} s)")

    # Chiffres suspects de la fuite : même règle que le banc, calculée sur
    # l'ensemble ; ceux du banc gardent leur marque.
    union = pd.concat([dev, extras], ignore_index=True)
    flags = flag_suspects(union, [by_name["Forêt aléatoire"], by_name["Linéaire + interactions"]], SEED)
    is_extra = (union.labelSource != MONDE).to_numpy()
    union.loc[is_extra, "suspect"] = flags.suspect[is_extra].to_numpy()
    union.loc[is_extra, "suspectReason"] = flags.suspectReason[is_extra].to_numpy()
    union["suspect"] = union.suspect.astype(bool)
    union[LEAK_FLAG] = (union.labelSource == FUITE).astype(float)
    counts["écartés comme suspects"] = int((union.suspect & is_extra).sum())

    specs = {name: prod for name in VARIANTS} | {FLAGGED: flagged_spec(prod)}
    splits = []
    for seed in SPLIT_SEEDS:
        splits.append(cross_validate(specs, union, seed))
        print(f"découpage {len(splits)}/{len(SPLIT_SEEDS)} ({time.time() - t0:.0f} s)")
    cv_err = splits[0]

    train = union[union.reportedAt < TIME_CUTOFF]
    test_mask = ((union.reportedAt >= TIME_CUTOFF) & ~union.gameId.isin(set(train.gameId))).to_numpy()
    tm_err = {name: np.full(len(union), np.nan) for name in VARIANTS}
    for name, e in predict_variants(specs, train, union[test_mask]).items():
        tm_err[name][test_mask] = e

    clean = ~union.suspect.to_numpy()
    monde = clean & (union.labelSource == MONDE).to_numpy()
    judged = {MONDE: monde, MONO: monde & union.milestoneId.isin(mono_ids).to_numpy(),
              FUITE: clean & is_extra}
    result = {
        "snapshot": snap.path.name,
        "splits": len(SPLIT_SEEDS),
        "counts": counts,
        "cv": {k: summarize_errors(cv_err, union, m, splits) for k, m in judged.items() if m.any()},
        "temporal": {k: summarize_errors(tm_err, union, m & test_mask)
                     for k, m in judged.items() if k != FUITE and (m & test_mask).any()},
        "by_size": by_size(cv_err, union, monde),
        "extras": union[is_extra][["gameName", "units", "reportedAt", "suspect", "suspectReason"]]
        .assign(estimation_A=np.exp(union.y[is_extra] + cv_err[BASE][is_extra])).reset_index(drop=True),
    }
    SAVED.write_bytes(pickle.dumps(result))

    lines = [f"# La fuite Steam à l'entraînement (snapshot {snap.path.name})", "",
             "Le modèle en prod, entraîné avec ou sans les joueurs de la fuite des jeux PC seuls, jugé sur les "
             f"mêmes chiffres (non suspects). Validation croisée : erreur typique moyenne sur {len(SPLIT_SEEDS)} "
             "découpages en plis, et nombre de découpages où la variante bat A.", "",
             "| étape | nombre |", "|:--|--:|", *[f"| {k} | {v} |" for k, v in counts.items()], ""]
    for title, part in (("Validation croisée", result["cv"]), ("Test dans le temps (2025+)", result["temporal"])):
        for k, df in part.items():
            lines += [f"## {title} : {JUDGED[k]}", "", md_table(df), ""]
    lines += ["## Validation croisée, chiffres monde, erreur typique selon la taille réelle", "",
              md_table(result["by_size"]), ""]
    out = REPORTS / "bench_labels.md"
    out.write_text("\n".join(lines))
    print(f"→ {out} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()

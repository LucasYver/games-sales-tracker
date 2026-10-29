"""Étape 0 : combien de milestones utilisables a-t-on, et de quel type ?

Utilisable = non rejeté, pas un chiffre d'« engagement » (joueurs Game Pass…),
et daté (`reportedAt`). Avant tout ML, on regarde la quantité et la nature
des étiquettes (labels) : c'est ce qui limite tout le reste.

Usage (depuis ml/) :
    .venv/bin/python count_milestones.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from snapshot import load_snapshot, usable_milestones

REPORTS = Path(__file__).resolve().parent / "reports"


def main() -> None:
    snap = load_snapshot()
    all_m = snap.milestones
    m = usable_milestones(snap)

    funnel = pd.Series({
        "milestones (total)": len(all_m),
        "non rejetés": int((~all_m.rejected).sum()),
        "… et hors engagement": int((~all_m.rejected & ~all_m.isEngagement).sum()),
        "… et datés (= utilisables)": len(m),
        "… sur un jeu actif et payant": int((~m.gameDeleted & ~m.gameIsFree).sum()),
    })

    by_psi = (
        m.groupby(["platform", "source", "isEstimate"])
        .agg(milestones=("id", "size"), jeux=("gameId", "nunique"),
             premier=("reportedAt", "min"), dernier=("reportedAt", "max"))
        .reset_index()
    )
    by_psi["premier"] = by_psi.premier.dt.date
    by_psi["dernier"] = by_psi.dernier.dt.date

    by_platform = m.groupby("platform").agg(milestones=("id", "size"), jeux=("gameId", "nunique")) \
        .sort_values("milestones", ascending=False)
    by_source = m.groupby(["source", "isEstimate"]).agg(milestones=("id", "size"), jeux=("gameId", "nunique"))
    per_game = m.groupby("gameId").size()

    out = [
        f"# Étape 0 — milestones utilisables (snapshot {snap.path.name})\n",
        "## Entonnoir\n", funnel.to_frame("n").to_markdown(), "",
        "## Par plateforme × source × isEstimate\n", by_psi.to_markdown(index=False), "",
        "## Par plateforme\n", by_platform.to_markdown(), "",
        "## Par source\n", by_source.to_markdown(), "",
        "## Milestones par jeu\n",
        f"{per_game.size} jeux ; médiane {per_game.median():.0f} milestone(s) par jeu ; "
        f"max {per_game.max()} ; {int((per_game == 1).sum())} jeux n'en ont qu'un.", "",
        "Rappel : le modèle n'estime que PC, PlayStation et Xbox. Les milestones SWITCH "
        "ne sont pas comparables, et un GLOBAL inclut des ventes Switch/mobile que le "
        "modèle ne voit pas.",
    ]
    text = "\n".join(out)
    print(text)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "step0_milestones.md").write_text(text)
    print(f"\n→ {REPORTS / 'step0_milestones.md'}")


if __name__ == "__main__":
    main()

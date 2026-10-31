"""Audit hebdomadaire des milestones récemment récupérés (LECTURE SEULE).

Pour chaque milestone non rejeté capturé depuis `--depuis` (par défaut les
7 derniers jours), affiche l'historique du jeu et lève des drapeaux :
citation sans le chiffre, joueurs / Game Pass, estimation présentée comme
réelle, chiffre régional, relais ancien re-daté, incohérence avec les autres
milestones, source auto-créée, écart avec l'estimation du site.

Les drapeaux ne sont que des pistes : chaque cas signalé doit être vérifié à
la source avant de rejeter quoi que ce soit. Ce script n'écrit jamais en base.

Sortie : stdout + `reports/audit_milestones_<date>.txt`.
"""

from __future__ import annotations

import argparse
import re
from contextlib import redirect_stdout
from datetime import date, timedelta
from io import StringIO
from pathlib import Path

import pandas as pd

from db import connect_read_only

REPORTS = Path(__file__).resolve().parent / "reports"

NUM_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(million|millions|m\b|k\b|thousand|billion)?", re.I)
ENGAGEMENT_RE = re.compile(r"\b(players?|joueurs|wishlists?|game pass|subscri\w*|downloads?|téléchargements|accounts|registered|claims?|acquired)\b", re.I)
ESTIMATE_RE = re.compile(r"\b(estimat\w*|approximate|reportedly|according to (?:steamdb|gamalytic|vg ?insights))\b", re.I)
ALINEA_RE = re.compile(r"alinea|aliena|rhys\s*elliott?|\belliott?\b", re.I)  # jamais isEstimate : skill alinea-milestones
REGIONAL_RE = re.compile(r"\b(japan|japanese|famitsu|media create|uk boxed|gfk|circana|npd|in the us|europe)\b|jap-sales", re.I)
STALE_DAYS = 14


def host_of(url: str | None) -> str:
    if not url:
        return ""
    h = re.sub(r"^https?://([^@/]+@)?", "", url.lower()).split("/")[0].split(":")[0]
    return re.sub(r"^www\.", "", h)


def quote_numbers(note: str | None) -> set[int]:
    out = set()
    for n, unit in NUM_RE.findall(note or ""):
        try:
            v = float(n.replace(",", "")) if not unit else float(n.replace(",", "."))
        except ValueError:
            continue
        u = unit.lower()
        mult = 1e6 if u.startswith("m") else 1e3 if u in ("k", "thousand") else 1e9 if u == "billion" else 1
        out.add(round(v * mult))
    return out


def load(since: str):
    with connect_read_only() as c:
        new = pd.read_sql(
            """SELECT m.id, m."gameId", g.name, g."releaseDate"::date rel, g.platforms, m.platform, m.source,
                      m."isEstimate", m."isEngagement", m.units, m."reportedAt"::date rep, m."sourceUrl", m.note, m.publisher
                 FROM milestone m JOIN game g ON g.id = m."gameId"
                WHERE m."capturedAt" >= %s AND m."rejectedAt" IS NULL AND g."deletedAt" IS NULL
                ORDER BY g.name, m."reportedAt" """,
            c, params=(since,))
        # pandas renvoie NaN pour un texte NULL, et NaN est vrai pour `if not url`.
        texts = ["sourceUrl", "note", "publisher"]
        new[texts] = new[texts].astype(object).where(new[texts].notna(), None)
        new["id"] = new.id.astype(str)
        new["gameId"] = new.gameId.astype(str)
        ids = list(new.gameId.unique())
        hist = pd.read_sql(
            """SELECT m.id, m."gameId", m.platform, m.source, m.units, m."reportedAt"::date rep,
                      m."isEstimate", m."isEngagement", m."capturedAt"::date cap, m."sourceUrl"
                 FROM milestone m
                WHERE m."rejectedAt" IS NULL AND m."gameId"::text = ANY(%s)
                ORDER BY m."reportedAt" """,
            c, params=(ids,))
        sources = pd.read_sql("""SELECT host, name, "salesSource", active, "autoCreated" FROM trusted_source WHERE host IS NOT NULL""", c)
        est = pd.read_sql(
            """SELECT DISTINCT ON ("gameId") "gameId", "estimatedTodayLow" lo, "estimatedTodayHigh" hi
                 FROM estimate_snapshot WHERE "gameId"::text = ANY(%s)
                ORDER BY "gameId", "computedAt" DESC""",
            c, params=(ids,))
        prd = pd.read_sql(
            """SELECT "gameId", platform, "releaseDate"::date rel FROM game_platform_release_date
                WHERE "gameId"::text = ANY(%s)""",
            c, params=(ids,))
    hist["id"] = hist.id.astype(str)
    hist["gameId"] = hist.gameId.astype(str)
    hist["host"] = hist.sourceUrl.astype(object).where(hist.sourceUrl.notna(), None).map(host_of)
    est["gameId"] = est.gameId.astype(str)
    prd["gameId"] = prd.gameId.astype(str)
    return new, hist, sources, est.set_index("gameId"), prd


def flags_for(m, r0, same, source, e, earliest_rel) -> list[str]:
    flags = []
    if not m.sourceUrl:
        flags.append("SANS_URL")
    elif source is None:
        flags.append("SOURCE_HORS_REGISTRE")
    else:
        if source["autoCreated"]:
            flags.append("SOURCE_AUTO_CREEE")
        if not source["active"]:
            flags.append("SOURCE_INACTIVE")
    if not m.note:
        flags.append("SANS_CITATION")
    elif not any(abs(x - m.units) <= max(0.02 * m.units, 1) for x in quote_numbers(m.note)):
        flags.append("CHIFFRE_ABSENT_CITATION")
    if m.note and ENGAGEMENT_RE.search(m.note) and not m.isEngagement:
        flags.append("JOUEURS_OU_GAME_PASS?")
    alinea = ALINEA_RE.search(" ".join(filter(None, (m.publisher, m.note, m.sourceUrl))))
    if alinea and m.isEstimate:
        flags.append("ALINEA_A_DEMARQUER")
    if m.note and ESTIMATE_RE.search(m.note) and not m.isEstimate and not alinea:
        flags.append("ESTIMATION_PRESENTEE_COMME_REELLE?")
    if (m.note and REGIONAL_RE.search(m.note)) or REGIONAL_RE.search(m.sourceUrl or ""):
        flags.append("CHIFFRE_REGIONAL?")
    if m.rep and r0.rel and m.rep < r0.rel:
        flags.append("AVANT_SORTIE")
    if m.rep and m.rep > date.today():
        flags.append("DATE_FUTURE")
    if m.rep and earliest_rel and r0.rel and earliest_rel < r0.rel - timedelta(days=180):
        flags.append(f"DATE_SORTIE_JEU_TARDIVE(plateforme {earliest_rel})")
    real = same[~same.isEngagement]
    higher_before = real[(real.rep < m.rep) & (real.units > m.units * 1.02)]
    lower_after = real[(real.rep > m.rep) & (real.units < m.units * 0.98)]
    if len(higher_before):
        flags.append(f"PLUS_BAS_QU_AVANT({higher_before.units.max():,})")
    if len(lower_after):
        flags.append(f"PLUS_HAUT_QU_APRES({lower_after.units.min():,})")
    stale = real[(real.units == m.units) & (real.rep < m.rep - timedelta(days=STALE_DAYS))]
    if len(stale):
        flags.append(f"RELAIS_ANCIEN_REDATE?(déjà au {stale.rep.min()})")
    dup = same[same.units == m.units]
    if len(dup):
        flags.append(f"DOUBLON_CHIFFRE({len(dup)})")
    if m.platform == "GLOBAL" and e is not None:
        if m.units > 3 * e.hi:
            flags.append("GLOBAL>3x_ESTIMATION")
        if m.units < e.lo / 3:
            flags.append("GLOBAL<ESTIMATION/3")
    return flags


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--depuis", default=(date.today() - timedelta(days=7)).isoformat(),
                    help="date de capture minimale (AAAA-MM-JJ), défaut : il y a 7 jours")
    args = ap.parse_args()

    new, hist, sources, est, prd = load(args.depuis)
    by_host = {h.lower(): r for h, r in zip(sources.host, sources.to_dict("records"))}

    def source_for(h: str):
        for k, r in by_host.items():
            if h == k or h.endswith("." + k):
                return r
        return None

    buf = StringIO()
    with redirect_stdout(buf):
        print(f"# Audit milestones capturés depuis {args.depuis} — {len(new)} milestones, {new.gameId.nunique()} jeux\n")
        for gid, grp in new.groupby("gameId", sort=False):
            r0 = grp.iloc[0]
            e = est.loc[gid] if gid in est.index else None
            rels = prd[prd.gameId == gid].rel
            earliest_rel = rels.min() if len(rels) else None
            h_game = hist[hist.gameId == gid]
            est_txt = f"{e.lo / 1e6:.2f}M–{e.hi / 1e6:.2f}M" if e is not None else "n/a"
            print("=" * 110)
            print(f"{r0['name']} | sortie {r0.rel} | plateformes {r0.platforms} | estimation {est_txt}")
            print("  historique (non rejetés, * = nouveau) :")
            new_ids = set(grp.id)
            for h in h_game.itertuples(index=False):
                tags = ("EST " if h.isEstimate else "") + ("ENG " if h.isEngagement else "")
                print(f"   {'*' if h.id in new_ids else ' '} {h.rep}  {h.platform:<11} {h.source:<10} {h.units:>11,}  {tags}{h.host}  capt. {h.cap}")
            for m in grp.itertuples(index=False):
                host = host_of(m.sourceUrl)
                src = source_for(host)
                same = h_game[(h_game.platform == m.platform) & (h_game.id != m.id)]
                flags = flags_for(m, r0, same, src, e, earliest_rel)
                print(f"  -> {m.id}  {m.rep} {m.platform} {m.source}{' EST' if m.isEstimate else ''} {m.units:,}  {host}")
                print(f"     url : {m.sourceUrl}")
                print(f"     citation : {(m.note or '').strip()[:400]}")
                print(f"     DRAPEAUX : {', '.join(flags) if flags else 'ok'}")
    text = buf.getvalue()
    print(text)
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"audit_milestones_{date.today().isoformat()}.txt"
    out.write_text(text)
    print(f"→ {out}")


if __name__ == "__main__":
    main()

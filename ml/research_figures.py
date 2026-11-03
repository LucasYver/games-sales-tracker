"""Recherche à la main des chiffres de ventes manquants : préparer, revérifier, écrire.

Le déroulé et les règles sont dans le skill `research-sales-figures`. Chaque
tranche a son dossier `reports/research/<tranche>/` (ignoré par git) ; le journal
des jeux déjà cherchés est suivi par git, à côté du skill.

Usage (depuis ml/) :
    .venv/bin/python research_figures.py prepare <tranche> --min-reviews 20000 --max-reviews 50000
    .venv/bin/python research_figures.py check <tranche>
    .venv/bin/python research_figures.py apply <tranche>           → à blanc
    .venv/bin/python research_figures.py apply <tranche> --commit  → écrit en base et dans le journal
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import unicodedata
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import pandas as pd
import psycopg

from db import connect_read_only, database_url
from snapshot import latest_snapshot_dir

ML = Path(__file__).resolve().parent
ROOT = ML.parent
RESEARCH = ML / "reports" / "research"
LOG = ROOT / ".cursor" / "skills" / "research-sales-figures" / "searched_games.csv"
LOG_FIELDS = ["gameId", "name", "tranche", "date", "searches", "needed", "figures"]
INGESTION = ROOT / "backend" / "src" / "ingestion" / "ingestion.service.ts"
# Estimateurs absents de la liste du backend, vus pendant les recherches.
EXTRA_BLOCKED = {"gamalytic.com", "games-stats.com", "coilr.org", "steam-revenue-calculator.com",
                 "games-popularity.com", "icon-era.com", "growjo.com"}
# Mêmes scores que DEFAULT_CONFIDENCE_SCORE (ingestion.service.ts).
SCORE = {"OFFICIAL": 100, "WIKIPEDIA": 45, "MEDIA": 40}
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
NUMBER_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
                10: "ten", 11: "eleven", 12: "twelve"}

GAMES_WITHOUT_WORLD_FIGURE = '''
    select g.id::text, g.name, g.developer, g.publisher, g."releaseDate"::date, g.platforms::text
    from game g
    where g."catalogTier"='CORE' and not g."isFree" and g."deletedAt" is null
      and g."releaseDate">='2017-01-01' and g."releaseDate"<now()
      and not exists (select 1 from milestone m where m."gameId"=g.id and m.platform='GLOBAL'
                      and m."rejectedAt" is null and not m."isEngagement" and m."reportedAt" is not null and m.units>0)'''
KNOWN_FIGURES = '''
    select "gameId"::text, platform::text, units, "reportedAt"::date, left(coalesce("sourceUrl",''),80),
           "rejectedAt" is not null, "isEngagement"
    from milestone where "rejectedAt" is not null or "isEngagement" or platform<>'GLOBAL' '''


def tranche_dir(name: str) -> Path:
    return RESEARCH / name


def read_log() -> dict[str, dict]:
    if not LOG.exists():
        return {}
    with LOG.open(newline="") as f:
        return {r["gameId"]: r for r in csv.DictReader(f)}


def write_log(rows: dict[str, dict]) -> None:
    with LOG.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        w.writeheader()
        w.writerows(sorted(rows.values(), key=lambda r: (r["tranche"], r["name"])))


def latest_reviews() -> pd.Series:
    signals = pd.read_parquet(latest_snapshot_dir() / "signals.parquet")
    reviews = signals[signals.metric == "STEAM_REVIEWS"].sort_values("capturedAt")
    reviews = reviews.groupby("gameId", observed=True).value.last()
    reviews.index = reviews.index.astype(str)
    return reviews


def blocked_hosts(cur) -> set[str]:
    cur.execute("select host from trusted_source where not active and host is not null")
    hosts = {r[0] for r in cur.fetchall()} | EXTRA_BLOCKED
    source = INGESTION.read_text()
    denylist = source[source.index("const TAVILY_EXCLUDED_DOMAINS"):]
    denylist = denylist[:denylist.index("];")]
    return hosts | set(re.findall(r"'([a-z0-9.-]+\.[a-z]+)'", denylist))


def is_blocked(host: str, blocked: set[str]) -> bool:
    return any(host == b or host.endswith("." + b) for b in blocked)


def host_of(url: str) -> str:
    return urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")


def needed_searches(game: dict) -> int:
    return 4 if game["console"] else 2


def prepare(args) -> None:
    """Choisit les jeux de la tranche : jamais cherchés, ou cherchés sans aller au bout."""
    with connect_read_only() as conn, conn.cursor() as cur:
        cur.execute(GAMES_WITHOUT_WORLD_FIGURE)
        rows = cur.fetchall()
        cur.execute(KNOWN_FIGURES)
        known = {}
        for g, platform, units, day, url, rejected, engagement in cur.fetchall():
            known.setdefault(g, []).append(dict(platform=platform, units=units, date=str(day), url=url,
                                                rejected=rejected, engagement=engagement))
        blocked = blocked_hosts(cur)
    games = pd.DataFrame(rows, columns=["id", "name", "developer", "publisher", "release", "platforms"])
    games["rev"] = games.id.map(latest_reviews())
    games = games[(games.rev >= args.min_reviews) & (games.rev < args.max_reviews)]
    log = read_log()
    def still_to_do(game_id: str) -> bool:
        return game_id not in log or int(log[game_id]["searches"]) < int(log[game_id]["needed"])
    # Les jeux déjà cherchés sans aller au bout (coupés par une limite de recherche) passent d'abord.
    todo = games[games.id.map(still_to_do)].assign(retry=lambda d: d.id.isin(log))
    todo = todo.sort_values(["retry", "rev"], ascending=False)
    picked = todo.head(args.limit).copy()
    picked["console"] = picked.platforms.str.contains("PLAYSTATION|XBOX")
    picked["known"] = picked.id.map(lambda i: known.get(i, []))
    picked["release"] = picked.release.astype(str)
    picked["rev"] = picked.rev.astype(int)
    records = json.loads(picked.to_json(orient="records", force_ascii=False))

    out = tranche_dir(args.tranche)
    out.mkdir(parents=True, exist_ok=True)
    (out / "blocked_hosts.txt").write_text("\n".join(sorted(blocked)))
    for i in range(args.batches):
        (out / f"batch_{i + 1}.json").write_text(json.dumps(records[i::args.batches], ensure_ascii=False, indent=1))
    print(f"{len(games)} jeux sans chiffre monde dans cette plage, {len(todo)} à faire, {len(records)} choisis "
          f"en {args.batches} lots → {out}")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", html.unescape(text)).lower().replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text)


def fetch(url: str) -> tuple[str, str | None]:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"})
        raw = urllib.request.urlopen(request, timeout=25).read(4_000_000).decode("utf-8", "ignore")
        raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
        return normalize(re.sub(r"(?s)<[^>]+>", " ", raw)), None
    except Exception as e:
        return "", str(e)[:60]


def number_forms(units: int) -> set[str]:
    forms = {f"{units:,}", str(units), f"{units:,}".replace(",", " "), f"{units:,}".replace(",", ".")}
    if units >= 1_000_000:
        m = units / 1e6
        forms |= {f"{m:g} million", f"{m:g}m", f"{m:g} mil"}
        if m in NUMBER_WORDS:
            forms.add(NUMBER_WORDS[m] + " million")
    else:
        k = units / 1e3
        forms |= {f"{k:g}k", f"{k:g},000", f"{k:g} thousand", f"{k:g} tys"}
    return forms


def batches(folder: Path, prefix: str) -> list[dict]:
    return [e for p in sorted(folder.glob(f"{prefix}_*.json")) for e in json.loads(p.read_text())]


def check(args) -> None:
    """Relit chaque page sans passer par un modèle : la citation, le chiffre et le jeu y sont-ils ?"""
    folder = tranche_dir(args.tranche)
    games = {g["id"]: g for g in batches(folder, "batch")}
    results = batches(folder, "result")
    blocked = {l.strip() for l in (folder / "blocked_hosts.txt").read_text().splitlines() if l.strip()}
    items = [(e, f) for e in results for f in e.get("figures", [])]
    urls = sorted({f["source_url"] for _, f in items})
    with ThreadPoolExecutor(8) as pool:
        pages = dict(zip(urls, pool.map(fetch, urls)))
    checked = []
    for e, f in items:
        text, error = pages[f["source_url"]]
        quote = normalize(f["quote"])
        first_word = normalize(re.sub(r"[™®:]", "", e["name"])).split(" ")[0]
        checked.append({"game": e["name"], "id": e["id"], "release": games[e["id"]]["release"],
                        "platforms": games[e["id"]]["platforms"], **f,
                        "blocked": is_blocked(host_of(f["source_url"]), blocked), "fetch": error or "ok",
                        "quote_in_page": quote in text or quote[:60] in text,
                        "number_in_quote": any(w in quote for w in number_forms(f["units"])),
                        "game_in_page": first_word in text})
    (folder / "checked.json").write_text(json.dumps(checked, ensure_ascii=False, indent=1))

    print(f"{len(results)} jeux, {sum(1 for e in results if e.get('figures'))} avec chiffre, {len(checked)} chiffres, "
          f"{sum(e.get('searches', 0) for e in results)} recherches")
    print("jeux par nombre de recherches :", dict(sorted(pd.Series([e.get("searches", 0) for e in results]).value_counts().items())))
    for r in checked:
        alerts = [a for a, bad in (("HÔTE BLOQUÉ", r["blocked"]), (f"PAGE {r['fetch']}", r["fetch"] != "ok"),
                                   ("CITATION ABSENTE", not r["quote_in_page"]), ("CHIFFRE HORS CITATION", not r["number_in_quote"]),
                                   ("JEU ABSENT", not r["game_in_page"])) if bad]
        print(f"\n{r['game']} | {r['platform']} {r['units']:,} {r.get('qualifier') or ''} {r.get('metric')} {r.get('scope')} | "
              f"{r['date']} | sortie {r['release']} {r['platforms']} | {r.get('stated_by')} | {r.get('confidence')}"
              f"{' | ALINEA' if r.get('alinea') else ''}\n  {r['source_url']}\n  « {r['quote'][:220]} »"
              + (f"\n  ⚠️ {', '.join(alerts)}" if alerts else ""))


def apply(args) -> None:
    """Écrit les chiffres relus. `decisions.json` dit lesquels écarter et lesquels corriger.

    {"skip": [{"game": ..., "units": ..., "reason": ...}],
     "change": [{"game": ..., "units": ..., "platform": ..., "date": ..., "source": ...}],
     "official_hosts": ["chivalry2.com"]}
    """
    folder = tranche_dir(args.tranche)
    checked = json.loads((folder / "checked.json").read_text())
    path = folder / "decisions.json"
    decisions = json.loads(path.read_text()) if path.exists() else {}
    skip = {(d["game"], d["units"]): d["reason"] for d in decisions.get("skip", [])}
    change = {(d["game"], d["units"]): d for d in decisions.get("change", [])}
    official = set(decisions.get("official_hosts", [])) | {"sec.gov"}
    blocked = {l.strip() for l in (folder / "blocked_hosts.txt").read_text().splitlines() if l.strip()}

    report, written = [], 0
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        for r in checked:
            key = (r["game"], r["units"])
            line = dict(jeu=r["game"], ventes=r["units"], source=r["source_url"])
            if key in skip:
                report.append({**line, "plateforme": r["platform"], "date": r["date"], "statut": "écarté", "raison": skip[key]})
                continue
            host = host_of(r["source_url"])
            if is_blocked(host, blocked):
                raise SystemExit(f"{r['game']} {r['units']} : hôte bloqué {host}. L'écarter dans decisions.json.")
            fix = change.get(key, {})
            platform, day = fix.get("platform", r["platform"]), fix.get("date", r["date"])
            source = fix.get("source") or ("OFFICIAL" if host in official else "WIKIPEDIA" if "wikipedia" in host else "MEDIA")
            publisher = "Alinea Analytics" if r.get("alinea") else re.sub(r"\s*\(.*", "", r.get("stated_by") or "") or None
            line.update(plateforme=platform, date=day)
            cur.execute('select 1 from milestone where "gameId"=%s and units=%s and platform=%s and "reportedAt"::date=%s::date',
                        (r["id"], r["units"], platform, day))
            if cur.fetchone():
                report.append({**line, "statut": "déjà en base", "raison": ""})
                continue
            cur.execute('''insert into milestone (id,"gameId",source,units,platform,"isEstimate","isEngagement","confidenceScore",
                                                  publisher,"sourceUrl",note,"reportedAt")
                           values (%s,%s,%s,%s,%s,false,false,%s,%s,%s,%s,%s::timestamptz)''',
                        (str(uuid.uuid4()), r["id"], source, r["units"], platform, SCORE[source], publisher, r["source_url"],
                         r["quote"].strip(" -…."), day + "T00:00:00Z"))
            written += 1
            report.append({**line, "statut": "ajouté", "raison": r.get("stated_by") or ""})
        for line in report:
            print(f"{line['statut']:13} {line['jeu']} | {line['plateforme']} {line['ventes']:,} | {line['date']} {line['raison'] or ''}")
        if not args.commit:
            conn.rollback()
            print(f"\nÀ blanc : {written} chiffres seraient écrits. Relancer avec --commit.")
            return
    print(f"\n{written} chiffres écrits.")
    with (folder / "applied.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["jeu", "plateforme", "ventes", "date", "statut", "raison", "source"])
        w.writeheader()
        w.writerows(report)
    games = {g["id"]: g for g in batches(folder, "batch")}
    log = read_log()
    for e in batches(folder, "result"):
        log[e["id"]] = dict(gameId=e["id"], name=e["name"], tranche=args.tranche, date=date.today().isoformat(),
                            searches=e.get("searches", 0), needed=needed_searches(games[e["id"]]), figures=len(e.get("figures", [])))
    write_log(log)
    print(f"Journal mis à jour : {LOG}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("tranche")
    p.add_argument("--min-reviews", type=int, required=True)
    p.add_argument("--max-reviews", type=int, default=10**9)
    p.add_argument("--limit", type=int, default=50, help="la recherche web a coupé à 200 recherches pour une vague")
    p.add_argument("--batches", type=int, default=5)
    p.set_defaults(run=prepare)
    p = commands.add_parser("check")
    p.add_argument("tranche")
    p.set_defaults(run=check)
    p = commands.add_parser("apply")
    p.add_argument("tranche")
    p.add_argument("--commit", action="store_true")
    p.set_defaults(run=apply)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()

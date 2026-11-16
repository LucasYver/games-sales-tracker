"""Search X (official API, pay-per-use) for sales announcements of catalog games.

X bills each post the search returns (about $0.005 in 2026), so the run stops
once --max-posts posts were read. One full-archive query per game since 2017 (the API defaults to the last 30
days without start_time), 10 most relevant posts max.

    .venv/bin/python x_search.py pick <tranche> --games 20
    .venv/bin/python x_search.py search <tranche> --max-posts 200

The token comes from X_BEARER_TOKEN, in the environment or in backend/.env.
Output: reports/research/<tranche>/x_posts.json, read by hand like any harvest.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request

import pandas as pd

from db import BACKEND_ENV, _read_env_file, connect_read_only
from research_figures import latest_reviews, tranche_dir

SEARCH_URL = "https://api.x.com/2/tweets/search/all"
PRICE_PER_POST = 0.005
GAMES_WITHOUT_ANY_FIGURE = '''
    select g.id::text, g.name, g."releaseDate"::date, g.platforms::text
    from game g
    where not g."isFree" and g."deletedAt" is null and g."releaseDate" >= '2017-01-01' and g."releaseDate" < now()
      and not exists (select 1 from milestone m where m."gameId" = g.id and m."rejectedAt" is null
                      and not m."isEngagement" and m.units > 0)'''


def clean_title(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[™®©\xad]", "", name)).strip()


def pick(args) -> None:
    """Medium games with no sales figure at all, most reviewed first."""
    with connect_read_only() as conn, conn.cursor() as cur:
        cur.execute(GAMES_WITHOUT_ANY_FIGURE)
        games = pd.DataFrame(cur.fetchall(), columns=["id", "name", "release", "platforms"])
    games["rev"] = games.id.map(latest_reviews())
    games = games[(games.rev >= args.min_reviews) & (games.rev < args.max_reviews)]
    # A one-word title matches too many unrelated posts and wastes paid reads.
    games = games[games.name.map(lambda n: len(clean_title(n)) >= 8)]
    picked = games.sort_values("rev", ascending=False).head(args.games)
    folder = tranche_dir(args.tranche)
    folder.mkdir(parents=True, exist_ok=True)
    records = [dict(id=r.id, name=r.name, release=str(r.release), platforms=r.platforms, rev=int(r.rev))
               for r in picked.itertuples()]
    (folder / "x_games.json").write_text(json.dumps(records, ensure_ascii=False, indent=1))
    print(f"{len(records)} jeux → {folder / 'x_games.json'}")
    for r in records:
        print(f"  {r['rev']:>6} {r['name']}")


def search(args) -> None:
    token = os.environ.get("X_BEARER_TOKEN") or _read_env_file(BACKEND_ENV).get("X_BEARER_TOKEN")
    if not token:
        raise SystemExit("X_BEARER_TOKEN manquant (environnement ou backend/.env).")
    folder = tranche_dir(args.tranche)
    games = json.loads((folder / "x_games.json").read_text())
    out_path = folder / "x_posts.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}
    read = sum(len(v["posts"]) for v in results.values())
    for game in games:
        if game["id"] in results:
            continue
        if read + 10 > args.max_posts:
            print(f"Plafond atteint : {read} posts lus.")
            break
        # x_games.json may carry a shorter "query_title" when the catalog name has a long subtitle.
        query = f'"{game.get("query_title") or clean_title(game["name"])}" (copies OR "units sold") -is:retweet'
        params = {"query": query, "max_results": 10, "start_time": "2017-01-01T00:00:00Z", "sort_order": "relevancy",
                  "tweet.fields": "created_at,author_id",
                  "expansions": "author_id", "user.fields": "username,name,description"}
        request = urllib.request.Request(f"{SEARCH_URL}?{urllib.parse.urlencode(params)}",
                                         headers={"Authorization": f"Bearer {token}"})
        try:
            body = json.loads(urllib.request.urlopen(request, timeout=30).read())
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{game['name']} : HTTP {e.code} {e.read()[:300]!r}")
        users = {u["id"]: u for u in body.get("includes", {}).get("users", [])}
        posts = []
        for t in body.get("data", []):
            u = users.get(t["author_id"], {})
            posts.append(dict(url=f"https://x.com/{u.get('username', 'i')}/status/{t['id']}", date=t["created_at"][:10],
                              author=u.get("name"), username=u.get("username"), bio=u.get("description"), text=t["text"]))
        read += len(posts)
        results[game["id"]] = dict(name=game["name"], query=query, posts=posts)
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print(f"{len(posts):>2} posts  {game['name']}")
        time.sleep(1.1)  # full-archive search allows one request per second
    print(f"\n{read} posts lus, environ {read * PRICE_PER_POST:.2f} $ → {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("pick")
    p.add_argument("tranche")
    p.add_argument("--games", type=int, default=20)
    p.add_argument("--min-reviews", type=int, default=2000)
    p.add_argument("--max-reviews", type=int, default=30000)
    p.set_defaults(run=pick)
    p = commands.add_parser("search")
    p.add_argument("tranche")
    p.add_argument("--max-posts", type=int, default=200, help="plafond de posts lus (facturés)")
    p.set_defaults(run=search)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()

"""Connexion PostgreSQL en LECTURE SEULE.

Trois verrous empêchent toute écriture en prod :
  1. `default_transaction_read_only=on` passé au démarrage de la session ;
  2. `conn.read_only = True` (psycopg ouvre chaque transaction en
     `BEGIN READ ONLY`) ;
  3. une vérification explicite `SHOW transaction_read_only` qui lève une
     erreur si le serveur ne confirme pas.

Postgres rejette alors tout INSERT/UPDATE/DELETE/DDL avec
« cannot execute ... in a read-only transaction ».

L'URL vient de `GST_DATABASE_URL` si elle est définie, sinon de
`DATABASE_URL_DIRECT` (puis `DATABASE_URL`) dans `backend/.env`.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg

BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def database_url() -> str:
    if os.environ.get("GST_DATABASE_URL"):
        return os.environ["GST_DATABASE_URL"]
    env = _read_env_file(BACKEND_ENV)
    url = env.get("DATABASE_URL_DIRECT") or env.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            f"Aucune URL de base : définir GST_DATABASE_URL ou remplir {BACKEND_ENV}"
        )
    return url


def connect_read_only() -> psycopg.Connection:
    conn = psycopg.connect(
        database_url(),
        options="-c default_transaction_read_only=on",
        autocommit=False,
    )
    conn.read_only = True
    with conn.cursor() as cur:
        cur.execute("SHOW transaction_read_only")
        (state,) = cur.fetchone()
    if state != "on":
        conn.close()
        raise RuntimeError("La session n'est pas en lecture seule, abandon.")
    return conn

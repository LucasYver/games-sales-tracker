"""Read-only PostgreSQL connection.

Three locks keep the lab from ever writing to production:
  1. `default_transaction_read_only=on` set when the session starts;
  2. `conn.read_only = True` (psycopg opens every transaction READ ONLY);
  3. an explicit `SHOW transaction_read_only` check that aborts otherwise.

The URL comes from `GST_DATABASE_URL`, else from `DATABASE_URL_DIRECT`
(then `DATABASE_URL`) in `backend/.env`.
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
        raise RuntimeError(f"No database URL: set GST_DATABASE_URL or fill {BACKEND_ENV}")
    return url


def connect_read_only() -> psycopg.Connection:
    conn = psycopg.connect(database_url(), options="-c default_transaction_read_only=on", autocommit=False)
    conn.read_only = True
    with conn.cursor() as cur:
        cur.execute("SHOW transaction_read_only")
        (state,) = cur.fetchone()
    if state != "on":
        conn.close()
        raise RuntimeError("The session is not read-only, aborting.")
    return conn

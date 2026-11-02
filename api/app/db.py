import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/diagnostics")
    return url


def init_pool() -> None:
    global _pool
    # prepare_threshold=None: itdone.cloud serves Postgres through PgBouncer, which breaks server-side prepared statements
    _pool = ConnectionPool(
        database_url(),
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row, "options": "-c TimeZone=UTC", "prepare_threshold": None},
        open=True,
    )
    with connection() as conn:
        conn.execute((Path(__file__).parent / "schema.sql").read_text())


def close_pool() -> None:
    if _pool:
        _pool.close()


@contextmanager
def connection():
    assert _pool is not None, "init_pool() must run first"
    with _pool.connection() as conn:
        yield conn


def fetch_all(sql: str, params: tuple | dict = ()) -> list[dict]:
    with connection() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params: tuple | dict = ()) -> dict | None:
    with connection() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> int:
    with connection() as conn:
        return conn.execute(sql, params).rowcount


__all__ = ["connection", "execute", "fetch_all", "fetch_one", "init_pool", "close_pool", "psycopg"]

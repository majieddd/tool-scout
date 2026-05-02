"""SQLAlchemy engine + session factory for Tool Scout.

The DB lives at ~/.tool-scout/scout.db with WAL mode + foreign keys on.
Path resolves via Path.home() so it tolerates usernames containing spaces
(e.g., "Majied LaFleur" on this machine).
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def db_path() -> Path:
    return Path.home() / ".tool-scout" / "scout.db"


def db_url() -> str:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{p}"


engine = create_engine(db_url(), future=True, echo=False)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass

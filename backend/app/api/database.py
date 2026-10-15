"""Request-scoped read-only connections using the existing engine lifecycle."""

from pathlib import Path

from fastapi import Depends
from sqlalchemy.engine import make_url

from app.core.config import BACKEND_DIR, Settings, get_settings
from app.data.loader import create_loader_engine


def get_connection(settings: Settings = Depends(get_settings)):
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite":
        raise ValueError("Research API requires SQLite")
    if not url.database or url.database == ":memory:":
        # A new per-request in-memory engine cannot represent persisted data.
        yield None
        return
    path = Path(url.database)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    if not path.exists():
        # Do not initialize files or schema merely because a GET was requested.
        yield None
        return
    engine = create_loader_engine(settings)
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA query_only = ON")
            yield connection
    finally:
        engine.dispose()

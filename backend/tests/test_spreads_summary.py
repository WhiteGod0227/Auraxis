from pathlib import Path

from fastapi.testclient import TestClient

from app.api import analytics
from app.core.config import Settings, get_settings
from app.data.loader import load_file
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures" / "csv_loader"


def test_spreads_summary_returns_each_pair_and_caches(tmp_path, monkeypatch):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
        auth_database_path=tmp_path / "auth.sqlite3",
    )
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as client:
            empty = client.get("/api/spreads/summary").json()
            assert empty["data_available"] is False and empty["pairs"] == []
            load_file(FIXTURES / "BhavCopyDateWise_01102026.csv", settings=settings)
            body = client.get("/api/spreads/summary?history=5").json()
            assert body["data_as_of"] == "2026-10-01"
            assert body["window"] == 10
            pairs = {item["pair"]: item for item in body["pairs"]}
            assert "GOLDTEN-GOLDPETAL" in pairs
            item = pairs["GOLDTEN-GOLDPETAL"]
            assert set(item) >= {"expiry", "spread_abs", "z", "history"}
            assert len(item["history"]) <= 5

            calls = []
            original = analytics.compute_spreads
            monkeypatch.setattr(
                analytics,
                "compute_spreads",
                lambda **kw: calls.append(kw) or original(**kw),
            )
            assert client.get("/api/spreads/summary?history=5").json() == body
            assert calls == []  # served from cache for the same dataset
            assert client.get("/api/spreads/summary?window=1").status_code == 422
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

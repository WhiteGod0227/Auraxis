import gzip
import json
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import auth as auth_api
from app.core.config import Settings, get_settings
from app.data import upstox
from app.data.loader import bhav, create_loader_engine, data_health
from app.main import app
from tests import test_auth

IST_MIDNIGHT_EXPIRY = 1796149799000  # 2026-12-01 23:59:59 IST
TODAY = date(2026, 11, 13)

INSTRUMENTS = [
    {
        "segment": "MCX_FO",
        "instrument_type": "FUT",
        "underlying_symbol": "GOLDTEN",
        "instrument_key": "MCX_FO|1",
        "underlying_key": "MCX_COM|599",
        "expiry": IST_MIDNIGHT_EXPIRY,
    },
    {
        "segment": "MCX_FO",
        "instrument_type": "FUT",
        "underlying_symbol": "GOLDPETAL",
        "instrument_key": "MCX_FO|2",
        "underlying_key": "MCX_COM|600",
        "expiry": IST_MIDNIGHT_EXPIRY,
    },
    # Ignored: other product, options and already expired contracts.
    {
        "segment": "MCX_FO",
        "instrument_type": "FUT",
        "underlying_symbol": "SILVERM",
        "instrument_key": "MCX_FO|3",
        "expiry": IST_MIDNIGHT_EXPIRY,
    },
    {
        "segment": "MCX_FO",
        "instrument_type": "CE",
        "underlying_symbol": "GOLDTEN",
        "instrument_key": "MCX_FO|4",
        "expiry": IST_MIDNIGHT_EXPIRY,
    },
    {
        "segment": "MCX_FO",
        "instrument_type": "FUT",
        "underlying_symbol": "GOLDTEN",
        "instrument_key": "MCX_FO|5",
        "underlying_key": "MCX_COM|599",
        "expiry": 1761848999000,  # 2025-10-30
    },
]

CANDLES = {
    "MCX_FO|1": [
        ["2026-11-12T00:00:00+05:30", 125000, 126000, 124500, 125500, 40, 300],
        ["2026-11-11T00:00:00+05:30", 124000, 125100, 123900, 125000, 0, 280],
    ],
    "MCX_FO|2": [
        ["2026-11-12T00:00:00+05:30", 12600, 12650, 12500, 12580, 900, 5000],
    ],
}


def transport(calls, status=200):
    def handler(request: httpx.Request):
        calls.append(str(request.url))
        if request.url.host == "assets.upstox.com":
            return httpx.Response(
                200, content=gzip.compress(json.dumps(INSTRUMENTS).encode())
            )
        assert request.headers["authorization"] == "Bearer test-token"
        if status != 200:
            return httpx.Response(status, json={"errors": [{"message": "nope"}]})
        key = httpx.URL(str(request.url)).path.split("/")[3]
        key = key.replace("%7C", "|")
        return httpx.Response(
            200, json={"status": "success", "data": {"candles": CANDLES.get(key, [])}}
        )

    return httpx.MockTransport(handler)


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
        data_cache_dir=tmp_path / "cache",
        auth_database_path=tmp_path / "auth.sqlite3",
        upstox_access_token="test-token",
    )


def run(settings, calls, status=200):
    client = httpx.Client(
        transport=transport(calls, status),
        headers={"Authorization": "Bearer test-token"},
    )
    return upstox.refresh(settings, client=client, today=TODAY, days=30)


def test_parse_instruments_filters_gold_futures():
    contracts = upstox.parse_instruments(INSTRUMENTS, ["GOLDTEN", "GOLDPETAL"])
    assert [(c.symbol, c.key) for c in contracts] == [
        ("GOLDPETAL", "MCX_FO|2"),
        ("GOLDTEN", "MCX_FO|5"),
        ("GOLDTEN", "MCX_FO|1"),
    ]
    assert contracts[-1].expiry == date(2026, 12, 1)


def test_candle_rows_convert_lots_and_previous_close():
    contract = upstox.Contract("GOLDTEN", date(2026, 12, 1), "MCX_FO|1", "")
    rows = upstox.candle_rows(contract, CANDLES["MCX_FO|1"], Settings())
    assert [row["trade_date"] for row in rows] == [
        date(2026, 11, 11),
        date(2026, 11, 12),
    ]
    first, second = rows
    assert first["previous_close"] is None and second["previous_close"] == 125000
    assert first["has_trade"] is False and second["has_trade"] is True
    assert second["volume_lots"] == 40 and second["volume_grams"] == 400
    assert second["open_interest_grams"] == 3000
    assert second["volume_text"] == "0.400 GRMS"


def test_refresh_stores_rows_health_and_status(settings):
    calls = []
    result = run(settings, calls)
    assert result.status == "ok"
    assert result.contracts == 2 and result.rows == 3
    assert result.latest_trade_date == date(2026, 11, 12)
    assert not any("MCX_FO%7C5" in url for url in calls)
    engine = create_loader_engine(settings)
    with engine.connect() as connection:
        stored = connection.execute(select(bhav)).all()
        health = connection.execute(select(data_health)).all()
    engine.dispose()
    assert len(stored) == 3
    assert {row.file_name for row in health} == {
        "upstox_2026-11-11",
        "upstox_2026-11-12",
    }
    status = upstox.refresh_status(settings)
    assert status["configured"] is True
    assert status["latest_trade_date"] == "2026-11-12"
    assert status["last_run"]["status"] == "ok"
    # Idempotent re-run.
    assert run(settings, []).rows == 3


def test_refresh_never_overwrites_bhavcopy_rows(settings):
    engine = create_loader_engine(settings)
    upstox.market_metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            bhav.insert().values(
                symbol="GOLDPETAL",
                expiry_date=date(2026, 12, 1),
                trade_date=date(2026, 11, 12),
                open=1,
                high=1,
                low=1,
                close=99999,
                previous_close=1,
                value_lacs=12.5,
                volume_lots=1,
                volume_text="0.001 GRMS",
                open_interest_lots=1,
                volume_grams=1,
                open_interest_grams=1,
                has_trade=True,
            )
        )
    run(settings, [])
    with engine.connect() as connection:
        close = connection.execute(
            select(bhav.c.close).where(bhav.c.symbol == "GOLDPETAL")
        ).scalar()
    engine.dispose()
    assert close == 99999


def test_refresh_rejected_token_is_reported(settings):
    with pytest.raises(upstox.UpstoxError, match="access token"):
        run(settings, [], status=401)
    assert upstox.refresh_status(settings)["last_run"]["status"] == "error"


def test_refresh_requires_token(settings):
    with pytest.raises(upstox.UpstoxError, match="not configured"):
        upstox.refresh(settings.model_copy(update={"upstox_access_token": ""}))


def test_data_endpoints(settings, monkeypatch):
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    seen = {}

    def fake_refresh(current, **kwargs):
        seen.update(kwargs)
        return upstox.RefreshResult(
            contracts=2, rows=3, trade_dates={date(2026, 11, 12)}
        )

    monkeypatch.setattr(upstox, "refresh", fake_refresh)
    try:
        with TestClient(
            app,
            base_url="http://localhost:8010",
            headers={"Origin": "http://localhost:5173"},
        ) as client:
            status = client.get("/api/data/status")
            assert status.status_code == 200
            assert status.json()["configured"] is True
            assert client.post("/api/data/refresh").status_code == 401
            test_auth.register(client)
            done = client.post("/api/data/refresh", json={"days": 90})
            assert done.status_code == 200
            assert done.json()["latest_trade_date"] == "2026-11-12"
            assert seen["days"] == 90
            restricted = settings.model_copy(
                update={"data_admin_emails": ["boss@example.com"]}
            )
            app.dependency_overrides[get_settings] = lambda: restricted
            assert client.post("/api/data/refresh").status_code == 403
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_google_login_creates_and_reuses_account(tmp_path, monkeypatch):
    settings = Settings(
        auth_database_path=tmp_path / "accounts.sqlite3",
        google_client_id="client-123.apps.googleusercontent.com",
    )
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    replies = {
        "good": {
            "aud": "client-123.apps.googleusercontent.com",
            "iss": "https://accounts.google.com",
            "email_verified": "true",
            "exp": "9999999999",
            "email": "Gold@Example.com",
            "name": "Gold Researcher",
        },
        "wrongaud": {
            "aud": "someone-else",
            "iss": "https://accounts.google.com",
            "email_verified": "true",
            "exp": "9999999999",
            "email": "x@example.com",
        },
    }

    def fake_get(url, params, timeout):
        token = params["id_token"].split("-")[0]
        if token in replies:
            return httpx.Response(200, json=replies[token])
        return httpx.Response(400, json={"error": "invalid_token"})

    monkeypatch.setattr(auth_api.httpx, "get", fake_get)
    try:
        with TestClient(
            app,
            base_url="http://localhost:8010",
            headers={"Origin": "http://localhost:5173"},
        ) as client:
            assert client.get("/api/auth/providers").json() == {
                "google_client_id": "client-123.apps.googleusercontent.com"
            }
            pad = "-" + "x" * 30
            first = client.post("/api/auth/google", json={"credential": "good" + pad})
            assert first.status_code == 200
            assert first.json()["user"]["email"] == "gold@example.com"
            assert first.json()["user"]["name"] == "Gold Researcher"
            assert client.get("/api/auth/me").status_code == 200
            client.cookies.clear()
            again = client.post("/api/auth/google", json={"credential": "good" + pad})
            assert again.json()["user"]["id"] == first.json()["user"]["id"]
            for bad in ("wrongaud", "invalid"):
                assert (
                    client.post(
                        "/api/auth/google", json={"credential": bad + pad}
                    ).status_code
                    == 401
                )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_google_disabled_without_client_id(tmp_path):
    settings = Settings(auth_database_path=tmp_path / "accounts.sqlite3")
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(
            app,
            base_url="http://localhost:8010",
            headers={"Origin": "http://localhost:5173"},
        ) as client:
            assert client.get("/api/auth/providers").json() == {
                "google_client_id": None
            }
            reply = client.post("/api/auth/google", json={"credential": "x" * 40})
            assert reply.status_code == 404
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


FIXTURES = __import__("pathlib").Path(__file__).parent / "fixtures" / "csv_loader"


def test_bhavcopy_upload_imports_and_validates(settings):
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    good = (FIXTURES / "BhavCopyDateWise_01102026.csv").read_bytes()
    mixed = (FIXTURES / "BhavCopyDateWise_02102026.csv").read_bytes()
    try:
        with TestClient(
            app,
            base_url="http://localhost:8010",
            headers={"Origin": "http://localhost:5173"},
        ) as client:
            url = "/api/data/upload?filename="
            assert client.post(url + "x.csv", content=good).status_code == 401
            test_auth.register(client)
            # Browser duplicate names are normalized.
            done = client.post(url + "BhavCopyDateWise_01102026 (1).csv", content=good)
            assert done.status_code == 200, done.text
            body = done.json()
            assert body["status"] == "ok" and body["rows_kept"] > 0
            assert body["stored_as"] == "BhavCopyDateWise_01102026.csv"
            assert body["trade_date"] == "2026-10-01"
            raw = settings.data_cache_dir / "raw_csv"
            assert (raw / "BhavCopyDateWise_01102026.csv").read_bytes() == good
            # Unknown names derive the date from the Date column.
            renamed = client.post(url + "download.csv", content=good)
            assert renamed.json()["stored_as"] == "BhavCopyDateWise_01102026.csv"
            # A wrong date in the name is corrected from the Date column.
            mislabelled = client.post(
                url + "BhavCopyDateWise_05102026.csv", content=good
            )
            assert mislabelled.json()["stored_as"] == "BhavCopyDateWise_01102026.csv"
            # Mixed dates cannot be named automatically ...
            assert client.post(url + "download.csv", content=mixed).status_code == 422
            # ... and a mismatching canonical name is rejected by the loader.
            bad = client.post(url + "BhavCopyDateWise_02102026.csv", content=mixed)
            assert bad.json()["status"] == "date_mismatch"
            assert not (raw / "BhavCopyDateWise_02102026.csv").exists()
            assert client.post(url + "a.xlsx", content=good).status_code == 422
            assert client.post(url + "a.csv", content=b"  ").status_code == 422
            meta = client.get("/api/meta").json()
            assert meta["data_available"] is True
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_concurrent_status_requests_create_schema_once(settings):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda _: upstox.refresh_status(settings), range(16)))
    assert all(result["latest_trade_date"] is None for result in results)

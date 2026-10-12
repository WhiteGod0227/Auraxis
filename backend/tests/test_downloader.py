import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.data.downloader import COLUMNS, fetch_bhavcopy


@pytest.fixture
def payload():
    path = Path(__file__).parent / "fixtures" / "bhavcopy_2026-10-09.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        data_cache_dir=tmp_path,
        bhavcopy_request_delay=0,
        bhavcopy_retry_backoff=0,
    )


def fetch(payload, settings):
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    ) as client:
        return fetch_bhavcopy(date(2026, 10, 9), settings=settings, client=client)


def test_dates_symbols_filtering_and_raw_units(payload, settings):
    result = fetch(payload, settings)
    assert result.status == "ok"
    assert result.requested_date == result.returned_date == date(2026, 10, 9)
    assert result.total_rows == 6
    frame = result.dataframe
    assert list(frame.columns) == COLUMNS
    assert frame.symbol.tolist() == ["GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"]
    assert frame.trade_date.tolist() == [date(2026, 10, 9)] * 4
    assert frame.expiry_date.tolist() == [date(2026, 10, 30)] * 4
    assert frame.volume_text.tolist() == [
        "2.000 KGS  ",
        "3.000 GRAMS  ",
        "4.000 PCS  ",
        "5.000 GRAMS  ",
    ]
    assert frame.close.tolist() == [336.55] * 4


def test_date_mismatch_in_excluded_row(payload, settings):
    payload["Data"][0]["Date"] = "10/08/2026"
    result = fetch(payload, settings)
    assert result.status == "date_mismatch"
    assert result.requested_date == date(2026, 10, 9)
    assert result.returned_date == date(2026, 10, 8)
    assert "2026-10-09" in result.message and "2026-10-08" in result.message
    assert result.dataframe.empty


def test_empty_data(payload, settings):
    payload["Data"] = []
    result = fetch(payload, settings)
    assert result.status == "empty"
    assert result.returned_date is None
    assert result.total_rows == 0
    assert result.dataframe.empty


def test_cache_prevents_second_request(payload, settings):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url.params["InstrumentName"] == "ALL"
        assert request.url.params["fromDate"] == "09/10/2026"
        assert request.headers["Referer"] == settings.bhavcopy_headers["Referer"]
        return httpx.Response(200, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        first = fetch_bhavcopy("2026-10-09", settings=settings, client=client)
        second = fetch_bhavcopy("2026-10-09", settings=settings, client=client)
    assert first.status == second.status == "ok"
    assert len(requests) == 1
    assert (
        json.loads(
            (settings.data_cache_dir / "raw" / "2026-10-09.json").read_text(
                encoding="utf-8"
            )
        )
        == payload
    )


def test_configurable_symbols(payload, settings):
    settings.bhavcopy_symbols = ["GOLDM"]
    result = fetch(payload, settings)
    assert result.dataframe.symbol.tolist() == ["GOLDM"]


@pytest.mark.parametrize("code", [403, 429, 503])
def test_blocks_stop_without_retry_or_cache(settings, code):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(code, text="Access denied by MCX")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = fetch_bhavcopy("2026-10-09", settings=settings, client=client)
    assert result.status == "error"
    assert result.message == f"HTTP {code}: Access denied by MCX"
    assert result.dataframe.empty
    assert len(requests) == 1
    assert not (settings.data_cache_dir / "raw").exists()


def test_transient_retry(payload, settings, monkeypatch):
    responses = iter(
        [httpx.Response(500, text="Temporary error"), httpx.Response(200, json=payload)]
    )
    sleeps = []
    settings.bhavcopy_retry_backoff = 0.5
    monkeypatch.setattr("app.data.downloader.time.sleep", sleeps.append)
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: next(responses))
    ) as client:
        result = fetch_bhavcopy("2026-10-09", settings=settings, client=client)
    assert result.status == "ok"
    assert sleeps == [0.5]


def test_polite_delay(payload, settings, monkeypatch):
    monkeypatch.setattr("app.data.downloader._last_request_finished", 100.0)
    monkeypatch.setattr("app.data.downloader.time.monotonic", lambda: 100.5)
    sleeps = []
    monkeypatch.setattr("app.data.downloader.time.sleep", sleeps.append)
    settings.bhavcopy_request_delay = 2
    assert fetch(payload, settings).status == "ok"
    assert sleeps == [1.5]


def test_invalid_response_date(payload, settings):
    payload["Data"][0]["Date"] = "not a date"
    result = fetch(payload, settings)
    assert result.status == "error"
    assert result.dataframe.empty


def test_timeout_retries_exhausted(settings, monkeypatch):
    requests = []
    sleeps = []
    settings.bhavcopy_retry_backoff = 1
    monkeypatch.setattr("app.data.downloader.time.sleep", sleeps.append)

    def handler(request):
        requests.append(request)
        raise httpx.ReadTimeout("MCX read timed out", request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = fetch_bhavcopy("2026-10-09", settings=settings, client=client)
    assert result.status == "error"
    assert result.message == "MCX read timed out"
    assert len(requests) == settings.bhavcopy_retry_count + 1
    assert sleeps == [1, 2]
    assert not (settings.data_cache_dir / "raw").exists()


@pytest.mark.parametrize("kind", ["empty", "date_mismatch"])
def test_non_ok_successful_responses_are_cached(payload, settings, kind):
    if kind == "empty":
        payload["Data"] = []
    else:
        for row in payload["Data"]:
            row["Date"] = "10/08/2026"
    assert fetch(payload, settings).status == kind
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda request: pytest.fail("A cached response must not refetch")
        )
    ) as client:
        assert (
            fetch_bhavcopy("2026-10-09", settings=settings, client=client).status
            == kind
        )

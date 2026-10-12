"""Fetch and cache MCX daily JSON; no historical loading or analytics."""

# DISABLED / UNUSED: MCX blocks scripted requests. Use app.data.loader with manual
# CSV downloads. Retained for reference and its mocked tests; do not invoke live.

import argparse
import json
import threading
import time
from dataclasses import dataclass, field
from datetime import date as Date
from datetime import datetime
from typing import Literal
from uuid import uuid4

import httpx
import pandas as pd

from app.core.config import BACKEND_DIR, Settings, get_settings

COLUMNS = [
    "symbol",
    "trade_date",
    "expiry_date",
    "open",
    "high",
    "low",
    "close",
    "previous_close",
    "volume",
    "volume_text",
    "value",
    "open_interest",
]
_request_lock = threading.Lock()
_last_request_finished: float | None = None


@dataclass
class BhavcopyResult:
    status: Literal["ok", "empty", "date_mismatch", "error"]
    requested_date: Date
    returned_date: Date | None = None
    message: str = ""
    dataframe: pd.DataFrame = field(
        default_factory=lambda: pd.DataFrame(columns=COLUMNS)
    )
    total_rows: int = 0


def _request(
    client: httpx.Client, requested: Date, settings: Settings
) -> httpx.Response:
    global _last_request_finished
    # Serialize requests and wait after the preceding response, including retries.
    with _request_lock:
        if _last_request_finished is not None:
            remaining = settings.bhavcopy_request_delay - (
                time.monotonic() - _last_request_finished
            )
            if remaining > 0:
                time.sleep(remaining)
        try:
            return client.get(
                settings.bhavcopy_url,
                params={
                    "InstrumentName": "ALL",
                    "fromDate": requested.strftime("%d/%m/%Y"),
                },
                headers=settings.bhavcopy_headers,
                timeout=settings.bhavcopy_timeout,
                follow_redirects=False,
            )
        finally:
            _last_request_finished = time.monotonic()


def _download(client: httpx.Client, requested: Date, settings: Settings) -> dict:
    for attempt in range(settings.bhavcopy_retry_count + 1):
        try:
            response = _request(client, requested, settings)
        except httpx.TransportError:
            if attempt == settings.bhavcopy_retry_count:
                raise
        else:
            if response.is_success:
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError("MCX response must be a JSON object")
                return payload
            # Never retry client errors (including blocks/rate limits) or redirects.
            # Transient 5xx responses may be retried without bypassing access controls.
            blocked = any(
                marker in response.text.lower()
                for marker in (
                    "access denied",
                    "request blocked",
                    "captcha",
                    "forbidden",
                )
            )
            if (
                blocked
                or response.status_code < 500
                or attempt == settings.bhavcopy_retry_count
            ):
                raise ValueError(f"HTTP {response.status_code}: {response.text}")
        time.sleep(settings.bhavcopy_retry_backoff * (2**attempt))
    raise RuntimeError("Retry loop exhausted")


def _parse(payload: dict, requested: Date, symbols: list[str]) -> BhavcopyResult:
    result = BhavcopyResult("empty", requested)
    rows = payload.get("Data")
    if payload.get("IsSuccess") is not True:
        result.status = "error"
        result.message = str(payload.get("Message", "MCX did not report success"))
        return result
    if not isinstance(rows, list):
        raise ValueError("MCX Data must be a list")
    result.total_rows = len(rows)
    if not rows:
        result.message = str(payload.get("Message", "MCX returned no rows"))
        return result

    # Validate every row, even rows excluded by the futures/symbol filter.
    dates = [datetime.strptime(row["Date"], "%m/%d/%Y").date() for row in rows]
    result.returned_date = dates[0]
    mismatches = sorted(set(dates) - {requested})
    if mismatches:
        result.status = "date_mismatch"
        result.returned_date = mismatches[0]
        result.message = f"Requested {requested.isoformat()}; returned " + ", ".join(
            value.isoformat() for value in sorted(set(dates))
        )
        return result

    kept = []
    for row, trade_date in zip(rows, dates, strict=True):
        symbol = row["Symbol"].strip()
        if row["InstrumentName"] != "FUTCOM" or symbol not in symbols:
            continue
        kept.append(
            {
                "symbol": symbol,
                "trade_date": trade_date,
                "expiry_date": datetime.strptime(row["ExpiryDate"], "%d%b%Y").date(),
                "open": row["Open"],
                "high": row["High"],
                "low": row["Low"],
                # Store reported close/settlement; it is not an executable price.
                "close": row["Close"],
                "previous_close": row["PreviousClose"],
                "volume": row["Volume"],
                # Preserve units and padding verbatim; units may differ across symbols.
                "volume_text": row["VolumeInThousands"],
                "value": row["Value"],
                "open_interest": row["OpenInterest"],
            }
        )
    if kept:
        result.status = "ok"
        result.dataframe = pd.DataFrame(kept, columns=COLUMNS)
        result.message = str(payload.get("Message", "Request was successful"))
    else:
        result.message = "No matching gold futures rows"
    return result


def fetch_bhavcopy(
    date: Date | str,
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> BhavcopyResult:
    """Fetch one day; ISO strings or datetime.date accepted, invalid inputs raise.

    Optional settings/client arguments allow isolated tests without live networking.
    Successful HTTP JSON objects are cached even when MCX reports empty/error or a
    date mismatch. Existing caches are authoritative and are never refetched.
    """
    requested = Date.fromisoformat(date) if isinstance(date, str) else date
    if not isinstance(requested, Date) or isinstance(requested, datetime):
        raise TypeError("date must be a datetime.date or ISO YYYY-MM-DD string")
    settings = settings or get_settings()
    cache_dir = settings.data_cache_dir
    if not cache_dir.is_absolute():
        cache_dir = BACKEND_DIR / cache_dir
    cache_file = cache_dir / "raw" / f"{requested.isoformat()}.json"
    try:
        if cache_file.exists():
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            if client is None:
                with httpx.Client() as owned_client:
                    payload = _download(owned_client, requested, settings)
            else:
                payload = _download(client, requested, settings)
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache_file.with_suffix(f".{uuid4().hex}.tmp")
            try:
                temporary.write_text(
                    json.dumps(payload, ensure_ascii=False), encoding="utf-8"
                )
                temporary.replace(cache_file)
            finally:
                temporary.unlink(missing_ok=True)
        return _parse(payload, requested, settings.bhavcopy_symbols)
    except (
        httpx.HTTPError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
    ) as exc:
        return BhavcopyResult("error", requested, message=str(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, type=Date.fromisoformat)
    args = parser.parse_args()
    settings = get_settings()
    result = fetch_bhavcopy(args.date, settings=settings)
    print(f"status: {result.status}")
    print(f"requested date: {result.requested_date}")
    print(f"returned date: {result.returned_date or 'none'}")
    print(f"total rows from MCX: {result.total_rows}")
    for symbol in settings.bhavcopy_symbols:
        count = int((result.dataframe["symbol"] == symbol).sum())
        print(f"{symbol}: {count}")
    print(f"message: {result.message}")
    if result.status == "error":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

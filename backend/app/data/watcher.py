"""Import MCX Bhavcopy CSVs automatically from a watched folder (e.g. Downloads).

While the API runs, any new ``BhavCopy*.csv`` that appears in the folder is
named by the trade date *inside* the file (MCX sometimes serves the latest
session whatever date was picked), archived to ``data_cache/raw_csv`` and
loaded. Files are identified by content hash, so duplicates and re-downloads
are skipped, also across restarts.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import threading
from collections import deque
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from app.core.config import BACKEND_DIR, Settings
from app.data.loader import load_file

logger = logging.getLogger(__name__)
MAX_BYTES = 15 * 1024 * 1024


@dataclass
class WatchEvent:
    file_name: str
    trade_date: str | None
    status: str  # imported | duplicate | skipped | failed
    detail: str
    at: str


_lock = threading.Lock()
_recent: deque[WatchEvent] = deque(maxlen=8)
_state = {"enabled": False, "folder": None, "last_import_at": None}


def bhavcopy_trade_date(content: bytes) -> date | None:
    """The single trade date in a Bhavcopy's Date column, else None."""
    try:
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        if not reader.fieldnames or "Date" not in reader.fieldnames:
            return None
        dates = {
            (row.get("Date") or "").strip()
            for row in reader
            if (row.get("Date") or "").strip()
        }
        parsed = {datetime.strptime(value, "%d %b %Y").date() for value in dates}
    except (UnicodeDecodeError, ValueError, csv.Error):
        return None
    return parsed.pop() if len(parsed) == 1 else None


def watch_folder(settings: Settings) -> Path:
    folder = settings.bhavcopy_watch_dir or Path.home() / "Downloads"
    return folder if folder.is_absolute() else BACKEND_DIR / folder


def _archive_dir(settings: Settings) -> Path:
    directory = settings.data_cache_dir
    directory = directory if directory.is_absolute() else BACKEND_DIR / directory
    return directory / "raw_csv"


def _seen_path(settings: Settings) -> Path:
    return _archive_dir(settings).parent / "watched_files.json"


def _load_seen(settings: Settings) -> set[str]:
    try:
        return set(json.loads(_seen_path(settings).read_text("utf-8")))
    except (OSError, ValueError):
        return set()


def _save_seen(settings: Settings, seen: set[str]) -> None:
    path = _seen_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted(seen)), "utf-8")


def _record(event: WatchEvent) -> None:
    with _lock:
        _recent.appendleft(event)
        if event.status == "imported":
            _state["last_import_at"] = event.at
    log = logger.info if event.status in {"imported", "duplicate"} else logger.warning
    log(
        "Watch %s: %s (%s) %s",
        event.status,
        event.file_name,
        event.trade_date,
        event.detail,
    )


def watch_status() -> dict:
    with _lock:
        return {
            **_state,
            "recent": [asdict(event) for event in _recent],
        }


def scan_once(settings: Settings, seen: set[str], sizes: dict[str, int]) -> int:
    """Import every new, fully written Bhavcopy in the folder. Returns imports."""
    folder = watch_folder(settings)
    if not folder.is_dir():
        return 0
    imported = 0
    archive = _archive_dir(settings)

    def modified(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    for path in sorted(folder.glob("*.csv"), key=modified):
        if not path.name.lower().startswith("bhavcopy"):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        # Wait until the browser has finished writing (size stable twice).
        if size == 0 or size > MAX_BYTES or sizes.get(path.name) != size:
            sizes[path.name] = size
            continue
        try:
            content = path.read_bytes()
        except OSError:
            continue
        digest = hashlib.sha256(content).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        day = bhavcopy_trade_date(content)
        if day is None:
            _record(
                WatchEvent(path.name, None, "skipped", "not a single-day Bhavcopy", now)
            )
            continue
        target = archive / f"BhavCopyDateWise_{day:%d%m%Y}.csv"
        if (
            target.exists()
            and hashlib.sha256(target.read_bytes()).hexdigest() == digest
        ):
            _record(
                WatchEvent(
                    path.name, day.isoformat(), "duplicate", "already imported", now
                )
            )
            continue
        archive.mkdir(parents=True, exist_ok=True)
        previous = target.read_bytes() if target.exists() else None
        target.write_bytes(content)
        try:
            result = load_file(target, settings=settings)
        except Exception as exc:  # keep watching; report the failure
            result = None
            detail = f"{type(exc).__name__}: {exc}"[:200]
        else:
            detail = (
                f"{result.rows_kept} gold rows"
                if result.status == "ok"
                else (result.notes or result.status)[:200]
            )
        if result is None or result.status != "ok":
            if previous is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(previous)
            _record(WatchEvent(path.name, day.isoformat(), "failed", detail, now))
            continue
        imported += 1
        _record(WatchEvent(path.name, day.isoformat(), "imported", detail, now))
    return imported


async def watch_loop(settings: Settings) -> None:
    """Poll the folder while the API runs. Never raises."""
    folder = watch_folder(settings)
    with _lock:
        _state.update(enabled=True, folder=str(folder))
    logger.info("Watching %s for MCX Bhavcopy files", folder)
    seen = await asyncio.to_thread(_load_seen, settings)
    sizes: dict[str, int] = {}
    interval = max(2.0, settings.bhavcopy_watch_seconds)
    while True:
        try:
            before = len(seen)
            await asyncio.to_thread(scan_once, settings, seen, sizes)
            if len(seen) != before:
                await asyncio.to_thread(_save_seen, settings, seen)
        except Exception:  # pragma: no cover - keep the loop alive
            logger.exception("Bhavcopy watch scan crashed")
        await asyncio.sleep(interval)

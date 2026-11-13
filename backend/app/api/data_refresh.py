"""Market-data source status and on-demand Upstox refresh."""

import asyncio
import logging
import re
from pathlib import PurePath

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.auth import current_user
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.data import upstox, watcher
from app.data.loader import load_file

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/data", tags=["data"])


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: int | None = Field(default=None, ge=1, le=3650)
    include_expired: bool | None = None


@router.get("/status")
def data_status(settings: Settings = Depends(get_settings)):
    status = upstox.refresh_status(settings)
    status["can_refresh_requires_login"] = True
    status["watch"] = watcher.watch_status()
    return status


MAX_UPLOAD_BYTES = 15 * 1024 * 1024
BHAVCOPY_NAME = re.compile(r"BhavCopyDateWise_(\d{8})(?: ?\(\d+\))?\.csv", re.I)


def require_data_admin(user: dict, settings: Settings) -> None:
    admins = {email.lower() for email in settings.data_admin_emails}
    if admins and user["email"].lower() not in admins:
        raise HTTPException(403, "Only data administrators can change market data.")


def canonical_bhavcopy_name(filename: str, content: bytes) -> str:
    """Return BhavCopyDateWise_DDMMYYYY.csv for the trade date in the file.

    The Date column wins over the file name: MCX can serve the latest session
    under whatever date was picked, so the name alone is not trusted.
    """
    name = PurePath(filename.replace("\\", "/")).name
    if not name.lower().endswith(".csv"):
        raise HTTPException(422, "Upload the MCX Bhavcopy as a .csv file.")
    day = watcher.bhavcopy_trade_date(content)
    if day is not None:
        return f"BhavCopyDateWise_{day:%d%m%Y}.csv"
    match = BHAVCOPY_NAME.fullmatch(name)
    if match:
        return f"BhavCopyDateWise_{match[1]}.csv"
    raise HTTPException(
        422,
        "Couldn't determine the trade date. Rename the file to "
        "BhavCopyDateWise_DDMMYYYY.csv and retry.",
    )


@router.post("/upload")
async def upload_bhavcopy(
    request: Request,
    filename: str = Query(min_length=1, max_length=255),
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    """Import one MCX Bhavcopy CSV sent as the raw request body."""
    require_data_admin(user, settings)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 15 MB.")
    content = await request.body()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 15 MB.")
    if not content.strip():
        raise HTTPException(422, "The file is empty.")
    stored_as = canonical_bhavcopy_name(filename, content)
    directory = settings.data_cache_dir
    directory = directory if directory.is_absolute() else BACKEND_DIR / directory
    directory = directory / "raw_csv"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / stored_as
    previous = path.read_bytes() if path.exists() else None
    path.write_bytes(content)
    result = await asyncio.to_thread(load_file, path, settings=settings)
    if result.status != "ok":
        # Keep the private archive limited to files that imported successfully.
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(previous)
    return {
        "file_name": PurePath(filename).name,
        "stored_as": stored_as,
        "status": result.status,
        "trade_date": result.trade_date.isoformat() if result.trade_date else None,
        "rows_total": result.rows_total,
        "rows_kept": result.rows_kept,
        "notes": (result.notes or "")[:500],
    }


@router.post("/refresh")
def data_refresh(
    body: RefreshRequest | None = None,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    require_data_admin(user, settings)
    body = body or RefreshRequest()
    try:
        result = upstox.refresh(
            settings,
            days=body.days,
            include_expired=body.include_expired,
            trigger=f"user:{user['id']}",
        )
    except upstox.UpstoxError as exc:
        status = 409 if "already running" in str(exc) else 503
        raise HTTPException(status, str(exc)) from None
    return {
        "status": result.status,
        "rows": result.rows,
        "contracts": result.contracts,
        "latest_trade_date": (
            result.latest_trade_date.isoformat() if result.latest_trade_date else None
        ),
        "message": result.message(),
    }


async def auto_refresh_loop(settings: Settings) -> None:
    """Periodically refresh while the API runs. Failures are logged, not raised."""
    interval = settings.auto_refresh_hours * 3600
    await asyncio.sleep(5)
    while True:
        try:
            result = await asyncio.to_thread(
                upstox.refresh, settings, trigger="scheduled"
            )
            logger.info("Scheduled refresh: %s", result.message())
        except upstox.UpstoxError as exc:
            logger.warning("Scheduled refresh skipped: %s", exc)
        except Exception:  # pragma: no cover - keep the loop alive
            logger.exception("Scheduled refresh crashed")
        await asyncio.sleep(interval)

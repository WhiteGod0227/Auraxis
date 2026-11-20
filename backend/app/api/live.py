"""Live intraday quotes: the latest in-memory snapshot (never calls Upstox)."""

from fastapi import APIRouter, Depends, Response

from app.core.config import Settings, get_settings
from app.data.live import service

router = APIRouter(prefix="/api", tags=["live"])


@router.get("/live")
def live_snapshot(response: Response, settings: Settings = Depends(get_settings)):
    """Latest live prices, provisional gaps and polling state.

    Browsers poll this shortly after ``next_poll_at``; it only reads memory, so
    viewers never multiply requests to Upstox.
    """
    response.headers["Cache-Control"] = "no-store"
    return service.snapshot(settings)

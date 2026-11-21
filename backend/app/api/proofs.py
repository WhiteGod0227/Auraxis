"""Proof of research API: list, download and verify Bitcoin-anchored proofs."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api import workspaces
from app.api.auth import current_user
from app.core.config import Settings, get_settings
from app.data import proofs

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/proofs", tags=["proofs"])
MAX_VERIFY_BYTES = 256 * 1024


def _enabled(settings: Settings) -> None:
    if not settings.proofs_enabled:
        raise HTTPException(404, "Proofs are turned off on this server.")


def _summary(row, batch) -> dict:
    status = batch["status"] if batch else "queued"
    return dict(
        id=row["id"],
        kind=row["kind"],
        title=row["title"],
        created_at=row["created_at"],
        status=status,
        batch_id=row["batch_id"],
        bitcoin_height=batch["bitcoin_height"] if batch else None,
        bitcoin_time=batch["bitcoin_time"] if batch else None,
    )


@router.get("")
def list_proofs(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    _enabled(settings)
    with proofs.database(settings) as db:
        rows = db.execute(
            "SELECT * FROM records WHERE user_id=? ORDER BY id DESC LIMIT 200",
            (user["id"],),
        ).fetchall()
        batches = {
            row["id"]: row
            for row in db.execute(
                "SELECT id,status,bitcoin_height,bitcoin_time FROM batches WHERE id IN "
                "(SELECT DISTINCT batch_id FROM records WHERE user_id=?)",
                (user["id"],),
            )
        }
    return dict(
        batch_minutes=settings.proofs_batch_minutes,
        proofs=[_summary(row, batches.get(row["batch_id"])) for row in rows],
    )


@router.get("/{proof_id}")
def get_proof(
    proof_id: int,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    _enabled(settings)
    with proofs.database(settings) as db:
        row = db.execute(
            "SELECT * FROM records WHERE id=? AND user_id=?", (proof_id, user["id"])
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Proof not found.")
    return proofs.bundle(settings, row)


@router.post("/research/{workspace_id}", status_code=201)
def certify_research(
    workspace_id: str,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    """Certify the current revision of one of your saved research notes."""
    _enabled(settings)
    with workspaces.database(settings) as db:
        row = workspaces.owned(db, workspace_id, user["id"])
        saved = workspaces.read_row(row).model_dump(mode="json")
    content = dict(
        type="research_note",
        workspace_id=saved["id"],
        revision=saved["revision"],
        title=saved["title"],
        notes=saved["notes"],
        configuration=saved["configuration"],
        saved_context=saved["saved_context"],
        updated_at=saved["updated_at"],
    )
    record = proofs.certify(
        settings,
        user["id"],
        "research",
        f"{saved['id']}:r{saved['revision']}",
        saved["title"],
        content,
    )
    return dict(
        id=record["id"], status="queued" if record["batch_id"] is None else "sealed"
    )


@router.post("/verify")
async def verify(request: Request, settings: Settings = Depends(get_settings)):
    """Public: verify a proof file someone shared (no login needed)."""
    _enabled(settings)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_VERIFY_BYTES:
        raise HTTPException(413, "Proof file is too large.")
    body = await request.body()
    if len(body) > MAX_VERIFY_BYTES:
        raise HTTPException(413, "Proof file is too large.")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(422, "That is not a proof file (invalid JSON).") from None
    if not isinstance(data, dict) or data.get("format") != proofs.FORMAT:
        raise HTTPException(422, "That is not an Auraxis proof file.")
    return proofs.verify_bundle(settings, data)


def certify_trades(settings: Settings, user_id: int, rows) -> None:
    """Fingerprint closed practice trades (idempotent). Never raises."""
    if not settings.proofs_enabled:
        return
    items = []
    for row in rows:
        if row["status"] != "closed":
            continue
        content = dict(
            type="practice_trade",
            currency="Demo ₹ (no cash value)",
            position_id=row["id"],
            kind=row["kind"],
            instrument=row["instrument"],
            expiry=row["expiry"],
            side=row["side"],
            grams=row["grams"],
            entry_a=row["entry_a"],
            entry_b=row["entry_b"],
            exit_a=row["exit_a"],
            exit_b=row["exit_b"],
            entry_cost_paise=row["entry_cost_paise"],
            exit_cost_paise=row["exit_cost_paise"],
            net_paise=row["net_paise"],
            opened_at=row["opened_at"],
            closed_at=row["closed_at"],
            close_reason=row["close_reason"],
        )
        items.append(
            (
                "practice_trade",
                f"position:{row['id']}",
                f"Practice {row['kind']} · {row['instrument']}",
                content,
            )
        )
    try:
        proofs.certify_many(settings, user_id, items)
    except Exception:  # proofs must never block trading
        logger.exception("Could not certify practice trades")

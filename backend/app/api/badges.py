"""Soulbound achievement badges on a test network (Phase 4)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException

from app.api import practice, workspaces
from app.api.auth import current_user
from app.api.wallet import _initialize as init_wallet
from app.core.config import Settings, get_settings
from app.data import evm, web3

router = APIRouter(prefix="/api/badges", tags=["badges"])


def _linked_address(settings: Settings, user_id: int) -> str | None:
    with workspaces.database(settings) as db:
        init_wallet(db)
        row = db.execute(
            "SELECT address FROM wallet_links WHERE user_id=?", (user_id,)
        ).fetchone()
    return row["address"] if row else None


def _earned(settings: Settings, user_id: int) -> dict[str, str]:
    with practice.database(settings) as db:
        return {
            row["code"]: row["earned_at"]
            for row in db.execute(
                "SELECT code, earned_at FROM achievements WHERE user_id=?", (user_id,)
            )
        }


def _mints(settings: Settings, user_id: int) -> dict[str, dict]:
    with practice.database(settings) as db:
        web3.init_badges(db)
        return {
            row["code"]: dict(row)
            for row in db.execute(
                "SELECT * FROM badge_mints WHERE user_id=?", (user_id,)
            )
        }


def _network(settings: Settings) -> dict:
    return dict(
        name=settings.web3_network_name,
        chain_id=settings.web3_chain_id,
        explorer=settings.web3_explorer,
        contract=settings.web3_contract or None,
        contract_url=(
            f"{settings.web3_explorer.rstrip('/')}/address/{settings.web3_contract}"
            if settings.web3_contract
            else None
        ),
    )


@router.get("")
def list_badges(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    earned = _earned(settings, user["id"])
    mints = _mints(settings, user["id"])
    badges = []
    for code in web3.BADGES:
        title, description = practice.ACHIEVEMENTS[code]
        mint = mints.get(code)
        badges.append(
            dict(
                code=code,
                title=title,
                description=description,
                earned_at=earned.get(code),
                status=mint["status"] if mint else None,
                address=mint["address"] if mint else None,
                tx_url=web3.tx_url(settings, mint["tx_hash"]) if mint else None,
                token_id=mint["token_id"] if mint else None,
                token_url=web3.token_url(settings, mint["token_id"]) if mint else None,
                error=mint["error"] if mint else "",
            )
        )
    return dict(
        enabled=settings.web3_active,
        network=_network(settings),
        wallet=_linked_address(settings, user["id"]),
        badges=badges,
    )


@router.post("/{code}/claim")
def claim(
    code: str,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    if code not in web3.BADGES:
        raise HTTPException(404, "Unknown badge.")
    if not settings.web3_active:
        raise HTTPException(503, "Badges are not enabled on this server yet.")
    if code not in _earned(settings, user["id"]):
        raise HTTPException(409, "Earn this achievement in Practice first.")
    address = _linked_address(settings, user["id"])
    if not address:
        raise HTTPException(409, "Link a wallet on your Profile to receive badges.")
    existing = _mints(settings, user["id"]).get(code)
    if existing and existing["status"] in {"pending", "minted"}:
        return dict(
            status=existing["status"], tx_url=web3.tx_url(settings, existing["tx_hash"])
        )
    now = datetime.now(UTC).isoformat()
    try:
        token = web3.onchain_token(settings, address, code)
        tx_hash = None if token else web3.send_mint(settings, address, code)
    except evm.EvmError as exc:
        raise HTTPException(503, f"Could not mint right now: {exc}") from None
    status = "minted" if token else "pending"
    with practice.database(settings) as db:
        web3.init_badges(db)
        db.execute(
            "INSERT INTO badge_mints (user_id,code,address,tx_hash,status,token_id,"
            "error,created_at,updated_at) VALUES (?,?,?,?,?,?,'',?,?) "
            "ON CONFLICT(user_id, code) DO UPDATE SET address=excluded.address, "
            "tx_hash=excluded.tx_hash, status=excluded.status, "
            "token_id=excluded.token_id, error='', updated_at=excluded.updated_at",
            (user["id"], code, address, tx_hash, status, token or None, now, now),
        )
    return dict(status=status, tx_url=web3.tx_url(settings, tx_hash))

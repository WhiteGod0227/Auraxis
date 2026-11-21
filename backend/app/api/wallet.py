"""Optional Ethereum wallet link via Sign-In with Ethereum (EIP-4361).

The user asks for a challenge, signs it in their wallet (``personal_sign``:
free, no transaction), and the server recovers the signer from the exact
stored message. A wallet is never required for anything else in Auraxis.
"""

from __future__ import annotations

import secrets
import string
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api import workspaces
from app.api.auth import current_user
from app.core.config import Settings, get_settings
from app.data import ethsig

router = APIRouter(prefix="/api/wallet", tags=["wallet"])
CHALLENGE_MINUTES = 10
NONCE_ALPHABET = string.ascii_letters + string.digits


class ChallengeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(pattern=r"^0x[0-9a-fA-F]{40}$")
    chain_id: int = Field(ge=1, le=2**53 - 1, strict=True)


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nonce: str = Field(pattern=r"^[A-Za-z0-9]{16,64}$")
    signature: str = Field(pattern=r"^0x[0-9a-fA-F]{130}$")


def _initialize(db) -> None:
    db.execute(
        """CREATE TABLE IF NOT EXISTS wallet_links (
            user_id INTEGER PRIMARY KEY,
            address TEXT NOT NULL UNIQUE,
            chain_id INTEGER NOT NULL,
            linked_at TEXT NOT NULL)"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS wallet_challenges (
            nonce TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            expires_at TEXT NOT NULL)"""
    )


def _view(row) -> dict | None:
    if row is None:
        return None
    return dict(
        address=row["address"],
        chain_id=row["chain_id"],
        linked_at=row["linked_at"],
        explorer_url=f"https://etherscan.io/address/{row['address']}",
    )


def _origin(request: Request, settings: Settings) -> str:
    origin = request.headers.get("origin", "")
    # current_user already enforces this for writes; keep it explicit here
    # because the origin becomes the signed domain.
    if origin not in settings.cors_origins:
        raise HTTPException(403, "Request origin is not allowed.")
    return origin


@router.get("")
def get_wallet(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    with workspaces.database(settings) as db:
        _initialize(db)
        row = db.execute(
            "SELECT * FROM wallet_links WHERE user_id=?", (user["id"],)
        ).fetchone()
    return dict(wallet=_view(row))


@router.post("/challenge")
def challenge(
    body: ChallengeRequest,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    origin = _origin(request, settings)
    address = ethsig.checksum_address(body.address)
    now = datetime.now(UTC).replace(microsecond=0)
    expires = now + timedelta(minutes=CHALLENGE_MINUTES)
    nonce = "".join(secrets.choice(NONCE_ALPHABET) for _ in range(24))
    message = ethsig.siwe_message(
        domain=urlparse(origin).netloc,
        address=address,
        uri=origin,
        chain_id=body.chain_id,
        nonce=nonce,
        issued_at=now.isoformat().replace("+00:00", "Z"),
        expiration=expires.isoformat().replace("+00:00", "Z"),
    )
    with workspaces.database(settings) as db:
        _initialize(db)
        # One live challenge per user; expired ones are cleared as we go.
        db.execute(
            "DELETE FROM wallet_challenges WHERE user_id=? OR expires_at<?",
            (user["id"], now.isoformat()),
        )
        db.execute(
            "INSERT INTO wallet_challenges VALUES (?,?,?,?,?,?)",
            (nonce, user["id"], address, body.chain_id, message, expires.isoformat()),
        )
    return dict(nonce=nonce, message=message, expires_at=expires.isoformat())


@router.post("/link")
def link(
    body: LinkRequest,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    now = datetime.now(UTC)
    # 1) Consume the challenge in its own committed transaction, so it is
    #    single use even if the checks below fail.
    with workspaces.database(settings) as db:
        _initialize(db)
        pending = db.execute(
            "SELECT * FROM wallet_challenges WHERE nonce=? AND user_id=?",
            (body.nonce, user["id"]),
        ).fetchone()
        db.execute("DELETE FROM wallet_challenges WHERE nonce=?", (body.nonce,))
    # 2) Verify outside any transaction.
    if pending is None:
        raise HTTPException(
            409, "This sign-in request was used or replaced. Try again."
        )
    if datetime.fromisoformat(pending["expires_at"]) < now:
        raise HTTPException(409, "This sign-in request expired. Try again.")
    try:
        signer = ethsig.recover_address(
            ethsig.personal_message_hash(pending["message"]), body.signature
        )
    except ethsig.SignatureError:
        raise HTTPException(422, "The signature is not valid.") from None
    if signer.lower() != pending["address"].lower():
        raise HTTPException(
            422, "The signature was made by a different wallet than requested."
        )
    # 3) Link (an address belongs to at most one account).
    with workspaces.database(settings) as db:
        owner = db.execute(
            "SELECT user_id FROM wallet_links WHERE lower(address)=lower(?)",
            (signer,),
        ).fetchone()
        if owner is not None and owner["user_id"] != user["id"]:
            raise HTTPException(
                409, "This wallet is already linked to another account."
            )
        db.execute(
            "INSERT INTO wallet_links VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE "
            "SET address=excluded.address, chain_id=excluded.chain_id, "
            "linked_at=excluded.linked_at",
            (user["id"], signer, pending["chain_id"], now.isoformat()),
        )
        row = db.execute(
            "SELECT * FROM wallet_links WHERE user_id=?", (user["id"],)
        ).fetchone()
    return dict(wallet=_view(row))


@router.delete("")
def unlink(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    with workspaces.database(settings) as db:
        _initialize(db)
        db.execute("DELETE FROM wallet_links WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM wallet_challenges WHERE user_id=?", (user["id"],))
    return dict(wallet=None)

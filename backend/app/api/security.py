"""Local password, offline recovery and authenticator controls.

MFA seeds are sensitive recoverable secrets in the private auth store. Deployment
must protect/encrypt that disk and its backups. No email ownership is inferred.
"""

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.auth import (
    COOKIE,
    DUMMY_HASH,
    consume_attempt,
    current_user,
    database,
    fingerprint,
    password_hash,
    password_matches,
    safe_request,
)
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/api/auth/security", tags=["account security"])


class Proof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(default="", max_length=128)


class ChangePassword(Proof):
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Blank password")
        return value


class Recover(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    recovery_code: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    _not_blank = field_validator("new_password")(ChangePassword.not_blank.__func__)


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS account_mfa (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT, pending_secret TEXT, pending_until INTEGER,
        last_step INTEGER NOT NULL DEFAULT -1)""")
    db.execute("""CREATE TABLE IF NOT EXISTS recovery_codes (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL, PRIMARY KEY(user_id,code_hash))""")


def totp(secret, step, digits=6):
    key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**digits)).zfill(digits)


def matching_step(secret, code, last_step=-1):
    if not re.fullmatch(r"[0-9]{6}", code):
        return None
    step = int(time.time()) // 30
    for candidate in (step - 1, step, step + 1):
        if candidate > last_step and hmac.compare_digest(totp(secret, candidate), code):
            return candidate
    return None


def mfa_row(db, user_id):
    if not db.execute(
        "SELECT 1 FROM sqlite_master WHERE name='account_mfa' AND type='table'"
    ).fetchone():
        return None
    return db.execute(
        "SELECT * FROM account_mfa WHERE user_id=?", (user_id,)
    ).fetchone()


def use_recovery(db, user_id, code):
    if not re.fullmatch(r"[0-9a-fA-F]{32}", code):
        return False
    if not db.execute(
        "SELECT 1 FROM sqlite_master WHERE name='recovery_codes' AND type='table'"
    ).fetchone():
        return False
    return (
        db.execute(
            "DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?",
            (user_id, fingerprint(code.lower())),
        ).rowcount
        == 1
    )


def verify_second_factor(db, user_id, code):
    row = mfa_row(db, user_id)
    if not row or not row["secret"]:
        return
    step = matching_step(row["secret"], code, row["last_step"])
    if step is not None:
        db.execute(
            "UPDATE account_mfa SET last_step=? WHERE user_id=?", (step, user_id)
        )
        return
    if use_recovery(db, user_id, code):
        return
    raise HTTPException(
        401, "Enter a fresh authenticator code or an unused recovery code."
    )


def authorize(db, user, body, second_factor=True):
    row = db.execute(
        "SELECT password_hash FROM users WHERE id=?", (user["id"],)
    ).fetchone()
    if not row or not password_matches(body.password, row[0]):
        raise HTTPException(401, "Current password or security proof is incorrect.")
    if second_factor:
        verify_second_factor(db, user["id"], body.code.strip())


def security_attempt(settings, request, user):
    return consume_attempt(settings, request, f"security:{user['id']}")


@router.get("")
def status(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    with database(settings) as db:
        initialize(db)
        row = mfa_row(db, user["id"])
        count = db.execute(
            "SELECT COUNT(*) FROM recovery_codes WHERE user_id=?", (user["id"],)
        ).fetchone()[0]
        return {
            "mfa_enabled": bool(row and row["secret"]),
            "recovery_codes_remaining": count,
            "email_verified": False,
            "email_delivery_configured": False,
        }


@router.post("/mfa/setup")
def setup(
    body: Proof,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    attempt = security_attempt(settings, request, user)
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        authorize(db, user, body)
        row = mfa_row(db, user["id"])
        if row and row["secret"]:
            raise HTTPException(
                409,
                "MFA is already enabled. Disable it before replacing the "
                "authenticator.",
            )
        secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
        db.execute(
            "INSERT INTO account_mfa(user_id,pending_secret,pending_until) "
            "VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
            "pending_secret=excluded.pending_secret,pending_until=excluded.pending_until",
            (user["id"], secret, int(time.time()) + 600),
        )
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
        label = quote(f"Auraxis:{user['email']}", safe="")
        return {
            "secret": secret,
            "otpauth_uri": f"otpauth://totp/{label}?secret={secret}&issuer=Auraxis&algorithm=SHA1&digits=6&period=30",
            "expires_in_seconds": 600,
        }


def generate_recovery(db, user_id):
    codes = [secrets.token_hex(16) for _ in range(8)]
    db.execute("DELETE FROM recovery_codes WHERE user_id=?", (user_id,))
    db.executemany(
        "INSERT INTO recovery_codes VALUES (?,?)",
        [(user_id, fingerprint(code)) for code in codes],
    )
    return codes


@router.post("/mfa/confirm")
def confirm(
    body: Proof,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    attempt = security_attempt(settings, request, user)
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        authorize(db, user, body, second_factor=False)
        row = mfa_row(db, user["id"])
        if (
            not row
            or row["secret"]
            or not row["pending_secret"]
            or row["pending_until"] < int(time.time())
        ):
            raise HTTPException(
                409, "MFA setup is unavailable or expired. Start setup again."
            )
        step = matching_step(row["pending_secret"], body.code.strip())
        if step is None:
            raise HTTPException(401, "Authenticator code is incorrect.")
        db.execute(
            "UPDATE account_mfa SET "
            "secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_step=? "
            "WHERE user_id=?",
            (step, user["id"]),
        )
        codes = generate_recovery(db, user["id"])
        db.execute(
            "DELETE FROM sessions WHERE user_id=? AND token_hash!=?",
            (user["id"], fingerprint(request.cookies.get(COOKIE, ""))),
        )
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
        return {
            "recovery_codes": codes,
            "message": "MFA enabled. Other sessions revoked. Save these "
            "recovery codes privately; they are displayed only "
            "once.",
        }


@router.post("/mfa/disable")
def disable(
    body: Proof,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    attempt = security_attempt(settings, request, user)
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        authorize(db, user, body)
        db.execute("DELETE FROM account_mfa WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM recovery_codes WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
    return {"message": "MFA disabled and recovery codes invalidated. Sign in again."}


@router.post("/recovery-codes")
def recovery_codes(
    body: Proof,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    attempt = security_attempt(settings, request, user)
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        authorize(db, user, body)
        codes = generate_recovery(db, user["id"])
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
        return {
            "recovery_codes": codes,
            "message": "New codes replace all previous codes. Save them "
            "privately; each works once.",
        }


@router.post("/password")
def change_password(
    body: ChangePassword,
    request: Request,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    attempt = security_attempt(settings, request, user)
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        authorize(db, user, body)
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (password_hash(body.new_password), user["id"]),
        )
        db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
    return {"message": "Password changed. All sessions were revoked. Sign in again."}


@router.post("/recover")
def recover(
    body: Recover, request: Request, settings: Settings = Depends(safe_request)
):
    attempt = consume_attempt(
        settings, request, f"recover:{body.email.strip().lower()}"
    )
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        user = db.execute(
            "SELECT id FROM users WHERE email=?", (body.email.strip().lower(),)
        ).fetchone()
        if not user or not use_recovery(db, user["id"], body.recovery_code.strip()):
            # Equal password work for both unknown accounts and invalid codes.
            password_matches(body.new_password, DUMMY_HASH)
            raise HTTPException(401, "Email or recovery code is incorrect.")
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (password_hash(body.new_password), user["id"]),
        )
        db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM attempts WHERE key=?", (attempt,))
    return {
        "message": "Password reset. All sessions revoked. MFA remains enabled "
        "if configured; use an authenticator or another unused "
        "recovery code to sign in."
    }

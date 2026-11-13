"""Local account authentication, separate from the read-only market database."""

import hashlib
import re
import secrets
import sqlite3
import time
import unicodedata
from contextlib import contextmanager
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import BACKEND_DIR, Settings, get_settings

COOKIE = "auraxis_session"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
ITERATIONS = 600_000
router = APIRouter(prefix="/api/auth", tags=["accounts"])


def validate_name(value):
    if not isinstance(value, str) or any(
        unicodedata.category(char) in {"Cc", "Cs", "Zl", "Zp"}
        or (unicodedata.category(char) == "Cf" and char not in "\u200c\u200d")
        for char in value
    ):
        raise ValueError("Use a name without control characters.")
    value = value.strip()
    if not 1 <= len(value) <= 100:
        raise ValueError("Name must contain 1–100 characters.")
    return value


class NameUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)

    _name = field_validator("name", mode="before")(validate_name)


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    otp: str = Field(default="", max_length=128)

    @field_validator("email")
    @classmethod
    def email_format(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Invalid email address")
        return value


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def name_format(cls, value):
        return validate_name(value)

    @field_validator("password")
    @classmethod
    def password_length(cls, value):
        if len(value) < 8 or not value.strip():
            raise ValueError("Use at least 8 characters")
        return value


class User(BaseModel):
    id: int
    name: str
    email: str


class Account(BaseModel):
    user: User


class ProfileUser(User):
    # Legacy accounts have no creation evidence; never backfill a guessed date.
    created_at: datetime | None = None


class Profile(BaseModel):
    user: ProfileUser


def fingerprint(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), ITERATIONS
    ).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def password_matches(password, stored):
    _, iterations, salt, expected = stored.split("$")
    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
    ).hex()
    return secrets.compare_digest(actual, expected)


DUMMY_HASH = password_hash("not-a-real-user", "00" * 16)


@contextmanager
def database(settings):
    path = settings.auth_database_path
    path = path if path.is_absolute() else BACKEND_DIR / path
    # Never put account tables into the existing market DB, even by mistake.
    from sqlalchemy.engine import make_url

    market = make_url(settings.database_url).database
    workspace = (BACKEND_DIR / settings.workspace_database_path).resolve()
    frontend = BACKEND_DIR.parent / "frontend"
    public_roots = [frontend / name for name in ("public", "dist", "dist-deploy")]
    if path.resolve() == workspace or any(
        path.resolve().is_relative_to(root.resolve()) for root in public_roots
    ):
        raise HTTPException(503, "Private account storage is not configured safely.")
    if market and market != ":memory:":
        market_path = BACKEND_DIR / market
        if path.resolve() == market_path.resolve():
            raise RuntimeError("Account and market storage must be separate")
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts (
                key TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL
            );
        """)
        with connection:
            yield connection
    finally:
        connection.close()


def safe_request(request: Request, response: Response, settings=Depends(get_settings)):
    response.headers["Cache-Control"] = "no-store"
    if request.method != "GET" and request.headers.get("origin") not in {
        origin for origin in settings.cors_origins if origin != "*"
    }:
        raise HTTPException(403, "Account request origin is not allowed.")
    return settings


def consume_attempt(settings, request, key):
    # Persistent, atomic local limit. Not a replacement for hosted edge limits.
    key = fingerprint(f"{request.client.host if request.client else ''}:{key}")
    now = int(time.time())
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM attempts WHERE started <= ?", (now - 600,))
        row = db.execute("SELECT count FROM attempts WHERE key=?", (key,)).fetchone()
        if row and row["count"] >= 5:
            raise HTTPException(429, "Too many attempts. Try again in 10 minutes.")
        db.execute(
            "INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) "
            "DO UPDATE SET count=count+1",
            (key, now),
        )
    return key


def start_session(db, request, response, user_id, settings):
    previous = request.cookies.get(COOKIE)
    if previous:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (fingerprint(previous),))
    token = secrets.token_urlsafe(32)
    seconds = settings.auth_session_hours * 3600
    db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
    db.execute(
        "INSERT INTO sessions VALUES (?,?,?)",
        (
            fingerprint(token),
            user_id,
            int(time.time()) + seconds,
        ),
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=seconds,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/signup", response_model=Account, status_code=201)
def signup(
    body: Registration,
    request: Request,
    response: Response,
    settings: Settings = Depends(safe_request),
):
    consume_attempt(settings, request, "signup")
    hashed = password_hash(body.password)
    try:
        with database(settings) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS account_metadata ("
                "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, "
                "created_at TEXT NOT NULL)"
            )
            cursor = db.execute(
                "INSERT INTO users(name,email,password_hash) VALUES (?,?,?)",
                (body.name, body.email, hashed),
            )
            user_id = cursor.lastrowid
            db.execute(
                "INSERT INTO account_metadata VALUES (?,?)",
                (user_id, datetime.now(UTC).isoformat()),
            )
            start_session(db, request, response, user_id, settings)
    except sqlite3.IntegrityError:
        raise HTTPException(
            409, "Unable to create account. Try logging in instead."
        ) from None
    return {"user": {"id": user_id, "name": body.name, "email": body.email}}


@router.post("/login", response_model=Account)
def login(
    body: Credentials,
    request: Request,
    response: Response,
    settings: Settings = Depends(safe_request),
):
    key = consume_attempt(settings, request, f"login:{body.email}")
    with database(settings) as db:
        user = db.execute("SELECT * FROM users WHERE email=?", (body.email,)).fetchone()
    # Use the same work factor for nonexistent accounts, without a fast exit.
    stored = user["password_hash"] if user else DUMMY_HASH
    valid = password_matches(body.password, stored)
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect.")
    with database(settings) as db:
        from app.api.security import verify_second_factor

        db.execute("BEGIN IMMEDIATE")
        # Recheck inside the transaction so a concurrent password reset cannot
        # be followed by a login with the previous password.
        current = db.execute(
            "SELECT password_hash FROM users WHERE id=?", (user["id"],)
        ).fetchone()
        if not current or current[0] != stored:
            raise HTTPException(401, "Credentials changed. Please retry.")
        require_second_factor(db, user["id"], body.otp)
        verify_second_factor(db, user["id"], body.otp.strip())
        db.execute("DELETE FROM attempts WHERE key=?", (key,))
        start_session(db, request, response, user["id"], settings)
    return {"user": {key: user[key] for key in ("id", "name", "email")}}


def require_second_factor(db, user_id, otp):
    """Ask the client for a second step instead of failing a blank MFA code."""
    from app.api.security import mfa_row

    row = mfa_row(db, user_id)
    if row and row["secret"] and not otp.strip():
        raise HTTPException(
            401,
            "Enter the 6-digit code from your authenticator app, or a recovery code.",
            headers={"X-Auth-Step": "mfa"},
        )


class GoogleCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=20, max_length=4096)
    otp: str = Field(default="", max_length=128)


@router.get("/providers")
def providers(response: Response, settings: Settings = Depends(get_settings)):
    response.headers["Cache-Control"] = "no-store"
    return {"google_client_id": settings.google_client_id.strip() or None}


def verify_google_credential(credential, settings):
    try:
        reply = httpx.get(GOOGLE_TOKENINFO, params={"id_token": credential}, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(
            503, "Google sign-in is temporarily unavailable. Please retry."
        ) from None
    info = reply.json() if reply.status_code == 200 else {}
    try:
        expires = int(info.get("exp", 0))
    except (TypeError, ValueError):
        expires = 0
    if (
        info.get("aud") != settings.google_client_id.strip()
        or info.get("iss") not in GOOGLE_ISSUERS
        or str(info.get("email_verified", "")).lower() != "true"
        or expires < time.time()
        or not info.get("email")
    ):
        raise HTTPException(401, "Google sign-in could not be verified.")
    return info


@router.post("/google", response_model=Account)
def google_login(
    body: GoogleCredential,
    request: Request,
    response: Response,
    settings: Settings = Depends(safe_request),
):
    if not settings.google_client_id.strip():
        raise HTTPException(404, "Google sign-in is not configured.")
    key = consume_attempt(settings, request, "google")
    info = verify_google_credential(body.credential, settings)
    email = str(info["email"]).strip().lower()
    try:
        name = validate_name(str(info.get("name") or email.split("@")[0]))
    except ValueError:
        name = email.split("@")[0][:100] or "Gold researcher"
    from app.api.security import verify_second_factor

    with database(settings) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS account_metadata ("
            "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, "
            "created_at TEXT NOT NULL)"
        )
        db.execute("BEGIN IMMEDIATE")
        user = db.execute(
            "SELECT id,name,email FROM users WHERE email=?", (email,)
        ).fetchone()
        if user:
            # Google proves the email; an enabled authenticator still applies.
            require_second_factor(db, user["id"], body.otp)
            verify_second_factor(db, user["id"], body.otp.strip())
            user = dict(user)
        else:
            # Unknown random password: Google accounts sign in with Google
            # (or set a password later through recovery-code reset).
            cursor = db.execute(
                "INSERT INTO users(name,email,password_hash) VALUES (?,?,?)",
                (name, email, password_hash(secrets.token_urlsafe(32))),
            )
            user = {"id": cursor.lastrowid, "name": name, "email": email}
            db.execute(
                "INSERT INTO account_metadata VALUES (?,?)",
                (user["id"], datetime.now(UTC).isoformat()),
            )
        db.execute("DELETE FROM attempts WHERE key=?", (key,))
        start_session(db, request, response, user["id"], settings)
    return {"user": user}


def current_user(request: Request, settings: Settings = Depends(safe_request)):
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please log in.")
    with database(settings) as db:
        user = db.execute(
            "SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON u.id=s.user_id "
            "WHERE s.token_hash=? AND s.expires_at>?",
            (fingerprint(token), int(time.time())),
        ).fetchone()
    if not user:
        raise HTTPException(401, "Session expired. Please log in again.")
    return dict(user)


def creation_timestamp(user_id, settings):
    with database(settings) as db:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_metadata'"
        ).fetchone():
            return None
        row = db.execute(
            "SELECT created_at FROM account_metadata WHERE user_id=?", (user_id,)
        ).fetchone()
        return row[0] if row else None


@router.get("/me", response_model=Account)
def me(user: dict = Depends(current_user)):
    return {"user": user}


@router.get("/profile", response_model=Profile)
def profile(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    return {"user": {**user, "created_at": creation_timestamp(user["id"], settings)}}


@router.patch("/profile", response_model=Profile)
def update_profile(
    body: NameUpdate,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        changed = db.execute(
            "UPDATE users SET name=? WHERE id=?", (body.name, user["id"])
        )
        if changed.rowcount != 1:
            raise HTTPException(401, "Session expired. Please log in again.")
    return {
        "user": {
            **user,
            "name": body.name,
            "created_at": creation_timestamp(user["id"], settings),
        }
    }


@router.post("/logout", status_code=204)
def logout(
    request: Request, response: Response, settings: Settings = Depends(safe_request)
):
    token = request.cookies.get(COOKIE)
    if token:
        with database(settings) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (fingerprint(token),))
    response.delete_cookie(
        COOKIE,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )

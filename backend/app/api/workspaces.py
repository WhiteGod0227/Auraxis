"""Private configuration storage. Deliberately excluded from snapshot exports."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.api.auth import current_user
from app.api.workspace_schemas import (
    Workspace,
    WorkspaceCreate,
    WorkspaceList,
    WorkspaceUpdate,
)
from app.core.config import BACKEND_DIR, Settings, get_settings

router = APIRouter(prefix="/api/workspaces", tags=["private workspaces"])


@contextmanager
def database(settings):
    def resolved(path):
        return (BACKEND_DIR / path).resolve()

    path = resolved(settings.workspace_database_path)
    market = make_url(settings.database_url).database
    protected = {resolved(settings.auth_database_path)}
    if market and market != ":memory:":
        protected.add(resolved(market))
    public = BACKEND_DIR.parent / "frontend" / "public"
    if path in protected or path.is_relative_to(public.resolve()):
        raise HTTPException(503, "Private workspace storage is not configured safely.")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        # Additive version-1 schema, following the existing auth store convention.
        db.execute("""CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL,
            title TEXT NOT NULL, notes TEXT NOT NULL,
            configuration_version INTEGER NOT NULL, configuration TEXT NOT NULL,
            saved_context TEXT NOT NULL, revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS workspace_owner ON workspaces(owner_id)")
        with db:
            yield db
    finally:
        db.close()


def read_row(row):
    try:
        data = dict(row)
        for field in ("configuration", "saved_context"):
            data[field] = json.loads(data[field])
        return Workspace.model_validate(data)
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(
            409,
            "Workspace configuration is incompatible. "
            "Recreate it from the analysis page.",
        ) from None


def owned(db, identifier, owner):
    row = db.execute(
        "SELECT * FROM workspaces WHERE id=? AND owner_id=?", (str(identifier), owner)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Workspace not found.")
    return row


@router.post("", response_model=Workspace, status_code=201)
def create(
    body: WorkspaceCreate,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    cfg = body.configuration
    pair = getattr(getattr(cfg, "query", None), "pair", None)
    product = getattr(getattr(cfg, "curve", None), "product", None)
    if (pair and pair not in settings.spread_pairs) or (
        product and product not in settings.bhavcopy_symbols
    ):
        raise HTTPException(422, "This research configuration is not supported.")
    now = datetime.now(UTC).isoformat()
    data = body.model_dump(mode="json")
    data.update(
        id=str(uuid4()), owner_id=user["id"], revision=1, created_at=now, updated_at=now
    )
    with database(settings) as db:
        db.execute(
            "INSERT INTO workspaces VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                data["id"],
                user["id"],
                body.title,
                body.notes,
                1,
                json.dumps(data["configuration"], allow_nan=False),
                json.dumps(data["saved_context"], allow_nan=False),
                1,
                now,
                now,
            ),
        )
    return data


@router.get("", response_model=WorkspaceList)
def list_workspaces(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        total = db.execute(
            "SELECT COUNT(*) FROM workspaces WHERE owner_id=?", (user["id"],)
        ).fetchone()[0]
        rows = db.execute(
            "SELECT * FROM workspaces WHERE owner_id=? "
            "ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?",
            (user["id"], limit, offset),
        ).fetchall()
    return {
        "items": [read_row(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{identifier}", response_model=Workspace)
def get_workspace(
    identifier: UUID,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        return read_row(owned(db, identifier, user["id"]))


@router.patch("/{identifier}", response_model=Workspace)
def update(
    identifier: UUID,
    body: WorkspaceUpdate,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        # The read, revision check and mutation share a write transaction.
        db.execute("BEGIN IMMEDIATE")
        row = owned(db, identifier, user["id"])
        if row["revision"] != body.revision:
            raise HTTPException(
                409, "Workspace changed in another tab. Reload before editing."
            )
        db.execute(
            "UPDATE workspaces SET title=?,notes=?,revision=revision+1,updated_at=? "
            "WHERE id=? AND owner_id=? AND revision=?",
            (
                body.title,
                body.notes,
                datetime.now(UTC).isoformat(),
                str(identifier),
                user["id"],
                body.revision,
            ),
        )
        return read_row(owned(db, identifier, user["id"]))


@router.delete("/{identifier}", status_code=204)
def delete(
    identifier: UUID,
    revision: int = Query(ge=1),
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        row = owned(db, identifier, user["id"])
        if row["revision"] != revision:
            raise HTTPException(
                409, "Workspace changed in another tab. Reload before deleting."
            )
        db.execute(
            "DELETE FROM workspaces WHERE id=? AND owner_id=? AND revision=?",
            (str(identifier), user["id"], revision),
        )

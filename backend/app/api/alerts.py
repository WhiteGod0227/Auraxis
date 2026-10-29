"""Authenticated alert-rule synchronization; no background market monitoring."""

import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.auth import current_user
from app.api.workspaces import database
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/api/alerts", tags=["private alerts"])
PAIRS = {
    "GOLDTEN-GOLDPETAL",
    "GOLDTEN-GOLDGUINEA",
    "GOLDGUINEA-GOLDPETAL",
    "GOLDM-GOLDTEN",
    "GOLDM-GOLDGUINEA",
    "GOLDM-GOLDPETAL",
}


class AlertRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9-]{1,80}$")
    pair: str
    metric: str
    threshold: float = Field(gt=0, le=100, allow_inf_nan=False)
    expiry: date | None

    @field_validator("pair")
    @classmethod
    def supported_pair(cls, value):
        if value not in PAIRS:
            raise ValueError("Unsupported pair")
        return value

    @field_validator("metric")
    @classmethod
    def supported_metric(cls, value):
        if value not in {"abs_z", "abs_spread_pct"}:
            raise ValueError("Unsupported metric")
        return value


class AlertRulesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    rules: list[AlertRule] = Field(max_length=20)

    @model_validator(mode="after")
    def unique_rules(self):
        if len({r.id for r in self.rules}) != len(self.rules):
            raise ValueError("Duplicate identifiers")
        keys = {(r.pair, r.metric, r.threshold, r.expiry) for r in self.rules}
        if len(keys) != len(self.rules):
            raise ValueError("Duplicate rules")
        return self


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS alert_rules (
        owner_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL,
        rules TEXT NOT NULL, updated_at TEXT NOT NULL)""")


def read(db, owner):
    row = db.execute(
        "SELECT revision,rules,updated_at FROM alert_rules WHERE owner_id=?", (owner,)
    ).fetchone()
    if row is None:
        return {"revision": 0, "rules": [], "updated_at": None}
    try:
        result = AlertRulesUpdate(
            revision=row["revision"], rules=json.loads(row["rules"])
        )
    except (ValueError, TypeError):
        raise HTTPException(
            409,
            "Stored alerts are incompatible. Contact the administrator before "
            "replacing them.",
        ) from None
    return {**result.model_dump(mode="json"), "updated_at": row["updated_at"]}


@router.get("/rules")
def get_rules(
    user: dict = Depends(current_user), settings: Settings = Depends(get_settings)
):
    with database(settings) as db:
        initialize(db)
        return read(db, user["id"])


@router.put("/rules")
def replace_rules(
    body: AlertRulesUpdate,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    if any(rule.pair not in settings.spread_pairs for rule in body.rules):
        raise HTTPException(422, "An alert pair is not supported by this backend.")
    with database(settings) as db:
        initialize(db)
        db.execute("BEGIN IMMEDIATE")
        current = read(db, user["id"])
        if current["revision"] != body.revision:
            raise HTTPException(
                409, "Account alerts changed in another tab. Reload before saving."
            )
        now = datetime.now(UTC).isoformat()
        rules = json.dumps(
            [r.model_dump(mode="json") for r in body.rules], allow_nan=False
        )
        db.execute(
            "INSERT INTO alert_rules VALUES (?,?,?,?) ON CONFLICT(owner_id) "
            "DO UPDATE SET "
            "revision=excluded.revision,rules=excluded.rules,updated_at=excluded.updated_at",
            (user["id"], current["revision"] + 1, rules, now),
        )
        return read(db, user["id"])

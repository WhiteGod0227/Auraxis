"""Version 1 stores request parameters and selection modes, never results."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

Product = Literal["GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"]
Pair = Literal[
    "GOLDTEN-GOLDPETAL",
    "GOLDTEN-GOLDGUINEA",
    "GOLDGUINEA-GOLDPETAL",
    "GOLDM-GOLDTEN",
    "GOLDM-GOLDGUINEA",
    "GOLDM-GOLDPETAL",
]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


def iso_date(value):
    if isinstance(value, str):
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError("Use ISO YYYY-MM-DD.")
    elif not isinstance(value, date):
        raise ValueError("Use ISO YYYY-MM-DD.")
    return value


ISODate = Annotated[date, BeforeValidator(iso_date)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Selection(StrictModel):
    mode: Literal["latest", "explicit"]
    value: ISODate | None

    @model_validator(mode="after")
    def consistent(self):
        if (self.mode == "latest") != (self.value is None):
            raise ValueError("Latest requires null; explicit requires an ISO date.")
        return self


class SpreadQuery(StrictModel):
    pair: Pair
    expiry: ISODate | None
    start: ISODate | None
    end: ISODate | None
    window: StrictInt = Field(ge=1, le=1000)
    min_periods: StrictInt = Field(ge=1, le=1000)
    carry_adjusted: StrictBool
    purity: StrictBool
    min_volume_grams: Nonnegative
    min_oi_grams: Nonnegative

    @model_validator(mode="after")
    def valid_window(self):
        if self.min_periods > self.window:
            raise ValueError("Minimum periods exceeds window.")
        if self.start and self.end and self.start > self.end:
            raise ValueError("Start exceeds end.")
        return self


class RelativeConfiguration(StrictModel):
    kind: Literal["relative_value"]
    query: SpreadQuery
    expiry: Selection

    @model_validator(mode="after")
    def consistent(self):
        if self.query.expiry is not None and self.query.expiry != self.expiry.value:
            raise ValueError("Expiry selection must agree with request filter.")
        return self


class CurveQuery(StrictModel):
    product: Product
    date: ISODate | None
    purity: StrictBool


class RollQuery(StrictModel):
    product: Product
    expiry: ISODate | None
    start: ISODate | None
    end: ISODate | None
    purity: StrictBool

    @model_validator(mode="after")
    def valid_range(self):
        if self.start and self.end and self.start > self.end:
            raise ValueError("Start exceeds end.")
        return self


class TermConfiguration(StrictModel):
    kind: Literal["term_structure"]
    curve: CurveQuery
    roll: RollQuery
    curve_expiry: Selection
    roll_expiry: Selection

    @model_validator(mode="after")
    def consistent(self):
        if (self.curve.product, self.curve.purity) != (
            self.roll.product,
            self.roll.purity,
        ):
            raise ValueError("Curve and roll-down settings must agree.")
        if self.roll.expiry is not None and self.roll.expiry != self.roll_expiry.value:
            raise ValueError("Roll-down expiry must agree with request filter.")
        return self


class BacktestQuery(StrictModel):
    pair: Literal["GOLDTEN-GOLDPETAL", "GOLDTEN-GOLDGUINEA", "GOLDGUINEA-GOLDPETAL"]
    expiry: ISODate | None
    window: StrictInt = Field(ge=1, le=1000)
    min_periods: StrictInt = Field(ge=1, le=1000)
    z_entry: float = Field(gt=0, allow_inf_nan=False)
    z_exit: Nonnegative
    max_hold_sessions: StrictInt = Field(ge=1, le=10000)
    expiry_buffer_calendar_days: StrictInt = Field(ge=0, le=10000)
    min_volume_grams: Nonnegative
    min_oi_grams: Nonnegative
    notional_per_leg: float = Field(gt=0, allow_inf_nan=False)
    cost_bps_per_leg_per_side: Nonnegative
    purity: StrictBool
    sizing_mode: Literal["fractional", "integer_lots"]

    @model_validator(mode="after")
    def valid_thresholds(self):
        if self.z_exit >= self.z_entry or self.min_periods > self.window:
            raise ValueError("Incompatible thresholds or rolling window.")
        return self


class BacktestConfiguration(StrictModel):
    kind: Literal["backtest"]
    query: BacktestQuery
    expiry: Selection

    @model_validator(mode="after")
    def consistent(self):
        if self.query.expiry is not None and self.query.expiry != self.expiry.value:
            raise ValueError("Report expiry must agree with request filter.")
        return self


Configuration = Annotated[
    RelativeConfiguration | TermConfiguration | BacktestConfiguration,
    Field(discriminator="kind"),
]


class Context(StrictModel):
    data_as_of: ISODate | None
    source: Literal["API", "Offline snapshot"]


class WorkspaceCreate(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=5000)
    configuration_version: Literal[1]
    configuration: Configuration
    saved_context: Context

    @field_validator("title")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Title must not be blank.")
        return value


class WorkspaceUpdate(StrictModel):
    revision: StrictInt = Field(ge=1)
    title: str = Field(min_length=1, max_length=120)
    notes: str = Field(max_length=5000)

    _nonblank = field_validator("title")(WorkspaceCreate.nonblank.__func__)


class Workspace(WorkspaceCreate):
    id: str
    owner_id: int
    revision: int
    created_at: datetime
    updated_at: datetime


class WorkspaceList(StrictModel):
    items: list[Workspace]
    total: int
    limit: int
    offset: int

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
    )

    app_name: str = "Auraxis"
    database_url: str = "sqlite:///./auraxis.db"
    data_cache_dir: Path = Path("./data_cache")
    auth_database_path: Path = Path("./auth.sqlite3")
    workspace_database_path: Path = Path("./workspaces.sqlite3")
    auth_cookie_secure: bool = False  # Local HTTP only; enable for hosted HTTPS.
    auth_session_hours: int = Field(default=24, ge=1, le=720)
    lot_grams: dict[str, int] = {
        "GOLDM": 100,
        "GOLDTEN": 10,
        "GOLDGUINEA": 8,
        "GOLDPETAL": 1,
    }
    quote_grams: dict[str, int] = {
        "GOLDM": 10,
        "GOLDTEN": 10,
        "GOLDGUINEA": 8,
        "GOLDPETAL": 1,
    }
    # Official July/August-2026 MCX PDFs confirm delivery qualities below.
    # Their use as cross-product quoted-price multipliers remains provisional:
    # delivery quality is not by itself proof of price-basis equivalence.
    # Preserve the hackathon default rather than silently changing analytics.
    purity: dict[str, int] = {
        "GOLDM": 995,
        "GOLDTEN": 999,
        "GOLDGUINEA": 999,
        "GOLDPETAL": 999,
    }
    base_grams: float = Field(default=10, gt=0)
    base_purity: float = Field(default=999, gt=0)
    api_min_volume_grams: float = Field(default=2000, ge=0, allow_inf_nan=False)
    spread_pairs: list[str] = [
        "GOLDTEN-GOLDPETAL",
        "GOLDTEN-GOLDGUINEA",
        "GOLDGUINEA-GOLDPETAL",
        "GOLDM-GOLDTEN",
        "GOLDM-GOLDGUINEA",
        "GOLDM-GOLDPETAL",
    ]
    spread_window: int = Field(default=10, ge=1)
    spread_min_periods: int = Field(default=5, ge=1)
    spread_min_volume_grams: float = Field(default=0, ge=0)
    spread_min_oi_grams: float = Field(default=0, ge=0)
    bhavcopy_url: str = (
        "https://www.mcxindia.com/market-data/bhavcopy/GetDateWiseBhavCopy"
    )
    bhavcopy_headers: dict[str, str] = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.mcxindia.com/market-data/bhavcopy",
    }
    bhavcopy_timeout: float = Field(default=30.0, gt=0)
    bhavcopy_retry_count: int = Field(default=2, ge=0)
    bhavcopy_retry_backoff: float = Field(default=1.0, ge=0)
    bhavcopy_request_delay: float = Field(default=2.0, ge=0)
    bhavcopy_symbols: Annotated[list[str], NoDecode] = [
        "GOLDM",
        "GOLDTEN",
        "GOLDGUINEA",
        "GOLDPETAL",
    ]
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5180",
        "http://localhost:5173",
    ]
    # Upstox market-data connector. An Analytics Token (Developer Apps →
    # Analytics, valid for one year, read-only) is recommended over the daily
    # OAuth access token. Never commit a real token.
    upstox_access_token: str = ""
    upstox_api_base: str = "https://api.upstox.com"
    upstox_instruments_url: str = (
        "https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz"
    )
    # Unit Upstox reports for MCX candle volume / open interest.
    upstox_volume_unit: Literal["lots", "grams"] = "lots"
    upstox_history_days: int = Field(default=365, ge=1, le=3650)
    # Expired-contract history requires an Upstox Plus subscription.
    upstox_include_expired: bool = False
    upstox_timeout: float = Field(default=20.0, gt=0)
    # Background refresh interval while the API runs; 0 disables it.
    auto_refresh_hours: float = Field(default=6, ge=0)
    # Live intraday quotes (Upstox market-quote API) polled during the MCX
    # session. Seconds between polls; 0 disables live quotes, minimum 5.
    live_poll_seconds: float = Field(default=30, ge=0, le=3600)
    # MCX session in IST, Monday to Friday. The evening close is 23:30 while
    # US daylight saving is in force and 23:55 otherwise.
    live_session_start: str = "09:00"
    live_session_end: str = "23:55"
    # Practice trading with demo money (no cash value).
    practice_database_path: Path = Path("./practice.sqlite3")
    practice_start_balance: float = Field(default=1_000_000, gt=0, le=1e9)
    practice_margin_pct: float = Field(default=10, gt=0, le=100)
    practice_cost_bps: float = Field(default=5, ge=0, le=100)
    # On-chain gold (read-only Web3 data): tokenized gold vs MCX.
    onchain_enabled: bool = True
    onchain_poll_seconds: float = Field(default=60, ge=30, le=3600)
    onchain_price_api: str = "https://api.coingecko.com/api/v3"
    onchain_rpc_url: str = "https://ethereum-rpc.publicnode.com"
    onchain_database_path: Path = Path("./onchain.sqlite3")
    # India's gold import duty (%) by effective date; parity uses the rate in
    # force on each day. 15% (12.5 + 2.5) until the July 2024 cut to 6%
    # (5 + 1); raised to 15% (10 + 5 AIDC) from 13 May 2026.
    onchain_duty_schedule: dict[str, float] = {
        "2000-01-01": 15.0,
        "2024-07-24": 6.0,
        "2026-05-13": 15.0,
    }
    # Auto-import MCX Bhavcopy CSVs that appear in a folder (default: Downloads).
    bhavcopy_watch: bool = False
    bhavcopy_watch_dir: Path | None = None
    bhavcopy_watch_seconds: float = Field(default=6, ge=1)
    # Emails allowed to trigger a manual refresh; empty allows any signed-in user.
    data_admin_emails: Annotated[list[str], NoDecode] = []
    # Google Identity Services web client ID; empty hides Google sign-in.
    google_client_id: str = ""

    @field_validator("live_poll_seconds")
    @classmethod
    def check_poll_seconds(cls, value: float) -> float:
        if 0 < value < 5:
            raise ValueError("LIVE_POLL_SECONDS must be 0 (off) or at least 5")
        return value

    @field_validator("live_session_start", "live_session_end")
    @classmethod
    def check_session_time(cls, value: str) -> str:
        value = value.strip()
        hours, _, minutes = value.partition(":")
        if not (
            len(hours) == 2
            and len(minutes) == 2
            and hours.isdigit()
            and minutes.isdigit()
            and int(hours) < 24
            and int(minutes) < 60
        ):
            raise ValueError("Session times must use 24-hour HH:MM")
        return value

    @field_validator("onchain_duty_schedule")
    @classmethod
    def check_duty_schedule(cls, value: dict[str, float]) -> dict[str, float]:
        if not value:
            raise ValueError("ONCHAIN_DUTY_SCHEDULE needs at least one entry")
        for day, pct in value.items():
            date.fromisoformat(day)
            if not 0 <= pct <= 100:
                raise ValueError("Import duty must be between 0 and 100 %")
        return value

    @model_validator(mode="after")
    def check_session_order(self) -> "Settings":
        if self.live_session_start >= self.live_session_end:
            raise ValueError("LIVE_SESSION_START must be before LIVE_SESSION_END")
        return self

    @field_validator(
        "cors_origins", "bhavcopy_symbols", "data_admin_emails", mode="before"
    )
    @classmethod
    def parse_csv_values(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

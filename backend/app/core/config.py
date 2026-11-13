from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
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
    # Auto-import MCX Bhavcopy CSVs that appear in a folder (default: Downloads).
    bhavcopy_watch: bool = False
    bhavcopy_watch_dir: Path | None = None
    bhavcopy_watch_seconds: float = Field(default=6, ge=1)
    # Emails allowed to trigger a manual refresh; empty allows any signed-in user.
    data_admin_emails: Annotated[list[str], NoDecode] = []
    # Google Identity Services web client ID; empty hides Google sign-in.
    google_client_id: str = ""

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

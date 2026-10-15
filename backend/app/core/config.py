from functools import lru_cache
from pathlib import Path
from typing import Annotated

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

    @field_validator("cors_origins", "bhavcopy_symbols", mode="before")
    @classmethod
    def parse_csv_values(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

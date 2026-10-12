from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine, func, select

from app.core.config import Settings
from app.data.loader import COLUMNS, bhav, data_health, load_file

FIXTURES = Path(__file__).parent / "fixtures" / "csv_loader"
SAMPLE = FIXTURES / "BhavCopyDateWise_01102026.csv"


@pytest.fixture
def settings():
    return Settings(_env_file=None)


@pytest.fixture
def engine(tmp_path):
    instance = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    yield instance
    instance.dispose()


def test_parsing_filtering_and_zero_volume(settings, engine):
    result = load_file(SAMPLE, settings=settings, engine=engine)
    assert result.status == "ok"
    assert result.rows_total == 30
    assert result.rows_kept == 24
    frame = result.dataframe
    assert list(frame.columns) == COLUMNS
    assert frame.symbol.value_counts().to_dict() == {
        "GOLDM": 6,
        "GOLDTEN": 6,
        "GOLDGUINEA": 6,
        "GOLDPETAL": 6,
    }
    assert set(frame.trade_date) == {date(2026, 10, 1)}
    assert frame.iloc[0].expiry_date == date(2026, 10, 30)
    assert frame.iloc[0].volume_text == "10.000 GRMS"
    assert frame.iloc[0].volume_grams == 10000
    assert frame.iloc[0].open_interest_grams == 20000
    zero = frame.loc[
        (frame.symbol == "GOLDGUINEA") & (frame.expiry_date == date(2027, 3, 31))
    ].iloc[0]
    assert not zero.has_trade
    assert zero.volume_lots == zero.volume_grams == 0
    assert zero.close == 100050
    assert not result.notes
    with engine.connect() as connection:
        stored = (
            connection.execute(
                select(bhav).where(
                    bhav.c.symbol == "GOLDGUINEA",
                    bhav.c.expiry_date == date(2027, 3, 31),
                )
            )
            .mappings()
            .one()
        )
        assert stored["has_trade"] is False


def test_mixed_dates_reject_entire_file(settings, engine, caplog):
    path = FIXTURES / "BhavCopyDateWise_02102026.csv"
    result = load_file(path, settings=settings, engine=engine)
    assert result.status == "date_mismatch"
    assert result.dataframe.empty
    assert result.rows_kept == 0
    assert "2026-10-01" in result.notes and "2026-10-02" in result.notes
    assert "date_mismatch" in caplog.text
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(bhav)) == 0
        health = connection.execute(select(data_health)).mappings().one()
        assert health["status"] == "date_mismatch"
        assert health["rows_total"] == 2


def test_volume_mismatch_warns_without_dropping(tmp_path, settings, engine, caplog):
    frame = pd.read_csv(SAMPLE)
    frame.loc[0, "Volume(In 000's)"] = "172.200 GRMS"
    path = tmp_path / SAMPLE.name
    frame.to_csv(path, index=False)
    result = load_file(path, settings=settings, engine=engine)
    assert result.status == "ok" and result.rows_kept == 24
    assert "volume mismatch" in caplog.text
    assert "172.200 GRMS" in result.notes
    with engine.connect() as connection:
        assert "volume mismatch" in connection.scalar(select(data_health.c.notes))


def test_idempotent_upsert_updates_values(tmp_path, settings, engine):
    first = load_file(SAMPLE, settings=settings, engine=engine)
    assert first.status == "ok"
    frame = pd.read_csv(SAMPLE)
    frame.loc[0, "Close"] = 101234
    path = tmp_path / SAMPLE.name
    frame.to_csv(path, index=False)
    assert load_file(path, settings=settings, engine=engine).status == "ok"
    assert load_file(path, settings=settings, engine=engine).status == "ok"
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(bhav)) == 24
        assert connection.scalar(select(func.count()).select_from(data_health)) == 1
        assert (
            connection.scalar(
                select(bhav.c.close).where(
                    bhav.c.symbol == "GOLDM", bhav.c.expiry_date == date(2026, 10, 30)
                )
            )
            == 101234
        )


def test_no_gold_rows(tmp_path, settings, engine):
    frame = pd.read_csv(SAMPLE).iloc[24:]
    path = tmp_path / SAMPLE.name
    frame.to_csv(path, index=False)
    result = load_file(path, settings=settings, engine=engine)
    assert result.status == "no_gold_rows"
    assert result.rows_total == 6 and result.rows_kept == 0
    with engine.connect() as connection:
        assert connection.scalar(select(data_health.c.status)) == "no_gold_rows"


@pytest.mark.parametrize("kind", ["bad_date", "negative_lots", "duplicate", "missing"])
def test_bad_file_is_logged_without_partial_rows(tmp_path, settings, engine, kind):
    frame = pd.read_csv(SAMPLE)
    if kind == "bad_date":
        frame.loc[24, "Date"] = "invalid date"
    elif kind == "negative_lots":
        frame.loc[0, "Volume(Lots)"] = -1
    elif kind == "duplicate":
        frame = pd.concat([frame, frame.iloc[:1]])
    else:
        frame = frame.drop(columns="Close")
    path = tmp_path / SAMPLE.name
    frame.to_csv(path, index=False)
    result = load_file(path, settings=settings, engine=engine)
    assert result.status == "error" and result.dataframe.empty
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(bhav)) == 0
        assert connection.scalar(select(data_health.c.status)) == "error"


def test_configurable_symbols_and_lot_size(settings, engine):
    settings.bhavcopy_symbols = ["GOLDM"]
    settings.lot_grams["GOLDM"] = 50
    result = load_file(SAMPLE, settings=settings, engine=engine)
    assert result.rows_kept == 6
    assert result.dataframe.iloc[0].volume_grams == 5000

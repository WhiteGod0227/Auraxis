"""Auto-import of MCX Bhavcopy files from a watched folder."""

import shutil
from pathlib import Path

import pytest

from app.core.config import Settings
from app.data import watcher

FIXTURES = Path(__file__).parent / "fixtures" / "csv_loader"


@pytest.fixture
def setup(tmp_path):
    folder = tmp_path / "Downloads"
    folder.mkdir()
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
        data_cache_dir=tmp_path / "cache",
        auth_database_path=tmp_path / "auth.sqlite3",
        bhavcopy_watch_dir=folder,
    )
    return settings, folder


def scan_twice(settings, seen, sizes):
    # The first pass records sizes; the second imports stable files.
    watcher.scan_once(settings, seen, sizes)
    return watcher.scan_once(settings, seen, sizes)


def test_imports_by_the_date_inside_the_file(setup):
    settings, folder = setup
    good = FIXTURES / "BhavCopyDateWise_01102026.csv"
    # MCX-style mislabel: the name says 5 Oct, the content is 1 Oct.
    shutil.copy(good, folder / "BhavCopyDateWise_05102026.csv")
    seen, sizes = set(), {}
    assert scan_twice(settings, seen, sizes) == 1
    raw = settings.data_cache_dir / "raw_csv"
    assert (raw / "BhavCopyDateWise_01102026.csv").read_bytes() == good.read_bytes()
    assert not (raw / "BhavCopyDateWise_05102026.csv").exists()
    event = watcher.watch_status()["recent"][0]
    assert event["status"] == "imported" and event["trade_date"] == "2026-10-01"


def test_redownloads_and_other_files_are_ignored(setup):
    settings, folder = setup
    good = FIXTURES / "BhavCopyDateWise_01102026.csv"
    shutil.copy(good, folder / "BhavCopyDateWise_01102026.csv")
    shutil.copy(good, folder / "BhavCopyDateWise_01102026 (1).csv")
    (folder / "notes.csv").write_text("a,b\n1,2\n")
    seen, sizes = set(), {}
    assert scan_twice(settings, seen, sizes) == 1
    # Nothing new on later passes, even after a restart with the saved hashes.
    assert watcher.scan_once(settings, seen, sizes) == 0
    watcher._save_seen(settings, seen)
    assert watcher._load_seen(settings) == seen


def test_mixed_dates_are_skipped_not_imported(setup):
    settings, folder = setup
    shutil.copy(
        FIXTURES / "BhavCopyDateWise_02102026.csv",
        folder / "BhavCopyDateWise_02102026.csv",
    )
    seen, sizes = set(), {}
    assert scan_twice(settings, seen, sizes) == 0
    assert watcher.watch_status()["recent"][0]["status"] == "skipped"
    assert not (settings.data_cache_dir / "raw_csv").exists() or not any(
        (settings.data_cache_dir / "raw_csv").iterdir()
    )


def test_missing_folder_is_harmless(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'm.db').as_posix()}",
        data_cache_dir=tmp_path / "cache",
        bhavcopy_watch_dir=tmp_path / "nope",
    )
    assert watcher.scan_once(settings, set(), {}) == 0

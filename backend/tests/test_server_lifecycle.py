import json
import signal

import pytest
import uvicorn

from scripts import run_local_backend
from scripts.run_local_backend import LifecycleServer, record_event


def test_signal_evidence_changes_only_the_receiving_server():
    events = []
    config = uvicorn.Config("app.main:app")
    own = LifecycleServer(config, lambda event, **data: events.append((event, data)))
    other = uvicorn.Server(config)
    own.handle_exit(signal.SIGINT, None)
    assert own.should_exit
    assert not other.should_exit
    assert other._captured_signals == []
    assert events == [("signal_received", {"signal": "SIGINT"})]


def test_lifecycle_record_has_utc_identity_without_private_payload(tmp_path):
    path = tmp_path / "lifecycle.jsonl"
    record_event(path, "isolated-run", "run_started", port=54321)
    record = json.loads(path.read_text(encoding="utf-8"))
    assert record["run_id"] == "isolated-run"
    assert record["time_utc"].endswith("+00:00")
    assert record["pid"] > 0 and record["parent_pid"] > 0
    assert set(record) == {"time_utc", "run_id", "pid", "parent_pid", "event", "port"}


def test_logging_failure_does_not_swallow_shutdown_signal(capsys):
    def unavailable(*args, **kwargs):
        raise OSError("private path must not be printed")

    own = LifecycleServer(uvicorn.Config("app.main:app"), unavailable)
    own.handle_exit(signal.SIGINT, None)
    assert own.should_exit
    assert own._captured_signals == [signal.SIGINT]
    output = capsys.readouterr().err
    assert "handling continues" in output and "private path" not in output


def test_cli_interrupt_preserves_exit_status_and_evidence_without_traceback(
    monkeypatch, tmp_path, capsys
):
    class InterruptedServer(LifecycleServer):
        def run(self):
            self.handle_exit(signal.SIGINT, None)
            raise KeyboardInterrupt

    monkeypatch.setattr(run_local_backend, "BACKEND", tmp_path)
    monkeypatch.setattr(run_local_backend, "LifecycleServer", InterruptedServer)
    monkeypatch.setattr("sys.argv", ["run_local_backend.py"])
    with pytest.raises(SystemExit) as exit_:
        run_local_backend.main()
    assert exit_.value.code == 130
    records = [
        json.loads(line)
        for line in (tmp_path / "logs" / "backend_lifecycle.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert [row["event"] for row in records] == [
        "run_started",
        "signal_received",
        "run_interrupted",
        "run_finished",
    ]
    assert records[1]["signal"] == "SIGINT"
    assert records[-1]["should_exit"] is True
    assert "Traceback" not in capsys.readouterr().err

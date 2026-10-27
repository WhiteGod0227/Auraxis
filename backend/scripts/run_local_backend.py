"""Normal local Uvicorn startup with opt-in lifecycle evidence, no process control."""

import argparse
import json
import os
import signal
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import uvicorn

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def record_event(path, run_id, event, **details):
    record = {
        "time_utc": datetime.now(UTC).isoformat(),
        "run_id": run_id,
        "pid": os.getpid(),
        "parent_pid": os.getppid(),
        "event": event,
        **details,
    }
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, allow_nan=False) + "\n")


class LifecycleServer(uvicorn.Server):
    def __init__(self, config, recorder):
        super().__init__(config)
        self.recorder = recorder

    def record(self, event, **details):
        try:
            self.recorder(event, **details)
        except OSError:
            print(
                "Lifecycle log unavailable; server handling continues.", file=sys.stderr
            )

    def handle_exit(self, sig, frame):
        # Log the received signal without changing Uvicorn's existing semantics.
        self.record("signal_received", signal=signal.Signals(sig).name)
        super().handle_exit(sig, frame)

    async def shutdown(self, sockets=None):
        self.record(
            "shutdown_started",
            should_exit=self.should_exit,
            signals=[signal.Signals(sig).name for sig in self._captured_signals],
        )
        await super().shutdown(sockets=sockets)
        self.record("shutdown_finished")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be 1–65535.")
    log = BACKEND / "logs" / "backend_lifecycle.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid4())

    def recorder(event, **details):
        record_event(log, run_id, event, **details)

    server = LifecycleServer(
        uvicorn.Config("app.main:app", host="127.0.0.1", port=args.port), recorder
    )
    server.record(
        "run_started",
        port=args.port,
        request_limit=server.config.limit_max_requests,
        workers=server.config.workers,
    )
    print("Lifecycle evidence: backend/logs/backend_lifecycle.jsonl", flush=True)
    try:
        server.run()
    except KeyboardInterrupt:
        # Uvicorn replays SIGINT after graceful shutdown. Preserve its conventional
        # exit status and lifecycle evidence without an unnecessary traceback.
        server.record("run_interrupted", exception_type="KeyboardInterrupt")
        raise SystemExit(130) from None
    except BaseException as error:
        # No exception text, request contents, credentials or filesystem paths.
        server.record("run_exception", exception_type=type(error).__name__)
        raise
    finally:
        server.record(
            "run_finished", started=server.started, should_exit=server.should_exit
        )


if __name__ == "__main__":
    main()

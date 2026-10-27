"""Reproduce verifier cleanup against an owned sentinel, never the user's backend."""

import socket
import sys
import threading
import time
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.run_local_backend import LifecycleServer  # noqa: E402
from scripts.verify_workspaces import verify  # noqa: E402


def main():
    # This sentinel has no market/auth/workspace storage or application state.
    sentinel = FastAPI()

    @sentinel.get("/health")
    def health():
        return {"owned_sentinel": True}

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    if port in {8000, 8010, 5173, 5180, 9222}:
        listener.close()
        raise RuntimeError("Sentinel selected a reserved service port.")
    events = []
    server = LifecycleServer(
        uvicorn.Config(sentinel, log_level="critical", access_log=False),
        lambda event, **details: events.append((event, details)),
    )
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [listener]}, daemon=True
    )
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started, "Owned sentinel failed to start."
        with httpx.Client(base_url=f"http://127.0.0.1:{port}") as client:
            assert client.get("/health").json() == {"owned_sentinel": True}
            verify()
            assert thread.is_alive() and not server.should_exit
            assert not server._captured_signals
            assert client.get("/health").json() == {"owned_sentinel": True}
        print("PASS: verifier cleanup leaves a separate owned server running.")
        print("No manually managed port or process was used or stopped.")
    finally:
        server.should_exit = True  # Only the sentinel created in this function.
        thread.join(timeout=10)
        listener.close()
        assert not thread.is_alive(), "Owned sentinel cleanup incomplete."
        assert events == [
            ("shutdown_started", {"should_exit": True, "signals": []}),
            ("shutdown_finished", {}),
        ], "Lifecycle evidence did not identify the instance-local shutdown."
        print(
            "PASS: lifecycle trace distinguishes owned cleanup from received signals."
        )


if __name__ == "__main__":
    main()

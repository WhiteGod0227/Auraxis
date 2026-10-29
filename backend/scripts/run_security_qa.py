"""Disposable private stores for real HTTP/browser security verification.

Uses existing market data read paths only. Never replaces real account stores.
Stop this verification-owned server after use; ignored fixtures remain private.
"""

import os
import sys
import tempfile
from pathlib import Path

import uvicorn

backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend))
root = (backend / ".tmp").resolve()
root.mkdir(exist_ok=True)
private = Path(tempfile.mkdtemp(prefix="security-qa-", dir=root)).resolve()
assert private.is_relative_to(root)
os.environ["AUTH_DATABASE_PATH"] = str(private / "auth.sqlite3")
os.environ["WORKSPACE_DATABASE_PATH"] = str(private / "workspaces.sqlite3")
os.environ["AUTH_COOKIE_SECURE"] = "false"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8011, log_level="warning")

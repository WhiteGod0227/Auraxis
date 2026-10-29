"""Read-only privacy check of the exact Git index before publishing source.

Run from any directory: python backend/scripts/verify_release_source.py.
This is a bounded release check, not a security audit of Git history.
"""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    paths = git("ls-files", "-z").decode().split("\0")
    findings = []
    count = 0
    credentials = re.compile(
        rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
        rb"|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"
        rb"|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}"
    )
    for name in filter(None, paths):
        content = git("show", f":{name}")
        # Existing empty placeholder contains no market payload.
        if name == "backend/data_cache/.gitkeep" and not content.strip():
            count += 1
            continue
        path = Path(name)
        parts = set(path.parts)
        private = bool(
            parts
            & {
                "deployment-private",
                "data_cache",
                "snapshots",
                "node_modules",
                ".tmp",
                "dist",
                "dist-deploy",
                "evidence",
            }
        )
        private |= path.name.startswith(".env") and path.name != ".env.example"
        private |= bool(
            re.search(r"\.(?:db|sqlite3?|webm|zip|bundle)(?:-|$)", name, re.I)
        )
        private |= path.suffix.lower() == ".csv" and not name.startswith(
            "backend/tests/fixtures/csv_loader/"
        )
        if private:
            findings.append(f"Excluded material in index: {name}")
            continue
        count += 1
        if credentials.search(content):
            findings.append(f"Credential pattern in index: {name}")
    for finding in findings:
        print(finding)
    print(f"{'FAIL' if findings else 'PASS'}: {count} indexed source files checked")
    print("Scope: current Git index; no complete history or secret audit claimed.")
    return bool(findings)


if __name__ == "__main__":
    raise SystemExit(main())

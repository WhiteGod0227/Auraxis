"""Proof of research: tamper-evident records anchored in Bitcoin.

Each certified record (a closed practice trade, a saved research note) gets a
salted SHA-256 fingerprint (leaf). Periodically, all new leaves are combined
into a Merkle tree and only its 32-byte root is timestamped with
OpenTimestamps: free public calendars aggregate it into a Bitcoin transaction
within hours. Anyone holding a record's proof can then show the record existed
at that time and has not changed since.

Privacy: calendars only ever see the root. Leaves are salted with 32 random
bytes, so a fingerprint cannot be matched to a guessed record.

Hashing (domain separated, so a leaf can never pose as an inner node):
    leaf = SHA256(b"auraxis-proof-leaf-v1\\x00" + salt + canonical_json)
    node = SHA256(b"\\x01" + left + right)     odd node: promoted unchanged
The stamped document is a small text file naming the batch and its root; its
SHA-256 is what the .ots file commits to, so standard OpenTimestamps tools can
verify it directly.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.core.config import BACKEND_DIR, Settings

logger = logging.getLogger(__name__)

LEAF_PREFIX = b"auraxis-proof-leaf-v1\x00"
NODE_PREFIX = b"\x01"
FORMAT = "auraxis-proof-v1"
CHECK_SECONDS = 300
UPGRADE_EVERY = timedelta(minutes=30)
MAX_BATCH = 5000
# Same policy as the official client: only follow upgrade URLs on known
# calendar domains (a calendar's reply chooses the URL we later contact).
CALENDAR_SUFFIXES = (
    ".calendar.opentimestamps.org",
    ".calendar.eternitywall.com",
    ".calendar.catallaxy.com",
)


class ProofError(RuntimeError):
    """A safe, user-presentable proof failure."""


# --------------------------------------------------------------------------- #
# Hashing and Merkle trees
# --------------------------------------------------------------------------- #


def canonical(content: dict) -> bytes:
    return json.dumps(
        content,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def leaf_hash_bytes(salt: bytes, data: bytes) -> bytes:
    return hashlib.sha256(LEAF_PREFIX + salt + data).digest()


def leaf_hash(salt: bytes, content: dict) -> bytes:
    return leaf_hash_bytes(salt, canonical(content))


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(NODE_PREFIX + left + right).digest()


def merkle_levels(leaves: list[bytes]) -> list[list[bytes]]:
    if not leaves:
        raise ValueError("No leaves")
    levels = [list(leaves)]
    while len(levels[-1]) > 1:
        level = levels[-1]
        parent = [
            node_hash(level[i], level[i + 1]) if i + 1 < len(level) else level[i]
            for i in range(0, len(level), 2)
        ]
        levels.append(parent)
    return levels


def merkle_path(levels: list[list[bytes]], index: int) -> list[dict]:
    """Siblings from leaf to root; ``side`` is where the sibling sits."""
    path = []
    for level in levels[:-1]:
        sibling = index ^ 1
        if sibling < len(level):
            path.append(
                dict(
                    hash=level[sibling].hex(),
                    side="left" if sibling < index else "right",
                )
            )
        index //= 2
    return path


def root_from_path(leaf: bytes, path: list[dict]) -> bytes:
    current = leaf
    for step in path:
        sibling = bytes.fromhex(step["hash"])
        if len(sibling) != 32 or step["side"] not in {"left", "right"}:
            raise ValueError("Malformed Merkle path")
        current = (
            node_hash(sibling, current)
            if step["side"] == "left"
            else node_hash(current, sibling)
        )
    return current


def stamped_document(batch_id: int, root: bytes, count: int, created_at: str) -> str:
    return (
        "Auraxis proof of research\n"
        f"batch: {batch_id}\n"
        f"merkle root: {root.hex()}\n"
        f"records: {count}\n"
        f"created: {created_at}\n"
    )


# --------------------------------------------------------------------------- #
# OpenTimestamps
# --------------------------------------------------------------------------- #


def _ots():
    # Imported lazily: only needed when stamping or verifying.
    from opentimestamps.calendar import CommitmentNotFoundError, RemoteCalendar
    from opentimestamps.core.notary import (
        BitcoinBlockHeaderAttestation,
        PendingAttestation,
    )
    from opentimestamps.core.op import OpAppend, OpSHA256
    from opentimestamps.core.serialize import (
        StreamDeserializationContext,
        StreamSerializationContext,
    )
    from opentimestamps.core.timestamp import DetachedTimestampFile, Timestamp

    return dict(
        CommitmentNotFoundError=CommitmentNotFoundError,
        RemoteCalendar=RemoteCalendar,
        BitcoinBlockHeaderAttestation=BitcoinBlockHeaderAttestation,
        PendingAttestation=PendingAttestation,
        OpAppend=OpAppend,
        OpSHA256=OpSHA256,
        StreamDeserializationContext=StreamDeserializationContext,
        StreamSerializationContext=StreamSerializationContext,
        DetachedTimestampFile=DetachedTimestampFile,
        Timestamp=Timestamp,
    )


def allowed_calendar(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host.endswith(s) for s in CALENDAR_SUFFIXES)


def serialize_ots(detached) -> bytes:
    o = _ots()
    buffer = io.BytesIO()
    detached.serialize(o["StreamSerializationContext"](buffer))
    return buffer.getvalue()


def load_ots(data: bytes):
    o = _ots()
    return o["DetachedTimestampFile"].deserialize(
        o["StreamDeserializationContext"](io.BytesIO(data))
    )


def stamp(
    settings: Settings, document: str, calendar_factory=None
) -> tuple[bytes, list[str]]:
    """Submit a document's SHA-256 to the calendars; returns (.ots, accepted)."""
    o = _ots()
    factory = calendar_factory or (
        lambda url: o["RemoteCalendar"](url, user_agent="auraxis-research")
    )
    digest = hashlib.sha256(document.encode("utf-8")).digest()
    root = o["Timestamp"](digest)
    # Random nonce, as the official client does, so the calendar's view of
    # the commitment reveals nothing about the document.
    tip = root.ops.add(o["OpAppend"](os.urandom(16))).ops.add(o["OpSHA256"]())
    accepted = []
    for url in settings.proofs_calendars:
        try:
            tip.merge(factory(url).submit(tip.msg, timeout=20))
            accepted.append(url)
        except Exception as exc:  # network, HTTP or protocol errors
            logger.warning("Calendar %s failed: %s", url, exc)
    if not accepted:
        raise ProofError("No timestamp calendar accepted the submission.")
    return serialize_ots(o["DetachedTimestampFile"](o["OpSHA256"](), root)), accepted


def _nodes(timestamp):
    yield timestamp
    for sub in timestamp.ops.values():
        yield from _nodes(sub)


def upgrade(ots: bytes, calendar_factory=None) -> tuple[bytes, bool]:
    """Ask calendars for completed attestations; returns (.ots, changed)."""
    o = _ots()
    factory = calendar_factory or (
        lambda url: o["RemoteCalendar"](url, user_agent="auraxis-research")
    )
    detached = load_ots(ots)
    changed = False
    for node in list(_nodes(detached.timestamp)):
        for attestation in list(node.attestations):
            if not isinstance(attestation, o["PendingAttestation"]):
                continue
            if not allowed_calendar(attestation.uri):
                logger.warning("Skipping non-allowlisted calendar %s", attestation.uri)
                continue
            try:
                upgraded = factory(attestation.uri).get_timestamp(node.msg, timeout=20)
            except o["CommitmentNotFoundError"]:
                continue
            except Exception as exc:
                logger.info("Calendar %s not ready: %s", attestation.uri, exc)
                continue
            node.merge(upgraded)
            changed = True
    return serialize_ots(detached), changed


def bitcoin_attestations(ots: bytes) -> list[tuple[bytes, int]]:
    o = _ots()
    detached = load_ots(ots)
    return sorted(
        {
            (msg, attestation.height)
            for msg, attestation in detached.timestamp.all_attestations()
            if isinstance(attestation, o["BitcoinBlockHeaderAttestation"])
        },
        key=lambda item: item[1],
    )


def verify_bitcoin(
    settings: Settings, ots: bytes, client: httpx.Client
) -> tuple[int, datetime] | None:
    """Earliest Bitcoin block that attests the stamp, checked against its header."""
    from bitcoin.core import CBlockHeader

    o = _ots()
    base = settings.proofs_block_explorer.rstrip("/")
    for msg, height in bitcoin_attestations(ots):
        try:
            block_hash = client.get(f"{base}/block-height/{height}").text.strip()
            raw = bytes.fromhex(
                client.get(f"{base}/block/{block_hash}/header").text.strip()
            )
            header = CBlockHeader.deserialize(raw)
            seconds = o["BitcoinBlockHeaderAttestation"](
                height
            ).verify_against_blockheader(msg, header)
        except Exception as exc:
            logger.warning("Bitcoin check for height %s failed: %s", height, exc)
            continue
        return height, datetime.fromtimestamp(seconds, UTC)
    return None


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #


@contextmanager
def database(settings: Settings):
    path = Path(settings.proofs_database_path)
    path = path if path.is_absolute() else BACKEND_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                ref TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                salt TEXT NOT NULL,
                leaf TEXT NOT NULL,
                created_at TEXT NOT NULL,
                batch_id INTEGER,
                leaf_index INTEGER,
                UNIQUE (kind, ref)
            );
            CREATE INDEX IF NOT EXISTS records_user ON records (user_id, id);
            CREATE INDEX IF NOT EXISTS records_open ON records (batch_id);
            CREATE TABLE IF NOT EXISTS batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                root TEXT NOT NULL UNIQUE,
                leaf_count INTEGER NOT NULL,
                document TEXT NOT NULL,
                ots BLOB,
                status TEXT NOT NULL,
                calendars TEXT NOT NULL DEFAULT '[]',
                error TEXT NOT NULL DEFAULT '',
                bitcoin_height INTEGER,
                bitcoin_time TEXT,
                checked_at TEXT
            );
            """
        )
        yield db
    finally:
        db.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def certify(
    settings: Settings,
    user_id: int,
    kind: str,
    ref: str,
    title: str,
    content: dict,
) -> sqlite3.Row:
    """Fingerprint a record once (idempotent on kind + ref)."""
    salt = os.urandom(32)
    leaf = leaf_hash(salt, content)
    with database(settings) as db:
        db.execute(
            "INSERT OR IGNORE INTO records (user_id,kind,ref,title,content,salt,leaf,"
            "created_at) VALUES (?,?,?,?,?,?,?,?)",
            (
                user_id,
                kind,
                ref,
                title[:200],
                canonical(content).decode("utf-8"),
                salt.hex(),
                leaf.hex(),
                _now(),
            ),
        )
        return db.execute(
            "SELECT * FROM records WHERE kind=? AND ref=?", (kind, ref)
        ).fetchone()


def certify_many(
    settings: Settings, user_id: int, items: list[tuple[str, str, str, dict]]
) -> int:
    """Fingerprint several records in one connection; skips known refs."""
    if not items:
        return 0
    with database(settings) as db:
        refs = [ref for _, ref, _, _ in items]
        known = {
            (row["kind"], row["ref"])
            for row in db.execute(
                "SELECT kind, ref FROM records WHERE ref IN "
                f"({','.join('?' * len(refs))})",
                refs,
            )
        }
        added = 0
        for kind, ref, title, content in items:
            if (kind, ref) in known:
                continue
            salt = os.urandom(32)
            db.execute(
                "INSERT OR IGNORE INTO records (user_id,kind,ref,title,content,salt,"
                "leaf,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    user_id,
                    kind,
                    ref,
                    title[:200],
                    canonical(content).decode("utf-8"),
                    salt.hex(),
                    leaf_hash(salt, content).hex(),
                    _now(),
                ),
            )
            added += 1
    return added


def make_batch(settings: Settings, force: bool = False, calendar_factory=None):
    """Seal unbatched records into one Merkle root and timestamp it."""
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            rows = db.execute(
                "SELECT id, leaf, created_at FROM records WHERE batch_id IS NULL "
                "ORDER BY id LIMIT ?",
                (MAX_BATCH,),
            ).fetchall()
            due = bool(rows) and (
                force
                or len(rows) >= MAX_BATCH
                or datetime.fromisoformat(rows[0]["created_at"])
                <= datetime.now(UTC) - timedelta(minutes=settings.proofs_batch_minutes)
            )
            if not due:
                db.execute("COMMIT")
                return None
            leaves = [bytes.fromhex(row["leaf"]) for row in rows]
            root = merkle_levels(leaves)[-1][0]
            created = _now()
            cursor = db.execute(
                "INSERT INTO batches (created_at,root,leaf_count,document,status) "
                "VALUES (?,?,?,?, 'submitting')",
                (created, root.hex(), len(rows), ""),
            )
            batch_id = cursor.lastrowid
            document = stamped_document(batch_id, root, len(rows), created)
            db.execute("UPDATE batches SET document=? WHERE id=?", (document, batch_id))
            db.executemany(
                "UPDATE records SET batch_id=?, leaf_index=? WHERE id=?",
                [(batch_id, index, row["id"]) for index, row in enumerate(rows)],
            )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    submit_batch(settings, batch_id, calendar_factory)
    return batch_id


def submit_batch(settings: Settings, batch_id: int, calendar_factory=None) -> None:
    with database(settings) as db:
        batch = db.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
    try:
        ots, accepted = stamp(settings, batch["document"], calendar_factory)
    except ProofError as exc:
        with database(settings) as db:
            db.execute(
                "UPDATE batches SET status='failed', error=?, checked_at=? WHERE id=?",
                (str(exc), _now(), batch_id),
            )
        return
    with database(settings) as db:
        db.execute(
            "UPDATE batches SET ots=?, status='pending', calendars=?, error='', "
            "checked_at=? WHERE id=?",
            (ots, json.dumps(accepted), _now(), batch_id),
        )


def refresh_batch(
    settings: Settings, batch_id: int, client: httpx.Client, calendar_factory=None
) -> None:
    with database(settings) as db:
        batch = db.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
    if batch is None or batch["status"] == "confirmed":
        return
    if batch["ots"] is None:
        submit_batch(settings, batch_id, calendar_factory)
        return
    ots, _ = upgrade(batch["ots"], calendar_factory)
    confirmed = verify_bitcoin(settings, ots, client)
    with database(settings) as db:
        if confirmed:
            height, when = confirmed
            db.execute(
                "UPDATE batches SET ots=?, status='confirmed', bitcoin_height=?, "
                "bitcoin_time=?, checked_at=? WHERE id=?",
                (ots, height, when.isoformat(), _now(), batch_id),
            )
        else:
            db.execute(
                "UPDATE batches SET ots=?, checked_at=? WHERE id=?",
                (ots, _now(), batch_id),
            )


def tick(settings: Settings, client: httpx.Client, calendar_factory=None) -> None:
    try:
        make_batch(settings, calendar_factory=calendar_factory)
    except Exception:
        logger.exception("Proof batch failed")
    cutoff = (datetime.now(UTC) - UPGRADE_EVERY).isoformat()
    with database(settings) as db:
        due = [
            row["id"]
            for row in db.execute(
                "SELECT id FROM batches "
                "WHERE status IN ('pending','failed','submitting') "
                "AND (checked_at IS NULL OR checked_at < ?) ORDER BY id LIMIT 20",
                (cutoff,),
            )
        ]
    for batch_id in due:
        try:
            refresh_batch(settings, batch_id, client, calendar_factory)
        except Exception:
            logger.exception("Proof batch %s refresh failed", batch_id)


async def run(settings: Settings) -> None:
    client = httpx.Client(timeout=20, headers={"User-Agent": "auraxis-research"})
    try:
        while True:
            await asyncio.to_thread(tick, settings, client)
            await asyncio.sleep(CHECK_SECONDS)
    finally:
        client.close()


# --------------------------------------------------------------------------- #
# Proof bundles
# --------------------------------------------------------------------------- #


def bundle(settings: Settings, record: sqlite3.Row) -> dict:
    """Everything needed to verify one record, independently of Auraxis."""
    result = dict(
        format=FORMAT,
        record=dict(
            id=record["id"],
            kind=record["kind"],
            title=record["title"],
            created_at=record["created_at"],
            # The exact bytes that were fingerprinted. Verifiers hash this
            # string as-is; re-encoding "content" (e.g. in a browser, where
            # 0.0 becomes 0) would change the bytes.
            content_json=record["content"],
            content=json.loads(record["content"]),
        ),
        salt=record["salt"],
        leaf=record["leaf"],
        status="queued",
        path=None,
        root=None,
        batch=None,
    )
    if record["batch_id"] is None:
        return result
    with database(settings) as db:
        batch = db.execute(
            "SELECT * FROM batches WHERE id=?", (record["batch_id"],)
        ).fetchone()
        leaves = [
            bytes.fromhex(row["leaf"])
            for row in db.execute(
                "SELECT leaf FROM records WHERE batch_id=? ORDER BY leaf_index",
                (record["batch_id"],),
            )
        ]
    levels = merkle_levels(leaves)
    result.update(
        status=batch["status"],
        path=merkle_path(levels, record["leaf_index"]),
        root=batch["root"],
        batch=dict(
            id=batch["id"],
            created_at=batch["created_at"],
            document=batch["document"],
            ots_base64=base64.b64encode(batch["ots"]).decode()
            if batch["ots"]
            else None,
            calendars=json.loads(batch["calendars"] or "[]"),
            bitcoin_height=batch["bitcoin_height"],
            bitcoin_time=batch["bitcoin_time"],
        ),
    )
    result["batch"]["evm"] = _evm_anchor(settings, batch)
    return result


def _evm_anchor(settings: Settings, batch) -> dict | None:
    """Where this root was also published on the test network (Phase 5)."""
    keys = batch.keys()
    tx_hash = batch["evm_tx"] if "evm_tx" in keys else None
    if not tx_hash:
        return None
    explorer = settings.web3_explorer.rstrip("/")
    return dict(
        network=settings.web3_network_name,
        chain_id=settings.web3_chain_id,
        contract=settings.web3_contract or None,
        tx=tx_hash,
        tx_url=f"{explorer}/tx/{tx_hash}",
        status=batch["evm_status"],
        block=batch["evm_block"],
    )


def verify_bundle(settings: Settings, data: dict) -> dict:
    """Check a proof bundle step by step; never trusts its claims."""
    checks = []

    def check(name: str, ok: bool, detail: str) -> bool:
        checks.append(dict(name=name, ok=bool(ok), detail=detail))
        return bool(ok)

    try:
        salt = bytes.fromhex(data["salt"])
        exact = data["record"].get("content_json")
        shown = data["record"].get("content")
        if isinstance(exact, str):
            leaf = leaf_hash_bytes(salt, exact.encode("utf-8"))
            # The readable copy must say the same thing as the fingerprinted
            # JSON (compared as values, so 0.0 == 0 after a browser re-encode).
            if shown is not None and json.loads(exact) != shown:
                return dict(
                    valid=False,
                    checks=[
                        dict(
                            name="Record matches its fingerprinted copy",
                            ok=False,
                            detail="The readable record was edited; it no longer "
                            "matches the certified data.",
                        )
                    ],
                )
        else:
            leaf = leaf_hash(salt, shown)
    except (KeyError, TypeError, ValueError):
        return dict(
            valid=False,
            checks=[
                dict(
                    name="Readable proof",
                    ok=False,
                    detail="The proof file is malformed.",
                )
            ],
        )
    leaf_ok = check(
        "Fingerprint matches the record",
        leaf.hex() == data.get("leaf"),
        "SHA-256 of the salted record equals the stated fingerprint."
        if leaf.hex() == data.get("leaf")
        else "The record or salt was changed after certification.",
    )
    if not data.get("root") or data.get("path") is None:
        check(
            "Included in a sealed batch", False, "Not sealed yet; batches seal hourly."
        )
        return dict(valid=False, leaf_ok=leaf_ok, checks=checks)
    try:
        computed_root = root_from_path(leaf, data["path"])
    except (KeyError, TypeError, ValueError):
        check("Merkle path", False, "The Merkle path is malformed.")
        return dict(valid=False, checks=checks)
    root_ok = check(
        "Merkle path leads to the root",
        computed_root.hex() == data["root"],
        "Hashing up the path reproduces the batch root."
        if computed_root.hex() == data["root"]
        else "The path does not lead to the stated root.",
    )
    with database(settings) as db:
        batch = db.execute(
            "SELECT * FROM batches WHERE root=?", (data["root"],)
        ).fetchone()
    known = check(
        "Root published by Auraxis",
        batch is not None,
        f"Batch #{batch['id']} sealed {batch['created_at'][:16]} UTC."
        if batch
        else "This root is not one of this server's batches.",
    )
    document_ok = False
    bitcoin = None
    if batch is not None and batch["ots"]:
        detached = load_ots(batch["ots"])
        document_ok = check(
            "Timestamp commits to the batch",
            detached.file_digest == hashlib.sha256(batch["document"].encode()).digest()
            and data["root"] in batch["document"],
            "The OpenTimestamps proof covers the document naming this root.",
        )
        if batch["status"] == "confirmed":
            bitcoin = dict(height=batch["bitcoin_height"], time=batch["bitcoin_time"])
            check(
                "Anchored in Bitcoin",
                True,
                f"Bitcoin block {batch['bitcoin_height']:,} at "
                f"{batch['bitcoin_time'][:16]} UTC.",
            )
        else:
            check(
                "Anchored in Bitcoin",
                False,
                "Submitted to OpenTimestamps; Bitcoin confirmation usually takes a "
                "few hours.",
            )
    if settings.web3_active and known:
        from app.data import evm, web3

        try:
            when = web3.anchored_at(settings, data["root"])
        except (evm.EvmError, ValueError):
            when = None
        if when is not None:
            check(
                f"Published on {settings.web3_network_name}",
                bool(when),
                (
                    "The contract records this root at "
                    f"{datetime.fromtimestamp(when, UTC).isoformat()[:16]} UTC."
                )
                if when
                else "Not yet published on the test network (usually minutes).",
            )
    valid = leaf_ok and root_ok and known and document_ok
    return dict(valid=valid, anchored=bool(bitcoin), bitcoin=bitcoin, checks=checks)

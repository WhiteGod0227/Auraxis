"""Phases 4-5 on a TEST network: soulbound badges and proof-root anchors.

* Badges: when a user claims an earned practice achievement, the server
  mints a soulbound token to the wallet they linked with Sign-In with
  Ethereum. The server pays the (test-network) gas.
* Anchors: every sealed proof-of-research batch root is also published with
  ``anchor(root, batchId)``, so anyone can look it up on the block explorer.

A background loop confirms pending transactions. All chain access goes
through one shared ``Chain`` so transaction nonces never collide.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
from datetime import UTC, datetime

from app.core.config import Settings
from app.data import evm

logger = logging.getLogger(__name__)

# Order matches the contract's badge ids (0..4).
BADGES = ["first_trade", "pair_trader", "unusual_gap", "first_profit", "ten_trades"]
TRANSFER_TOPIC = "0x" + evm.ethsig.keccak256(b"Transfer(address,address,uint256)").hex()
CHECK_SECONDS = 15

_chain: evm.Chain | None = None
_chain_lock = threading.Lock()


def chain(settings: Settings) -> evm.Chain:
    global _chain
    with _chain_lock:
        if _chain is None or _chain.rpc_url != settings.web3_rpc_url:
            _chain = evm.Chain(
                settings.web3_rpc_url, settings.web3_chain_id, settings.web3_signer_key
            )
        return _chain


def set_chain(value: evm.Chain | None) -> None:
    """For tests: install a chain backed by a mock transport."""
    global _chain
    with _chain_lock:
        _chain = value


def tx_url(settings: Settings, tx_hash: str | None) -> str | None:
    return f"{settings.web3_explorer.rstrip('/')}/tx/{tx_hash}" if tx_hash else None


def token_url(settings: Settings, token_id: int | None) -> str | None:
    if token_id is None:
        return None
    return (
        f"{settings.web3_explorer.rstrip('/')}/token/"
        f"{settings.web3_contract}?a={token_id}"
    )


def _now() -> str:
    return datetime.now(UTC).isoformat()


# --------------------------------------------------------------------------- #
# Badge storage (practice database)
# --------------------------------------------------------------------------- #


def init_badges(db: sqlite3.Connection) -> None:
    db.execute(
        """CREATE TABLE IF NOT EXISTS badge_mints (
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            address TEXT NOT NULL,
            tx_hash TEXT,
            status TEXT NOT NULL,
            token_id INTEGER,
            error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, code))"""
    )


def onchain_token(settings: Settings, address: str, code: str) -> int:
    """tokenOfBadge(address, badge) — 0 when not minted."""
    data = evm.call_data("tokenOfBadge(address,uint8)", address, BADGES.index(code))
    return evm.decode_uint(chain(settings).call(settings.web3_contract, data))


def send_mint(settings: Settings, address: str, code: str) -> str:
    data = evm.call_data("mint(address,uint8)", address, BADGES.index(code))
    return chain(settings).send(settings.web3_contract, data)


# --------------------------------------------------------------------------- #
# Anchors (proofs database)
# --------------------------------------------------------------------------- #


def init_anchor_columns(db: sqlite3.Connection) -> None:
    columns = {row[1] for row in db.execute("PRAGMA table_info(batches)")}
    for name, kind in (
        ("evm_tx", "TEXT"),
        ("evm_status", "TEXT"),
        ("evm_block", "INTEGER"),
    ):
        if name not in columns:
            db.execute(f"ALTER TABLE batches ADD COLUMN {name} {kind}")


def anchored_at(settings: Settings, root_hex: str) -> int:
    data = evm.call_data("anchoredAt(bytes32)", "0x" + root_hex)
    return evm.decode_uint(chain(settings).call(settings.web3_contract, data))


# --------------------------------------------------------------------------- #
# Background work
# --------------------------------------------------------------------------- #


def _receipt_state(receipt: dict | None) -> str | None:
    if not receipt:
        return None
    return "confirmed" if receipt.get("status") == "0x1" else "failed"


def confirm_mints(settings: Settings) -> None:
    from app.api.practice import database as practice_database

    with practice_database(settings) as db:
        init_badges(db)
        pending = db.execute(
            "SELECT * FROM badge_mints WHERE status='pending' AND tx_hash IS NOT NULL"
        ).fetchall()
    for row in pending:
        receipt = chain(settings).receipt(row["tx_hash"])
        state = _receipt_state(receipt)
        if state is None:
            continue
        token_id = None
        if state == "confirmed":
            for log in receipt.get("logs") or []:
                topics = log.get("topics") or []
                if topics and topics[0].lower() == TRANSFER_TOPIC and len(topics) == 4:
                    token_id = int(topics[3], 16)
        with practice_database(settings) as db:
            db.execute(
                "UPDATE badge_mints SET status=?, token_id=?, error=?, updated_at=? "
                "WHERE user_id=? AND code=?",
                (
                    "minted" if state == "confirmed" else "failed",
                    token_id,
                    "" if state == "confirmed" else "Transaction reverted.",
                    _now(),
                    row["user_id"],
                    row["code"],
                ),
            )


def anchor_batches(settings: Settings) -> None:
    from app.data import proofs

    if not settings.proofs_enabled:
        return

    with proofs.database(settings) as db:
        init_anchor_columns(db)
        todo = db.execute(
            "SELECT id, root, evm_tx, evm_status FROM batches "
            "WHERE status IN ('pending','confirmed') "
            "AND (evm_status IS NULL OR evm_status='pending') ORDER BY id LIMIT 10"
        ).fetchall()
    for batch in todo:
        if batch["evm_tx"]:
            receipt = chain(settings).receipt(batch["evm_tx"])
            state = _receipt_state(receipt)
            if state is None:
                continue
            if state == "failed" and anchored_at(settings, batch["root"]):
                state = "confirmed"  # anchored by an earlier attempt
            with proofs.database(settings) as db:
                db.execute(
                    "UPDATE batches SET evm_status=?, evm_block=? WHERE id=?",
                    (state, int(receipt["blockNumber"], 16), batch["id"]),
                )
            continue
        if anchored_at(settings, batch["root"]):
            with proofs.database(settings) as db:
                db.execute(
                    "UPDATE batches SET evm_status='confirmed' WHERE id=?",
                    (batch["id"],),
                )
            continue
        tx_hash = chain(settings).send(
            settings.web3_contract,
            evm.call_data("anchor(bytes32,uint256)", "0x" + batch["root"], batch["id"]),
        )
        with proofs.database(settings) as db:
            db.execute(
                "UPDATE batches SET evm_tx=?, evm_status='pending' WHERE id=?",
                (tx_hash, batch["id"]),
            )


def tick(settings: Settings) -> None:
    for step in (confirm_mints, anchor_batches):
        try:
            step(settings)
        except evm.EvmError as exc:
            logger.warning("Web3 %s: %s", step.__name__, exc)
        except Exception:
            logger.exception("Web3 %s crashed", step.__name__)


async def run(settings: Settings) -> None:
    while True:
        await asyncio.to_thread(tick, settings)
        await asyncio.sleep(CHECK_SECONDS)

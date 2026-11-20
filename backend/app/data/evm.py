"""Minimal, dependency-light EVM client: RLP, ABI, EIP-1559 signing, JSON-RPC.

Only what Auraxis needs to mint soulbound badges and anchor proof roots on a
test network. Signing reuses the pure-Python secp256k1 code from
``app.data.ethsig`` (RFC 6979 deterministic nonces, low-s per EIP-2), and was
cross-checked byte-for-byte against eth-account during development.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path

import httpx
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import sigencode_string

from app.data import ethsig

_N = SECP256k1.order
ARTIFACT = Path(__file__).resolve().parents[2] / "contracts" / "AuraxisBadges.json"


class EvmError(RuntimeError):
    """A safe, user-presentable chain failure."""


# --------------------------------------------------------------------------- #
# RLP
# --------------------------------------------------------------------------- #


def _int_bytes(value: int) -> bytes:
    if value < 0:
        raise ValueError("RLP integers must be non-negative")
    return b"" if value == 0 else value.to_bytes((value.bit_length() + 7) // 8, "big")


def _length(length: int, offset: int) -> bytes:
    if length < 56:
        return bytes([offset + length])
    encoded = _int_bytes(length)
    return bytes([offset + 55 + len(encoded)]) + encoded


def rlp(item) -> bytes:
    if isinstance(item, int):
        item = _int_bytes(item)
    if isinstance(item, bytes | bytearray):
        data = bytes(item)
        if len(data) == 1 and data[0] < 0x80:
            return data
        return _length(len(data), 0x80) + data
    if isinstance(item, list | tuple):
        payload = b"".join(rlp(part) for part in item)
        return _length(len(payload), 0xC0) + payload
    raise TypeError(f"Cannot RLP-encode {type(item).__name__}")


# --------------------------------------------------------------------------- #
# ABI (static types only)
# --------------------------------------------------------------------------- #


def selector(signature: str) -> bytes:
    return ethsig.keccak256(signature.encode())[:4]


def encode_word(kind: str, value) -> bytes:
    if kind == "address":
        raw = bytes.fromhex(value[2:])
        if len(raw) != 20:
            raise ValueError("Bad address")
        return raw.rjust(32, b"\x00")
    if kind.startswith("uint"):
        if not 0 <= int(value) < 2**256:
            raise ValueError("uint out of range")
        return int(value).to_bytes(32, "big")
    if kind.startswith("bytes") and kind[5:].isdigit():
        size = int(kind[5:])
        raw = bytes.fromhex(value[2:]) if isinstance(value, str) else bytes(value)
        if not 1 <= size <= 32 or len(raw) != size:
            raise ValueError(f"{kind} must be {size} bytes")
        return raw.ljust(32, b"\x00")  # fixed bytes are left-aligned
    raise ValueError(f"Unsupported ABI type {kind}")


def call_data(signature: str, *args) -> bytes:
    kinds = signature[signature.index("(") + 1 : -1]
    kinds = [k for k in kinds.split(",") if k]
    if len(kinds) != len(args):
        raise ValueError("Argument count mismatch")
    return selector(signature) + b"".join(
        encode_word(kind, value) for kind, value in zip(kinds, args, strict=True)
    )


def decode_uint(result: str) -> int:
    if not isinstance(result, str) or not result.startswith("0x"):
        raise EvmError("Unexpected response from the chain.")
    return int(result[2:] or "0", 16)


# --------------------------------------------------------------------------- #
# Keys and transactions
# --------------------------------------------------------------------------- #


def signing_key(private_key_hex: str) -> SigningKey:
    raw = bytes.fromhex(private_key_hex.removeprefix("0x"))
    if len(raw) != 32 or not 0 < int.from_bytes(raw, "big") < _N:
        raise ValueError("Invalid private key")
    return SigningKey.from_string(raw, curve=SECP256k1)


def address_of(key: SigningKey) -> str:
    point = key.get_verifying_key().pubkey.point
    return ethsig.address_from_public(point.x(), point.y())


def sign_digest(key: SigningKey, digest: bytes) -> tuple[int, int, int]:
    """(y_parity, r, s) with low s (EIP-2), deterministic (RFC 6979)."""
    # RFC 6979 nonce derivation with SHA-256, as Ethereum tooling does (the
    # ecdsa library would otherwise default to SHA-1).
    signature = key.sign_digest_deterministic(
        digest, hashfunc=hashlib.sha256, sigencode=sigencode_string
    )
    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    if s > _N // 2:
        s = _N - s
    me = address_of(key)
    for parity in (0, 1):
        candidate = "0x" + (r.to_bytes(32, "big") + s.to_bytes(32, "big")).hex()
        candidate += format(27 + parity, "02x")
        if ethsig.recover_address(digest, candidate) == me:
            return parity, r, s
    raise EvmError("Could not determine signature parity.")


def sign_eip1559(key: SigningKey, tx: dict) -> bytes:
    """Raw signed type-2 transaction: 0x02 || rlp([... , y, r, s])."""
    to = bytes.fromhex(tx["to"][2:]) if tx.get("to") else b""
    fields = [
        tx["chainId"],
        tx["nonce"],
        tx["maxPriorityFeePerGas"],
        tx["maxFeePerGas"],
        tx["gas"],
        to,
        tx.get("value", 0),
        tx.get("data", b""),
        [],  # access list
    ]
    digest = ethsig.keccak256(b"\x02" + rlp(fields))
    parity, r, s = sign_digest(key, digest)
    return b"\x02" + rlp([*fields, parity, r, s])


def contract_address(sender: str, nonce: int) -> str:
    """Address of a contract created by ``sender`` at ``nonce`` (CREATE)."""
    raw = ethsig.keccak256(rlp([bytes.fromhex(sender[2:]), nonce]))[-20:]
    return ethsig.checksum_address("0x" + raw.hex())


# --------------------------------------------------------------------------- #
# JSON-RPC client
# --------------------------------------------------------------------------- #


class Chain:
    def __init__(self, rpc_url: str, chain_id: int, private_key: str, client=None):
        self.rpc_url = rpc_url
        self.chain_id = chain_id
        self.key = signing_key(private_key)
        self.address = address_of(self.key)
        self.client = client or httpx.Client(timeout=20)
        self._lock = threading.Lock()
        self._next_nonce: int | None = None

    def rpc(self, method: str, params: list):
        try:
            response = self.client.post(
                self.rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            )
        except httpx.HTTPError as exc:
            raise EvmError("The test-network node is unreachable.") from exc
        if response.status_code >= 400:
            raise EvmError(
                f"The test-network node failed (HTTP {response.status_code})."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise EvmError("The test-network node returned invalid data.") from exc
        if "error" in payload:
            message = str(payload["error"].get("message", "error"))[:200]
            raise EvmError(f"Chain rejected the request: {message}")
        return payload.get("result")

    def call(self, to: str, data: bytes) -> str:
        return self.rpc("eth_call", [{"to": to, "data": "0x" + data.hex()}, "latest"])

    def balance(self) -> int:
        return decode_uint(self.rpc("eth_getBalance", [self.address, "latest"]))

    def send(self, to: str | None, data: bytes, gas: int | None = None) -> str:
        """Sign and broadcast; returns the transaction hash."""
        with self._lock:
            pending = decode_uint(
                self.rpc("eth_getTransactionCount", [self.address, "pending"])
            )
            nonce = max(pending, self._next_nonce or 0)
            call = {"from": self.address, "data": "0x" + data.hex()}
            if to:
                call["to"] = to
            if gas is None:
                estimate = decode_uint(self.rpc("eth_estimateGas", [call]))
                gas = estimate + estimate // 4 + 10_000
            tip = decode_uint(self.rpc("eth_maxPriorityFeePerGas", []))
            block = self.rpc("eth_getBlockByNumber", ["latest", False]) or {}
            base = decode_uint(block.get("baseFeePerGas", "0x0"))
            tip = max(tip, 1_000)
            raw = sign_eip1559(
                self.key,
                dict(
                    chainId=self.chain_id,
                    nonce=nonce,
                    maxPriorityFeePerGas=tip,
                    maxFeePerGas=base * 2 + tip,
                    gas=gas,
                    to=to,
                    data=data,
                ),
            )
            tx_hash = self.rpc("eth_sendRawTransaction", ["0x" + raw.hex()])
            self._next_nonce = nonce + 1
            return tx_hash

    def receipt(self, tx_hash: str) -> dict | None:
        return self.rpc("eth_getTransactionReceipt", [tx_hash])

    def wait(self, tx_hash: str, timeout: float = 90) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            receipt = self.receipt(tx_hash)
            if receipt:
                return receipt
            time.sleep(2)
        raise EvmError("Timed out waiting for the transaction.")


def artifact() -> dict:
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))

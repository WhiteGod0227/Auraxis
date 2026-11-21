"""Ethereum signature helpers (EIP-191 personal_sign, EIP-55, EIP-4361).

Pure Python: secp256k1 arithmetic from ``ecdsa`` and keccak-256 from
``pycryptodomex``. Public-key recovery follows SEC 1 v2 §4.1.6 with the
recovery id taken from the signature's ``v`` byte, so the result never
depends on the order in which a library lists candidates.
"""

from __future__ import annotations

import re

from Cryptodome.Hash import keccak
from ecdsa import SECP256k1
from ecdsa.ellipticcurve import INFINITY, Point

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_CURVE = SECP256k1.curve
_G = SECP256k1.generator
_N = SECP256k1.order
_P = _CURVE.p()


class SignatureError(ValueError):
    """The signature is malformed or does not recover to a valid key."""


def keccak256(data: bytes) -> bytes:
    digest = keccak.new(digest_bits=256)
    digest.update(data)
    return digest.digest()


def personal_message_hash(message: str) -> bytes:
    """EIP-191 version 0x45: what wallets sign for ``personal_sign``."""
    data = message.encode("utf-8")
    return keccak256(b"\x19Ethereum Signed Message:\n" + str(len(data)).encode() + data)


def checksum_address(address: str) -> str:
    """EIP-55 mixed-case checksum encoding."""
    if not ADDRESS.match(address or ""):
        raise ValueError("Not an Ethereum address")
    lower = address[2:].lower()
    hashed = keccak256(lower.encode()).hex()
    return "0x" + "".join(
        char.upper() if int(hashed[i], 16) >= 8 else char
        for i, char in enumerate(lower)
    )


def address_from_public(x: int, y: int) -> str:
    raw = x.to_bytes(32, "big") + y.to_bytes(32, "big")
    return checksum_address("0x" + keccak256(raw)[-20:].hex())


def recover_address(digest: bytes, signature: str) -> str:
    """Recover the signer's checksummed address from a 65-byte r||s||v."""
    try:
        raw = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
    except (ValueError, AttributeError) as exc:
        raise SignatureError("Signature is not hex.") from exc
    if len(raw) != 65 or len(digest) != 32:
        raise SignatureError("Signature must be 65 bytes.")
    r = int.from_bytes(raw[:32], "big")
    s = int.from_bytes(raw[32:64], "big")
    v = raw[64]
    recid = v - 27 if v >= 27 else v
    if recid not in (0, 1, 2, 3) or not (0 < r < _N and 0 < s < _N):
        raise SignatureError("Signature values are out of range.")
    x = r + (recid // 2) * _N
    if x >= _P:
        raise SignatureError("Signature does not recover a key.")
    alpha = (pow(x, 3, _P) + 7) % _P
    beta = pow(alpha, (_P + 1) // 4, _P)
    if (beta * beta) % _P != alpha:
        raise SignatureError("Signature does not recover a key.")
    y = beta if beta % 2 == recid % 2 else _P - beta
    point_r = Point(_CURVE, x, y, _N)
    e = int.from_bytes(digest, "big") % _N
    q = (point_r * s + _G * ((-e) % _N)) * pow(r, -1, _N)
    if q == INFINITY:
        raise SignatureError("Signature does not recover a key.")
    return address_from_public(q.x(), q.y())


SIWE_STATEMENT = (
    "Link this wallet to your Auraxis account. Signing is free and does not "
    "allow any transaction or transfer."
)


def siwe_message(
    *,
    domain: str,
    address: str,
    uri: str,
    chain_id: int,
    nonce: str,
    issued_at: str,
    expiration: str,
) -> str:
    """EIP-4361 Sign-In with Ethereum message (exact line format)."""
    return (
        f"{domain} wants you to sign in with your Ethereum account:\n"
        f"{address}\n"
        "\n"
        f"{SIWE_STATEMENT}\n"
        "\n"
        f"URI: {uri}\n"
        "Version: 1\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}\n"
        f"Expiration Time: {expiration}"
    )

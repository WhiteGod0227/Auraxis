import pytest
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import sigencode_string
from fastapi.testclient import TestClient

from app.api import workspaces
from app.api.auth import COOKIE, fingerprint
from app.api.auth import database as auth_database
from app.core.config import Settings, get_settings
from app.data import ethsig
from app.main import app

ORIGIN = {"Origin": "http://localhost:5180"}
KEY_A = SigningKey.from_string(bytes.fromhex("11" * 32), curve=SECP256k1)
KEY_B = SigningKey.from_string(bytes.fromhex("22" * 32), curve=SECP256k1)


def address(key: SigningKey) -> str:
    point = key.get_verifying_key().pubkey.point
    return ethsig.address_from_public(point.x(), point.y())


def personal_sign(key: SigningKey, message: str) -> str:
    """What MetaMask's personal_sign returns: r || s || v (v = 27/28)."""
    digest = ethsig.personal_message_hash(message)
    rs = key.sign_digest_deterministic(digest, sigencode=sigencode_string)
    for v in (27, 28):
        candidate = "0x" + (rs + bytes([v])).hex()
        try:
            if ethsig.recover_address(digest, candidate) == address(key):
                return candidate
        except ethsig.SignatureError:
            continue
    raise AssertionError("no recovery id matched")


# --------------------------------------------------------------------------- #
# Primitives
# --------------------------------------------------------------------------- #


def test_published_vector_and_eip55():
    sig = (
        "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd"
        "6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c"
    )
    digest = ethsig.personal_message_hash("Some data")
    assert ethsig.recover_address(digest, sig) == (
        "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23"
    )
    for checksummed in (
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
        "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
        "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ):
        assert ethsig.checksum_address(checksummed.lower()) == checksummed


@pytest.mark.parametrize(
    "signature",
    [
        "0x00",
        "not-hex",
        "0x" + "00" * 65,
        "0x" + "ff" * 64 + "1b",
        "0x" + "11" * 64 + "05",
    ],
)
def test_malformed_signatures_are_rejected(signature):
    with pytest.raises(ethsig.SignatureError):
        ethsig.recover_address(b"\x00" * 32, signature)


def test_round_trip_with_both_recovery_ids():
    seen = set()
    for i in range(1, 12):
        key = SigningKey.from_string(i.to_bytes(32, "big"), curve=SECP256k1)
        signature = personal_sign(key, f"message {i}")
        seen.add(signature[-2:])
        digest = ethsig.personal_message_hash(f"message {i}")
        assert ethsig.recover_address(digest, signature) == address(key)
    assert seen == {"1b", "1c"}  # both v = 27 and v = 28 exercised


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        auth_database_path=tmp_path / "auth.sqlite3",
        workspace_database_path=tmp_path / "workspaces.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
    )
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as test_client:
        with auth_database(settings) as db:
            for owner in (1, 2):
                db.execute(
                    "INSERT INTO users VALUES (?,?,?,?)",
                    (owner, f"User {owner}", f"u{owner}@example.test", "x"),
                )
                db.execute(
                    "INSERT INTO sessions VALUES (?,?,?)",
                    (fingerprint(f"token-{owner}"), owner, 9999999999),
                )
        test_client.cookies.set(COOKIE, "token-1")
        yield test_client, settings
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def link(client, key, chain_id=1):
    challenge = client.post(
        "/api/wallet/challenge", json={"address": address(key), "chain_id": chain_id}
    )
    assert challenge.status_code == 200, challenge.text
    body = challenge.json()
    return body, client.post(
        "/api/wallet/link",
        json={"nonce": body["nonce"], "signature": personal_sign(key, body["message"])},
    )


def test_link_flow_and_siwe_message(client):
    client, _ = client
    assert client.get("/api/wallet").json() == {"wallet": None}
    challenge, linked = link(client, KEY_A)
    message = challenge["message"]
    lines = message.split("\n")
    assert lines[0] == "localhost:5180 wants you to sign in with your Ethereum account:"
    assert lines[1] == address(KEY_A)
    assert "URI: http://localhost:5180" in lines
    assert "Version: 1" in lines and "Chain ID: 1" in lines
    assert f"Nonce: {challenge['nonce']}" in lines
    assert linked.status_code == 200, linked.text
    wallet = client.get("/api/wallet").json()["wallet"]
    assert wallet["address"] == address(KEY_A) and wallet["chain_id"] == 1
    assert wallet["explorer_url"].endswith(address(KEY_A))
    response = client.get("/api/wallet")
    assert response.headers["cache-control"] == "private, no-store"


def test_nonce_is_single_use_even_after_a_failed_attempt(client):
    client, _ = client
    challenge = client.post(
        "/api/wallet/challenge", json={"address": address(KEY_A), "chain_id": 1}
    ).json()
    wrong = client.post(
        "/api/wallet/link",
        json={
            "nonce": challenge["nonce"],
            "signature": personal_sign(KEY_B, challenge["message"]),
        },
    )
    assert wrong.status_code == 422 and "different wallet" in wrong.json()["detail"]
    retry = client.post(
        "/api/wallet/link",
        json={
            "nonce": challenge["nonce"],
            "signature": personal_sign(KEY_A, challenge["message"]),
        },
    )
    assert retry.status_code == 409
    assert client.get("/api/wallet").json()["wallet"] is None


def test_signature_over_a_different_message_fails(client):
    client, _ = client
    challenge = client.post(
        "/api/wallet/challenge", json={"address": address(KEY_A), "chain_id": 1}
    ).json()
    tampered = challenge["message"].replace("Chain ID: 1", "Chain ID: 5")
    response = client.post(
        "/api/wallet/link",
        json={"nonce": challenge["nonce"], "signature": personal_sign(KEY_A, tampered)},
    )
    assert response.status_code == 422


def test_expired_challenge_is_refused(client):
    client, settings = client
    challenge = client.post(
        "/api/wallet/challenge", json={"address": address(KEY_A), "chain_id": 1}
    ).json()
    with workspaces.database(settings) as db:
        db.execute(
            "UPDATE wallet_challenges SET expires_at='2000-01-01T00:00:00+00:00'"
        )
    response = client.post(
        "/api/wallet/link",
        json={
            "nonce": challenge["nonce"],
            "signature": personal_sign(KEY_A, challenge["message"]),
        },
    )
    assert response.status_code == 409 and "expired" in response.json()["detail"]


def test_one_account_per_wallet_and_unlink(client):
    client, _ = client
    assert link(client, KEY_A)[1].status_code == 200
    client.cookies.set(COOKIE, "token-2")
    _, taken = link(client, KEY_A)
    assert taken.status_code == 409
    assert link(client, KEY_B)[1].status_code == 200
    client.cookies.set(COOKIE, "token-1")
    assert client.delete("/api/wallet").json() == {"wallet": None}
    assert client.get("/api/wallet").json()["wallet"] is None
    # Once unlinked, the wallet can be linked to another account.
    client.cookies.set(COOKIE, "token-2")
    assert link(client, KEY_A)[1].status_code == 200


def test_requires_login_and_allowed_origin(client):
    client, _ = client
    bad_origin = client.post(
        "/api/wallet/challenge",
        json={"address": address(KEY_A), "chain_id": 1},
        headers={"Origin": "https://evil.example"},
    )
    assert bad_origin.status_code == 403
    client.cookies.clear()
    assert client.get("/api/wallet").status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"address": "0x123", "chain_id": 1},
        {"address": "0x" + "a" * 40, "chain_id": 0},
        {"address": "0x" + "a" * 40, "chain_id": "1"},
        {"address": "0x" + "a" * 40, "chain_id": 1, "extra": True},
    ],
)
def test_challenge_validation(client, body):
    client, _ = client
    assert client.post("/api/wallet/challenge", json=body).status_code == 422

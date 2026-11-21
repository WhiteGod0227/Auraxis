import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import practice, wallet, workspaces
from app.api.auth import COOKIE, fingerprint
from app.api.auth import database as auth_database
from app.core.config import Settings, get_settings
from app.data import ethsig, evm, proofs, web3
from app.main import app
from tests.test_proofs import factory as calendar_factory

ORIGIN = {"Origin": "http://localhost:5180"}
SERVER_KEY = "0x" + "44" * 32
CONTRACT = "0x00000000000000000000000000000000000aaaaa"
USER_WALLET = ethsig.checksum_address("0x" + "5a" * 20)
FIXTURE = Path(__file__).parent / "fixtures" / "eip1559_reference.json"


# --------------------------------------------------------------------------- #
# Byte-exact signing (vectors produced by eth-account)
# --------------------------------------------------------------------------- #


def test_signing_matches_eth_account_byte_for_byte():
    cases = json.loads(FIXTURE.read_text())
    assert len(cases) == 8
    for case in cases:
        key = evm.signing_key(case["key"])
        tx = dict(case["tx"], data=bytes.fromhex(case["tx"]["data"][2:]))
        assert "0x" + evm.sign_eip1559(key, tx).hex() == case["raw"]
        assert evm.address_of(key) == case["sender"]


def test_rlp_and_create_address_vectors():
    assert evm.rlp(b"dog").hex() == "83646f67"
    assert evm.rlp([b"cat", b"dog"]).hex() == "c88363617483646f67"
    assert evm.rlp([[], [[]], [[], [[]]]]).hex() == "c7c0c1c0c3c0c1c0"
    assert evm.rlp(0).hex() == "80" and evm.rlp(1024).hex() == "820400"
    sender = "0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0"
    assert evm.contract_address(sender, 0).lower() == (
        "0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d"
    )


def test_abi_encoding():
    data = evm.call_data("mint(address,uint8)", USER_WALLET, 3)
    assert data[:4].hex() == "691562a0"
    assert data[4:36] == bytes(12) + bytes.fromhex(USER_WALLET[2:])
    assert int.from_bytes(data[36:], "big") == 3
    with pytest.raises(ValueError):
        evm.call_data("mint(address,uint8)", USER_WALLET)


# --------------------------------------------------------------------------- #
# Mock node
# --------------------------------------------------------------------------- #


def rlp_decode(data: bytes):
    def item(pos):
        prefix = data[pos]
        if prefix < 0x80:
            return data[pos : pos + 1], pos + 1
        if prefix < 0xB8:
            n = prefix - 0x80
            return data[pos + 1 : pos + 1 + n], pos + 1 + n
        if prefix < 0xC0:
            k = prefix - 0xB7
            n = int.from_bytes(data[pos + 1 : pos + 1 + k], "big")
            start = pos + 1 + k
            return data[start : start + n], start + n
        if prefix < 0xF8:
            n, start = prefix - 0xC0, pos + 1
        else:
            k = prefix - 0xF7
            n = int.from_bytes(data[pos + 1 : pos + 1 + k], "big")
            start = pos + 1 + k
        out, cursor = [], start
        while cursor < start + n:
            value, cursor = item(cursor)
            out.append(value)
        return out, start + n

    return item(0)[0]


class Node:
    """Simulates the AuraxisBadges contract behind JSON-RPC."""

    def __init__(self, operator: str):
        self.operator = operator
        self.nonce = 0
        self.sent = []
        self.receipts = {}
        self.tokens = {}  # (address, badge) -> token id
        self.anchors = {}  # root hex -> timestamp
        self.supply = 0
        self.fail_next = False

    def handle(self, request: httpx.Request):
        body = json.loads(request.content)
        method, params = body["method"], body["params"]
        result = getattr(self, method)(*params)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})

    def eth_getTransactionCount(self, address, tag):
        return hex(self.nonce)

    def eth_estimateGas(self, call):
        return hex(80_000)

    def eth_maxPriorityFeePerGas(self):
        return hex(1_000_000)

    def eth_getBlockByNumber(self, tag, full):
        return {"baseFeePerGas": hex(50_000)}

    def eth_getBalance(self, address, tag):
        return hex(10**16)

    def eth_sendRawTransaction(self, raw_hex):
        raw = bytes.fromhex(raw_hex[2:])
        assert raw[0] == 2
        fields = rlp_decode(raw[1:])
        unsigned, (y, r, s) = fields[:9], fields[9:]
        digest = ethsig.keccak256(b"\x02" + evm.rlp(unsigned))
        signature = "0x" + r.rjust(32, b"\0").hex() + s.rjust(32, b"\0").hex()
        signature += format(27 + int.from_bytes(y, "big"), "02x")
        assert ethsig.recover_address(digest, signature) == self.operator
        nonce = int.from_bytes(unsigned[1], "big")
        assert nonce == self.nonce, "nonce must be sequential"
        self.nonce += 1
        data = unsigned[7]
        tx_hash = "0x" + ethsig.keccak256(raw).hex()
        self.sent.append((tx_hash, data))
        logs = []
        status = "0x0" if self.fail_next else "0x1"
        if status == "0x1" and data[:4] == evm.selector("mint(address,uint8)"):
            to = ethsig.checksum_address("0x" + data[16:36].hex())
            badge = int.from_bytes(data[36:68], "big")
            self.supply += 1
            self.tokens[(to, badge)] = self.supply
            logs.append(
                {
                    "topics": [
                        web3.TRANSFER_TOPIC,
                        "0x" + "00" * 32,
                        "0x" + data[4:36].hex(),
                        "0x" + self.supply.to_bytes(32, "big").hex(),
                    ]
                }
            )
        if status == "0x1" and data[:4] == evm.selector("anchor(bytes32,uint256)"):
            self.anchors[data[4:36].hex()] = 1_790_000_000
        self.fail_next = False
        self.receipts[tx_hash] = {
            "status": status,
            "blockNumber": hex(123),
            "logs": logs,
        }
        return tx_hash

    def eth_getTransactionReceipt(self, tx_hash):
        return self.receipts.get(tx_hash)

    def eth_call(self, call, tag):
        data = bytes.fromhex(call["data"][2:])
        if data[:4] == evm.selector("tokenOfBadge(address,uint8)"):
            to = ethsig.checksum_address("0x" + data[16:36].hex())
            badge = int.from_bytes(data[36:68], "big")
            return "0x" + self.tokens.get((to, badge), 0).to_bytes(32, "big").hex()
        if data[:4] == evm.selector("anchoredAt(bytes32)"):
            return (
                "0x" + self.anchors.get(data[4:36].hex(), 0).to_bytes(32, "big").hex()
            )
        raise AssertionError("unexpected call")


@pytest.fixture
def node():
    operator = evm.address_of(evm.signing_key(SERVER_KEY))
    mock = Node(operator)
    web3.set_chain(
        evm.Chain(
            "https://rpc.test",
            84532,
            SERVER_KEY,
            client=httpx.Client(transport=httpx.MockTransport(mock.handle)),
        )
    )
    yield mock
    web3.set_chain(None)


@pytest.fixture
def settings(tmp_path):
    return Settings(
        auth_database_path=tmp_path / "auth.sqlite3",
        workspace_database_path=tmp_path / "workspaces.sqlite3",
        practice_database_path=tmp_path / "practice.sqlite3",
        proofs_database_path=tmp_path / "proofs.sqlite3",
        proofs_enabled=True,
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
        web3_contract=CONTRACT,
        web3_signer_key=SERVER_KEY,
        web3_rpc_url="https://rpc.test",
    )


@pytest.fixture
def client(settings):
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as test_client:
        with auth_database(settings) as db:
            db.execute("INSERT INTO users VALUES (1,'User','u@example.test','x')")
            db.execute(
                "INSERT INTO sessions VALUES (?,1,9999999999)",
                (fingerprint("token-1"),),
            )
        test_client.cookies.set(COOKIE, "token-1")
        yield test_client
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def earn(settings, code):
    with practice.database(settings) as db:
        db.execute(
            "INSERT OR IGNORE INTO achievements VALUES (1, ?, ?)",
            (code, datetime.now(UTC).isoformat()),
        )


def link_wallet(settings):
    with workspaces.database(settings) as db:
        wallet._initialize(db)
        db.execute(
            "INSERT INTO wallet_links VALUES (1, ?, 84532, ?)",
            (USER_WALLET, datetime.now(UTC).isoformat()),
        )


# --------------------------------------------------------------------------- #
# Badges
# --------------------------------------------------------------------------- #


def test_claim_mints_to_linked_wallet_and_confirms(client, settings, node):
    earn(settings, "pair_trader")
    link_wallet(settings)
    claimed = client.post("/api/badges/pair_trader/claim")
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "pending"
    assert len(node.sent) == 1
    web3.confirm_mints(settings)
    listed = {b["code"]: b for b in client.get("/api/badges").json()["badges"]}
    badge = listed["pair_trader"]
    assert badge["status"] == "minted" and badge["token_id"] == 1
    assert badge["address"] == USER_WALLET
    assert badge["token_url"].endswith(f"{CONTRACT}?a=1")
    assert node.tokens[(USER_WALLET, web3.BADGES.index("pair_trader"))] == 1
    # Claiming again sends nothing.
    again = client.post("/api/badges/pair_trader/claim")
    assert again.json()["status"] == "minted" and len(node.sent) == 1


def test_claim_rules(client, settings, node):
    assert client.post("/api/badges/nope/claim").status_code == 404
    assert client.post("/api/badges/first_trade/claim").status_code == 409  # not earned
    earn(settings, "first_trade")
    no_wallet = client.post("/api/badges/first_trade/claim")
    assert (
        no_wallet.status_code == 409 and "Link a wallet" in no_wallet.json()["detail"]
    )
    assert node.sent == []


def test_disabled_without_contract(client, settings, node):
    settings.web3_contract = ""
    earn(settings, "first_trade")
    link_wallet(settings)
    response = client.post("/api/badges/first_trade/claim")
    assert response.status_code == 503
    assert client.get("/api/badges").json()["enabled"] is False


def test_already_minted_on_chain_is_recorded_without_sending(client, settings, node):
    earn(settings, "first_trade")
    link_wallet(settings)
    node.tokens[(USER_WALLET, 0)] = 7
    response = client.post("/api/badges/first_trade/claim")
    assert response.json()["status"] == "minted" and node.sent == []


def test_reverted_mint_is_marked_failed(client, settings, node):
    earn(settings, "first_trade")
    link_wallet(settings)
    node.fail_next = True
    client.post("/api/badges/first_trade/claim")
    web3.confirm_mints(settings)
    badge = client.get("/api/badges").json()["badges"][0]
    assert badge["status"] == "failed" and badge["error"]


# --------------------------------------------------------------------------- #
# Anchors
# --------------------------------------------------------------------------- #


def test_sealed_roots_are_anchored_and_verifiable(settings, node):
    record = proofs.certify(settings, 1, "test", "r1", "R", {"v": 1})
    batch = proofs.make_batch(settings, force=True, calendar_factory=calendar_factory())
    web3.anchor_batches(settings)  # sends anchor(root, batchId)
    assert len(node.sent) == 1
    data = node.sent[0][1]
    with proofs.database(settings) as db:
        root = db.execute("SELECT root FROM batches WHERE id=?", (batch,)).fetchone()[0]
    assert data == evm.call_data("anchor(bytes32,uint256)", "0x" + root, batch)
    web3.anchor_batches(settings)  # confirms from the receipt
    with proofs.database(settings) as db:
        row = db.execute(
            "SELECT evm_status, evm_block FROM batches WHERE id=?", (batch,)
        ).fetchone()
        stored = db.execute(
            "SELECT * FROM records WHERE id=?", (record["id"],)
        ).fetchone()
    assert row["evm_status"] == "confirmed" and row["evm_block"] == 123
    bundle = json.loads(json.dumps(proofs.bundle(settings, stored)))
    assert bundle["batch"]["evm"]["tx_url"].endswith(node.sent[0][0])
    result = proofs.verify_bundle(settings, bundle)
    published = [c for c in result["checks"] if c["name"].startswith("Published on")]
    assert published and published[0]["ok"] is True
    assert result["valid"] is True
    web3.anchor_batches(settings)  # nothing left to do
    assert len(node.sent) == 1


def test_nonces_are_sequential_across_sends(settings, node):
    for i in range(3):
        proofs.certify(settings, 1, "test", f"n{i}", "R", {"v": i})
        proofs.make_batch(settings, force=True, calendar_factory=calendar_factory())
    web3.anchor_batches(settings)
    assert node.nonce == 3 and len(node.sent) == 3


def test_fixed_bytes_are_left_aligned():
    # supportsInterface(bytes4) as used by the deploy verification.
    data = evm.call_data("supportsInterface(bytes4)", "0x80ac58cd")
    assert data[:4].hex() == "01ffc9a7"
    assert data[4:] == bytes.fromhex("80ac58cd") + bytes(28)
    with pytest.raises(ValueError):
        evm.call_data("supportsInterface(bytes4)", "0x80ac58")

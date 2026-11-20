import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from opentimestamps.core.notary import BitcoinBlockHeaderAttestation, PendingAttestation
from opentimestamps.core.timestamp import Timestamp

from app.api import practice
from app.api.auth import COOKIE, fingerprint
from app.api.auth import database as auth_database
from app.core.config import Settings, get_settings
from app.data import proofs
from app.main import app
from tests import test_workspaces

ORIGIN = {"Origin": "http://localhost:5180"}
GOOD_CALENDAR = "https://alice.btc.calendar.opentimestamps.org"
EVIL_CALENDAR = "https://evil.example/steal"


@pytest.fixture
def settings(tmp_path):
    return Settings(
        proofs_enabled=True,
        proofs_database_path=tmp_path / "proofs.sqlite3",
        proofs_batch_minutes=60,
        proofs_calendars=["https://a.pool.opentimestamps.org"],
        auth_database_path=tmp_path / "auth.sqlite3",
        workspace_database_path=tmp_path / "workspaces.sqlite3",
        practice_database_path=tmp_path / "practice.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
    )


class FakeCalendar:
    """Submit returns a pending stamp; upgrade returns a Bitcoin attestation."""

    contacted: list[str] = []

    def __init__(self, url, height=900_000, fail=False):
        self.url, self.height, self.fail = url, height, fail
        FakeCalendar.contacted.append(url)

    def submit(self, digest, timeout=None):
        if self.fail:
            raise OSError("calendar down")
        stamp = Timestamp(digest)
        stamp.attestations.add(PendingAttestation(GOOD_CALENDAR))
        stamp.attestations.add(PendingAttestation(EVIL_CALENDAR))
        return stamp

    def get_timestamp(self, commitment, timeout=None):
        stamp = Timestamp(commitment)
        stamp.attestations.add(BitcoinBlockHeaderAttestation(self.height))
        return stamp


def factory(**options):
    return lambda url: FakeCalendar(url, **options)


def explorer_for(ots: bytes, when: int = 1_790_000_000):
    """Mock block explorer serving a real header that commits to the stamp."""
    from bitcoin.core import CBlockHeader

    (msg, height), *_ = proofs.bitcoin_attestations(ots)
    header = CBlockHeader(
        nVersion=0x20000000,
        hashPrevBlock=b"\x00" * 32,
        hashMerkleRoot=msg,
        nTime=when,
        nBits=0x17034219,
        nNonce=1,
    )
    block_hash = header.GetHash()[::-1].hex()

    def handler(request: httpx.Request):
        if request.url.path.endswith(f"/block-height/{height}"):
            return httpx.Response(200, text=block_hash)
        if request.url.path.endswith(f"/block/{block_hash}/header"):
            return httpx.Response(200, text=header.serialize().hex())
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


# --------------------------------------------------------------------------- #
# Hashing and Merkle trees
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("count", range(1, 10))
def test_every_leaf_path_reaches_the_root(count):
    leaves = [hashlib.sha256(bytes([i])).digest() for i in range(count)]
    levels = proofs.merkle_levels(leaves)
    root = levels[-1][0]
    for index, leaf in enumerate(leaves):
        assert proofs.root_from_path(leaf, proofs.merkle_path(levels, index)) == root
    # Changing any one leaf changes the root.
    for index in range(count):
        changed = list(leaves)
        changed[index] = hashlib.sha256(b"x" + bytes([index])).digest()
        assert proofs.merkle_levels(changed)[-1][0] != root


def test_single_leaf_root_and_domain_separation():
    leaf = proofs.leaf_hash(b"s" * 32, {"a": 1})
    assert proofs.merkle_levels([leaf])[-1][0] == leaf
    # A leaf hash is never computed like an inner node.
    assert leaf != hashlib.sha256(b"s" * 32 + proofs.canonical({"a": 1})).digest()
    assert proofs.node_hash(leaf, leaf) != hashlib.sha256(leaf + leaf).digest()


def test_canonical_json_and_salt():
    assert proofs.canonical({"b": 1, "a": "₹"}) == proofs.canonical({"a": "₹", "b": 1})
    content = {"value": 1}
    assert proofs.leaf_hash(b"1" * 32, content) != proofs.leaf_hash(b"2" * 32, content)


def test_malformed_path_is_rejected():
    with pytest.raises(ValueError):
        proofs.root_from_path(b"\x00" * 32, [{"hash": "abcd", "side": "left"}])
    with pytest.raises(ValueError):
        proofs.root_from_path(b"\x00" * 32, [{"hash": "00" * 32, "side": "up"}])


def test_calendar_allowlist():
    assert proofs.allowed_calendar(GOOD_CALENDAR)
    assert proofs.allowed_calendar("https://finney.calendar.eternitywall.com")
    assert not proofs.allowed_calendar(EVIL_CALENDAR)
    assert not proofs.allowed_calendar("http://alice.btc.calendar.opentimestamps.org")
    assert not proofs.allowed_calendar("https://calendar.opentimestamps.org.evil.com")


# --------------------------------------------------------------------------- #
# Batching, stamping, upgrading
# --------------------------------------------------------------------------- #


def test_full_lifecycle_to_bitcoin_confirmation(settings):
    ids = [
        proofs.certify(settings, 1, "test", f"r{i}", f"R{i}", {"v": i})["id"]
        for i in range(5)
    ]
    # Not due until the oldest record is older than the batch interval.
    assert proofs.make_batch(settings, calendar_factory=factory()) is None
    batch = proofs.make_batch(settings, force=True, calendar_factory=factory())
    with proofs.database(settings) as db:
        row = db.execute("SELECT * FROM batches WHERE id=?", (batch,)).fetchone()
        record = db.execute("SELECT * FROM records WHERE id=?", (ids[3],)).fetchone()
    assert row["status"] == "pending" and row["ots"]
    # The .ots file commits to the stamped document, which names the root.
    detached = proofs.load_ots(row["ots"])
    assert detached.file_digest == hashlib.sha256(row["document"].encode()).digest()
    assert row["root"] in row["document"]

    FakeCalendar.contacted.clear()
    upgraded, changed = proofs.upgrade(row["ots"], factory())
    assert changed
    assert EVIL_CALENDAR not in FakeCalendar.contacted  # SSRF guard
    assert GOOD_CALENDAR in FakeCalendar.contacted

    with proofs.database(settings) as db:
        db.execute("UPDATE batches SET ots=? WHERE id=?", (upgraded, batch))
    client = explorer_for(upgraded, when=1_790_000_000)
    proofs.refresh_batch(settings, batch, client, factory())
    with proofs.database(settings) as db:
        row = db.execute("SELECT * FROM batches WHERE id=?", (batch,)).fetchone()
    assert row["status"] == "confirmed" and row["bitcoin_height"] == 900_000
    assert row["bitcoin_time"].startswith(
        datetime.fromtimestamp(1_790_000_000, UTC).isoformat()[:16]
    )

    bundle = json.loads(json.dumps(proofs.bundle(settings, record)))
    result = proofs.verify_bundle(settings, bundle)
    assert result["valid"] and result["anchored"]
    assert result["bitcoin"]["height"] == 900_000
    tampered = copy.deepcopy(bundle)
    tampered["record"]["content"]["v"] = 99
    assert not proofs.verify_bundle(settings, tampered)["valid"]
    forged = copy.deepcopy(bundle)
    forged["root"] = "00" * 32
    assert not proofs.verify_bundle(settings, forged)["valid"]


def test_wrong_block_header_is_not_accepted(settings):
    proofs.certify(settings, 1, "test", "r", "R", {"v": 1})
    batch = proofs.make_batch(settings, force=True, calendar_factory=factory())
    with proofs.database(settings) as db:
        ots = db.execute("SELECT ots FROM batches WHERE id=?", (batch,)).fetchone()[0]
    upgraded, _ = proofs.upgrade(ots, factory())
    good = explorer_for(upgraded)
    # Same height, but the explorer serves a header for different data.
    from bitcoin.core import CBlockHeader

    wrong = CBlockHeader(hashMerkleRoot=b"\x11" * 32, nTime=1, nBits=0x17034219)

    def handler(request):
        if "/block-height/" in request.url.path:
            return httpx.Response(200, text=wrong.GetHash()[::-1].hex())
        return httpx.Response(200, text=wrong.serialize().hex())

    bad = httpx.Client(transport=httpx.MockTransport(handler))
    assert proofs.verify_bitcoin(settings, upgraded, bad) is None
    assert proofs.verify_bitcoin(settings, upgraded, good) is not None


def test_failed_submission_is_retried(settings):
    proofs.certify(settings, 1, "test", "r", "R", {"v": 1})
    batch = proofs.make_batch(settings, force=True, calendar_factory=factory(fail=True))
    with proofs.database(settings) as db:
        assert (
            db.execute("SELECT status FROM batches WHERE id=?", (batch,)).fetchone()[0]
            == "failed"
        )
    proofs.refresh_batch(settings, batch, httpx.Client(), factory())
    with proofs.database(settings) as db:
        row = db.execute(
            "SELECT status, ots FROM batches WHERE id=?", (batch,)
        ).fetchone()
    assert row["status"] == "pending" and row["ots"]


def test_batch_due_after_interval(settings):
    proofs.certify(settings, 1, "test", "r", "R", {"v": 1})
    old = (datetime.now(UTC) - timedelta(minutes=61)).isoformat()
    with proofs.database(settings) as db:
        db.execute("UPDATE records SET created_at=?", (old,))
    assert proofs.make_batch(settings, calendar_factory=factory()) is not None
    # Nothing left to seal.
    assert proofs.make_batch(settings, force=True, calendar_factory=factory()) is None


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


@pytest.fixture
def client(settings):
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
        yield test_client
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def workspace_payload():
    return test_workspaces.payload()


def test_certify_research_list_get_and_verify(client, settings):
    created = client.post("/api/workspaces", json=workspace_payload())
    assert created.status_code == 201, created.text
    workspace = created.json()
    certified = client.post(f"/api/proofs/research/{workspace['id']}")
    assert certified.status_code == 201, certified.text
    again = client.post(f"/api/proofs/research/{workspace['id']}")
    assert again.json()["id"] == certified.json()["id"]  # same revision, same proof
    listed = client.get("/api/proofs").json()["proofs"]
    assert [p["status"] for p in listed] == ["queued"]
    proofs.make_batch(settings, force=True, calendar_factory=factory())
    bundle = client.get(f"/api/proofs/{certified.json()['id']}").json()
    assert bundle["record"]["content"]["notes"] == workspace_payload()["notes"]
    # Public verification needs no login.
    client.cookies.clear()
    result = client.post("/api/proofs/verify", content=json.dumps(bundle)).json()
    assert result["valid"] is True and result["anchored"] is False
    bundle["record"]["content"]["notes"] = "edited later"
    assert (
        client.post("/api/proofs/verify", content=json.dumps(bundle)).json()["valid"]
        is False
    )


def test_proofs_are_private_to_their_owner(client, settings):
    record = proofs.certify(settings, 1, "test", "private", "Mine", {"v": 1})
    client.cookies.set(COOKIE, "token-2")
    assert client.get(f"/api/proofs/{record['id']}").status_code == 404
    assert client.get("/api/proofs").json()["proofs"] == []
    created = client.post("/api/workspaces", json=workspace_payload())
    assert created.status_code == 201, created.text
    client.cookies.set(COOKIE, "token-1")
    other = client.post(f"/api/proofs/research/{created.json()['id']}")
    assert other.status_code == 404


BAD_BODIES = {
    "not-json": ("not json", 422),
    "wrong-format": (json.dumps({"format": "something-else"}), 422),
    "too-large": (None, 413),
}


@pytest.mark.parametrize("case", BAD_BODIES)
def test_verify_rejects_bad_input(client, case):
    body, status = BAD_BODIES[case]
    body = "x" * (300 * 1024) if body is None else body
    assert client.post("/api/proofs/verify", content=body).status_code == status


def test_closing_a_practice_trade_creates_a_proof(client, settings):
    market = practice.Market(
        can_trade=True,
        reason="",
        trade_date="2030-11-20",
        updated_at=datetime.now(UTC).isoformat(),
        quotes={("GOLDTEN", "2030-11-30"): (125_000.0, True)},
        product_expiry={"GOLDTEN": "2030-11-30"},
        pairs={},
    )
    app.dependency_overrides[practice.get_market_source] = lambda: lambda _s: market
    try:
        opened = client.post(
            "/api/practice/orders",
            json=dict(
                request_id="proof-trade-1",
                kind="product",
                instrument="GOLDTEN",
                side="buy",
                grams=10,
            ),
        )
        assert opened.status_code == 201, opened.text
        closed = client.post(f"/api/practice/positions/{opened.json()['id']}/close")
        assert closed.status_code == 200
    finally:
        app.dependency_overrides.pop(practice.get_market_source, None)
    listed = client.get("/api/proofs").json()["proofs"]
    assert len(listed) == 1 and listed[0]["kind"] == "practice_trade"
    bundle = client.get(f"/api/proofs/{listed[0]['id']}").json()
    assert bundle["record"]["content"]["instrument"] == "GOLDTEN"
    assert bundle["record"]["content"]["net_paise"] < 0  # costs only


def test_disabled_proofs_return_404():
    # Tests run with PROOFS_ENABLED=false unless a fixture turns it on.
    response = TestClient(app).post("/api/proofs/verify", content="{}")
    assert response.status_code == 404


def js_roundtrip(value):
    """Mimic JSON.parse/JSON.stringify in a browser: 0.0 becomes 0."""
    if isinstance(value, dict):
        return {k: js_roundtrip(v) for k, v in value.items()}
    if isinstance(value, list):
        return [js_roundtrip(v) for v in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def test_proof_survives_browser_reserialization(settings):
    """Regression: a downloaded proof must verify even after a browser
    re-encodes its numbers (found in the end-to-end test)."""
    record = proofs.certify(
        settings, 1, "test", "floats", "F", {"price": 125000.0, "grams": 0.0, "x": 1.5}
    )
    proofs.make_batch(settings, force=True, calendar_factory=factory())
    with proofs.database(settings) as db:
        record = db.execute(
            "SELECT * FROM records WHERE id=?", (record["id"],)
        ).fetchone()
    bundle = js_roundtrip(json.loads(json.dumps(proofs.bundle(settings, record))))
    assert bundle["record"]["content"]["price"] == 125000  # now an int
    assert proofs.verify_bundle(settings, bundle)["valid"] is True
    # Editing the exact JSON is still caught.
    bundle["record"]["content_json"] = bundle["record"]["content_json"].replace(
        "1.5", "2.5"
    )
    assert proofs.verify_bundle(settings, bundle)["valid"] is False

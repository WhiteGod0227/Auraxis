"""Verified offline responses with versioned files and an atomic manifest."""

import hashlib
import inspect
import json
import os
import shutil
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated, get_type_hints
from uuid import uuid4

from fastapi.params import Param
from fastapi.routing import APIRoute
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.engine import make_url

from app.analytics.backtest import PAIRS
from app.api.analytics import router as analytics_router
from app.api.database import get_connection
from app.api.foundation import router as foundation_router
from app.core.config import BACKEND_DIR, get_settings

SCHEMA_VERSION = 1
DEFAULT_OUTPUT = BACKEND_DIR.parent / "frontend" / "public" / "snapshots"
ROUTES = {
    route.path: route
    for route in [*foundation_router.routes, *analytics_router.routes]
    if isinstance(route, APIRoute)
}
LIMITATIONS = [
    "Historical offline data, not live prices or executable market fills.",
    "Only exact supported parameter sets are available offline; custom requests "
    "must be unavailable, never relabeled defaults.",
    "Purity assumptions are unverified against MCX specifications.",
    "Expiry series and simulations are independent, not portfolio aggregates.",
    "Missing prices, invalid diagnostics and outstanding positions remain visible.",
    "A snapshot does not refresh when the database changes; rerun the exporter.",
]


def _json_bytes(value):
    return (
        json.dumps(value, allow_nan=False, sort_keys=True, indent=2) + "\n"
    ).encode()


def _json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def canonical_parameters(endpoint, parameters=None, *, settings=None):
    """Resolve omitted defaults and validate typed values before exact matching."""
    settings = settings or get_settings()
    route = ROUTES[endpoint]
    supplied = dict(parameters or {})
    signature = inspect.signature(route.endpoint)
    fields = {
        name: field
        for name, field in signature.parameters.items()
        if name not in {"connection", "settings"}
    }
    annotations = get_type_hints(route.endpoint, include_extras=True)
    if set(supplied) - set(fields):
        raise ValueError("Unknown query parameter")
    applied = {}
    for name, field in fields.items():
        default = (
            field.default.default if isinstance(field.default, Param) else field.default
        )
        if name not in supplied and default is inspect.Parameter.empty:
            raise ValueError("Missing required query parameter")
        value = supplied.get(name, default)
        try:
            annotation = annotations[name]
            if isinstance(field.default, Param):
                annotation = Annotated[annotation, field.default]
            value = TypeAdapter(annotation).validate_python(value)
        except ValidationError:
            raise ValueError("Invalid query parameter") from None
        if endpoint == "/api/data-health" and name == "min_volume_grams":
            value = settings.api_min_volume_grams if value is None else value
        applied[name] = _json_value(value)
    return dict(sorted(applied.items()))


def request_key(endpoint, parameters=None, *, settings=None):
    applied = canonical_parameters(endpoint, parameters, settings=settings)
    return json.dumps(
        {"endpoint": endpoint, "parameters": applied},
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def supported_requests(settings):
    requests = [
        (path, {})
        for path in ("/api/meta", "/api/overview", "/api/prices", "/api/data-health")
    ]
    for pair in settings.spread_pairs:
        parts = pair.split("-")
        if len(parts) != 2 or not all(p in settings.bhavcopy_symbols for p in parts):
            raise ValueError("Configured spread pair has unsupported products")
        for purity in (True, False):
            for carry in (True, False) if "GOLDM" in parts else (True,):
                requests.append(
                    (
                        "/api/spreads",
                        dict(pair=pair, purity=purity, carry_adjusted=carry),
                    )
                )
    for product in settings.bhavcopy_symbols:
        for purity in (True, False):
            for endpoint in ("/api/curve", "/api/rolldown"):
                requests.append((endpoint, dict(product=product, purity=purity)))
    for pair in PAIRS:
        if pair in settings.spread_pairs and all(
            p in settings.bhavcopy_symbols for p in pair.split("-")
        ):
            for purity in (True, False):
                requests.append(("/api/backtest", dict(pair=pair, purity=purity)))
    return requests


def build_payload(endpoint, parameters, connection, settings):
    """Invoke the actual endpoint builder and its actual Pydantic response schema."""
    route = ROUTES[endpoint]
    kwargs = dict(parameters)
    for name in ("date", "start", "end", "expiry"):
        if kwargs.get(name) is not None:
            kwargs[name] = date.fromisoformat(kwargs[name])
    response = route.endpoint(**kwargs, connection=connection, settings=settings)
    return route.response_model.model_validate(response).model_dump(mode="json")


@contextmanager
def consistent_connection(settings):
    """SQLite explicit BEGIN pins all builder reads to the same read transaction.

    SQLAlchemy's implicit transaction alone does not emit SQLite BEGIN for SELECT
    in legacy sqlite3 mode. The explicit statement prevents mixed generations.
    """
    dependency = get_connection(settings)
    connection = next(dependency)
    try:
        if connection is not None:
            connection.exec_driver_sql("BEGIN")
        yield connection
    finally:
        if connection is not None:
            connection.rollback()
        dependency.close()


def _strict_load(data):
    def reject(value):
        raise ValueError("Nonfinite JSON value")

    return json.loads(data, parse_constant=reject)


def verify_snapshot_set(output):
    """Validate every referenced file, checksum, schema and canonical request key."""
    output = Path(output)
    manifest = _strict_load((output / "manifest.json").read_bytes())
    if manifest["snapshot_schema_version"] != SCHEMA_VERSION:
        raise ValueError("Unsupported snapshot schema version")
    keys = set()
    for entry in manifest["files"]:
        path = (output / entry["path"]).resolve()
        if not path.is_relative_to(output.resolve()):
            raise ValueError("Snapshot path escapes output directory")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError("Snapshot checksum mismatch")
        if len(data) != entry["size_bytes"]:
            raise ValueError("Snapshot size mismatch")
        payload = _strict_load(data)
        ROUTES[entry["endpoint"]].response_model.model_validate(payload)
        if payload["data_as_of"] != manifest["data_as_of"]:
            raise ValueError("Inconsistent snapshot database dates")
        key = request_key(entry["endpoint"], entry["parameters"])
        if key != entry["request_key"] or key in keys:
            raise ValueError("Invalid or duplicate canonical request")
        keys.add(key)
    if sorted(keys) != sorted(manifest["supported_offline_configurations"]):
        raise ValueError("Manifest supported configurations do not match files")
    return manifest


def export_snapshots(*, settings=None, output_dir=None):
    settings = settings or get_settings()
    output = Path(output_dir) if output_dir is not None else DEFAULT_OUTPUT
    output.mkdir(parents=True, exist_ok=True)
    version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex
    stage = output / (".staging-" + version)
    stage.mkdir()
    temp_manifest = output / (".manifest-" + version + ".tmp")
    try:
        entries = []
        payloads = []
        request_keys = set()
        with consistent_connection(settings) as connection:
            for endpoint, query in supported_requests(settings):
                parameters = canonical_parameters(endpoint, query, settings=settings)
                payload = build_payload(endpoint, parameters, connection, settings)
                payloads.append(payload)
                key = request_key(endpoint, parameters, settings=settings)
                if key in request_keys:
                    raise ValueError("Duplicate configured snapshot request")
                request_keys.add(key)
                filename = (
                    endpoint.rsplit("/", 1)[-1]
                    + "-"
                    + hashlib.sha256(key.encode()).hexdigest()
                    + ".json"
                )
                data = _json_bytes(payload)
                (stage / filename).write_bytes(data)
                entries.append(
                    dict(
                        path=f"versions/{version}/{filename}",
                        endpoint=endpoint,
                        parameters=parameters,
                        request_key=key,
                        sha256=hashlib.sha256(data).hexdigest(),
                        size_bytes=len(data),
                    )
                )
        meta = payloads[0]
        manifest = dict(
            snapshot_schema_version=SCHEMA_VERSION,
            generated_at_utc=datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            data_as_of=meta["data_as_of"],
            data_window=dict(
                first_trade_date=meta["first_trade_date"],
                last_trade_date=meta["last_trade_date"],
            ),
            purity_verification_status=meta["normalization"][
                "purity_verification_status"
            ],
            files=entries,
            supported_offline_configurations=[e["request_key"] for e in entries],
            canonicalization="Resolve omitted endpoint defaults; "
            "include optional nulls. "
            "Typed JSON booleans and numbers, ISO date strings, sorted parameter keys. "
            "Unknown parameters rejected; exact full request key required.",
            limitations=LIMITATIONS,
            publication="Immutable version directories; "
            "atomically replace manifest last. "
            "Previous versions retained so readers of an older manifest remain valid.",
        )
        # Validate staged files before publishing any reference to this generation.
        for entry, payload in zip(entries, payloads, strict=True):
            if payload["data_as_of"] != meta["data_as_of"]:
                raise ValueError("Inconsistent snapshot database dates")
            filename = Path(entry["path"]).name
            data = (stage / filename).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise ValueError("Staged checksum mismatch")
            ROUTES[entry["endpoint"]].response_model.model_validate(_strict_load(data))
        temp_manifest.write_bytes(_json_bytes(manifest))
        versions = output / "versions"
        versions.mkdir(exist_ok=True)
        os.replace(stage, versions / version)
        # No mutation of prior generations. A failure here leaves at most an orphan
        # version, while the old manifest and all its files remain intact.
        os.replace(temp_manifest, output / "manifest.json")
        return manifest
    finally:
        if stage.exists() and stage.resolve().is_relative_to(output.resolve()):
            shutil.rmtree(stage)
        temp_manifest.unlink(missing_ok=True)


def _database_digest(settings):
    url = make_url(settings.database_url)
    if not url.database or url.database == ":memory:":
        return None
    path = Path(url.database)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def main():
    try:
        settings = get_settings()
        before = _database_digest(settings)
        manifest = export_snapshots(settings=settings)
        verify_snapshot_set(DEFAULT_OUTPUT)
        unchanged = before == _database_digest(settings)
        print(f"Exported {len(manifest['files'])} response files plus manifest.json")
        print(f"Data window: {manifest['data_window']}")
        print(f"data_as_of: {manifest['data_as_of']}")
        response_bytes = sum(e["size_bytes"] for e in manifest["files"])
        manifest_bytes = (DEFAULT_OUTPUT / "manifest.json").stat().st_size
        print(
            f"Active output: {response_bytes} response bytes; "
            f"{manifest_bytes} manifest bytes; "
            f"{response_bytes + manifest_bytes} total bytes"
        )
        counts = {}
        for entry in manifest["files"]:
            counts[entry["endpoint"]] = counts.get(entry["endpoint"], 0) + 1
            payload = _strict_load((DEFAULT_OUTPUT / entry["path"]).read_bytes())
            empty = any(
                payload.get(field) == []
                for field in ("series", "points", "reports")
                if field in payload
            )
            if not payload["data_available"] or empty:
                print(f"Empty/unavailable: {entry['request_key']}")
        print(f"Supported configuration counts: {counts}")
        print(
            f"Spread pairs: {settings.spread_pairs}; purity true/false; "
            "GOLDM carry true/false; same-expiry carry true"
        )
        print(
            f"Curve/roll-down products: {settings.bhavcopy_symbols}; purity true/false"
        )
        print(
            f"Default backtests: {[p for p in PAIRS if p in settings.spread_pairs]}; "
            "purity true/false; all expiries kept separate"
        )
        print("Meta/overview/prices/data-health: endpoint defaults only")
        print(
            "Exact full canonical configurations and limitations are in manifest.json"
        )
        print(f"Database unchanged: {unchanged}")
        return 0 if unchanged else 1
    except Exception:
        # Do not leak configuration, filesystem paths or private tracebacks.
        print("Snapshot export or verification failed; private error details withheld.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

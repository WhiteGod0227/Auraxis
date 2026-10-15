# Auraxis backend

Current status and run commands: [LOCAL_RUN_HANDOVER.md](../docs/LOCAL_RUN_HANDOVER.md).
Purity adjustment defaults OFF; explicit `purity=true` examples below are experimental scenarios, not defaults.
Final audit classification: [FINAL_LOCAL_READINESS.md](../docs/FINAL_LOCAL_READINESS.md).

Local authentication: `/api/auth/signup`, `/login`, `/me`, `/logout` use a separate
ignored `auth.sqlite3`, never the market DB. Auth POSTs require an allowed Origin.
See [LOGIN_UI.md](../docs/LOGIN_UI.md) for cookies, hashing, settings and limits.

FastAPI research backend for the MCX gold futures dashboard. Requires
Python 3.11 or newer. The initial environment was created with Python 3.14.
The health endpoint, manual Bhavcopy CSV loader, normalization, fixed-expiry
diagnostics and settlement-based simulation/reporting are implemented. The HTTP
downloader is disabled/unused because MCX blocks scripts. Read-only APIs expose
metadata, overview, prices, data health and analytics; offline exports reuse
their response builders.

## Set up (PowerShell)

From the repository root:

```powershell
Set-Location backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Select a specific installed interpreter with `py -3.11` or `py -3.14` if needed.
If PowerShell blocks activation, allow scripts for this session and retry:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Edit `.env` to change settings. `pydantic-settings` reads `backend/.env`, and
environment variables take precedence. `CORS_ORIGINS` is a comma-separated list;
the default frontend origins are `http://localhost:5180` and `http://localhost:5173`.
Settings are cached; restart the server after changing `.env`.

Only the requested top-level packages are installed, along with their required
dependencies. `requirements.txt` pins the installed packages and dependencies.
Uvicorn uses its base install without optional extras.

Settings use `BaseSettings`, `SettingsConfigDict`, and `NoDecode` with a
comma-splitting validator, following the
[official pydantic-settings documentation](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).
The health test uses HTTPX's documented
[ASGI transport](https://www.python-httpx.org/advanced/transports/#asgi-transport)
with standard-library `asyncio`, avoiding the installed Starlette version's
deprecated HTTPX `TestClient` integration and any additional test libraries.

## Run (PowerShell)

From `backend`, with the virtual environment activated:

```powershell
uvicorn app.main:app --reload --port 8010
```

In another PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:8010/health
```

Expected JSON: `{"status":"ok","app":"Auraxis"}`. Stop the server with Ctrl+C.

## Verify and format (PowerShell)

From `backend`, with the virtual environment activated:

```powershell
python -m pytest
ruff check .
ruff format --check .
```

Apply formatting when needed:

```powershell
ruff format .
```

The cache contents and `.env` are ignored by Git; `data_cache/.gitkeep` is preserved.

## Load manual Bhavcopy CSVs (PowerShell)

Put files named `BhavCopyDateWise_DDMMYYYY.csv` in `backend/data_cache/raw_csv`.
From `backend`, with the virtual environment activated:

```powershell
python -m app.data.loader --dir data_cache/raw_csv
```

The loader reads local files only. It validates every row's date against the
filename before selecting configured `BHAVCOPY_SYMBOLS` futures. It stores all
expiries in SQLite `bhav`, keyed by `(symbol, expiry_date, trade_date)`, and
updates `data_health` by filename. Re-running updates existing keys without
duplicates. Rejected files do not modify `bhav`; previously loaded keys remain.
No continuous contract series or purity adjustment is created.

Relative SQLite paths and CLI directories resolve from `backend`. The default
database is `backend/auraxis.db`. Configuration in `app/core/config.py` includes
`lot_grams` and `quote_grams`; environment overrides `LOT_GRAMS` and `QUOTE_GRAMS`
use JSON dictionaries. Quote sizes are reserved for later normalization.

Volume text stays unchanged. The loader compares its numeric part times 1000
with lots times lot grams, logging differences without dropping rows. Zero-volume
rows retain their settlement prices and are marked `has_trade=False`.

CLI exit status is nonzero for rejected/error files or an empty input directory.
If the existing pytest cache is inaccessible on Windows, tests can run without it:

```powershell
python -m pytest -p no:cacheprovider
```

## Step 9A read-only API (PowerShell)

Start from the repository root using the existing environment:

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8010
```

In another terminal:

```powershell
Invoke-RestMethod 'http://localhost:8010/health'
Invoke-RestMethod 'http://localhost:8010/api/meta'
Invoke-RestMethod 'http://localhost:8010/api/overview?purity=true'
Invoke-RestMethod 'http://localhost:8010/api/prices?product=GOLDTEN&purity=true'
Invoke-RestMethod 'http://localhost:8010/api/data-health?min_volume_grams=2000&diagnostic_limit=20'
```

Omit `product` for all configured products. Set `purity=false` to disable purity
adjustment. Purity assumptions remain unverified. These are historical database
observations, identified by `data_as_of`; settlement is not an executable price.

Overview and prices choose the nearest traded contract on the global latest
stored date with finite positive prices and at least three calendar days to
expiry. Missing eligible references return `reference_available=false` and a
reason. Day changes compare that same expiry on the immediately previous database
session; unavailable changes are null. Prices contain fixed-expiry history,
including no-trade rows, without filling missing prices or stitching contracts.

An empty or absent database returns HTTP 200 with `data_available=false`, null
`data_as_of`, empty histories and unavailable references. Unexpected failures
return a generic HTTP 500. GET requests do not create files, tables or observations.
Nonfinite numbers become JSON null; dates use ISO format.

Data-health lists recorded file statuses and explicitly describes unavailable
diagnostics. Lists include total/returned counts and truncation flags; the limit
is 1?100. Free-form loader notes are withheld to protect private paths; recorded
ISO dates in notes are exposed without inferring their attribution. Thin volume
means stored volume strictly below the threshold, including zero volume. The
configuration default is `API_MIN_VOLUME_GRAMS=2000`. A successful file status
does not imply complete validation or verified contract specifications.

API tests use FastAPI TestClient with an isolated SQLite database. Local HTTP
verification responses are saved to `data_cache/api_foundation_verification.json`.

## Step 9B analytics endpoint examples (PowerShell)

Use the existing server on port 8010:

```powershell
Invoke-RestMethod 'http://localhost:8010/api/spreads?pair=GOLDTEN-GOLDPETAL&expiry=2026-10-30&window=10&min_periods=5&carry_adjusted=true&purity=true&min_volume_grams=2000&min_oi_grams=0'
Invoke-RestMethod 'http://localhost:8010/api/spreads?pair=GOLDM-GOLDTEN&carry_adjusted=true'
Invoke-RestMethod 'http://localhost:8010/api/spreads?pair=GOLDM-GOLDTEN&carry_adjusted=false'
Invoke-RestMethod 'http://localhost:8010/api/curve?product=GOLDTEN&date=2026-10-01&purity=true'
Invoke-RestMethod 'http://localhost:8010/api/rolldown?product=GOLDTEN&expiry=2026-10-30&start=2026-09-15&end=2026-10-01&purity=true'
Invoke-RestMethod 'http://localhost:8010/api/backtest?pair=GOLDTEN-GOLDPETAL&expiry=2026-10-30&window=10&min_periods=5&z_entry=1.0&z_exit=0.25&max_hold_sessions=5&expiry_buffer_calendar_days=3&min_volume_grams=2000&min_oi_grams=0&notional_per_leg=1000000&cost_bps_per_leg_per_side=5&purity=true'
```

For spreads/roll-down, omit `expiry` to receive separate fixed-expiry groups.
Spreads also accept ISO `start`/`end`, retaining earlier rolling warm-up history.
Spreads are A minus B; percentage statistics use B as denominator. Z is
unitless, percentile is 0?100, liquidity is grams and maturity is calendar days.
`expiry_b_used` is an ordered date list (actual expiry or lower/upper brackets);
`days_mismatch` has signed B-minus-A calendar-day distances in the same order.
GOLDM comparisons are analytics-only, with actual component liquidity reported
separately. Same-expiry structural eligibility does not guarantee market fills.

Curve `date` is optional (latest date for that product); an explicit date is never
substituted. Roll-down preserves invalid diagnostics. Its price changes use the
configured normalized rupee units, and its slope uses those units per calendar
day. Decomposition is a local linear, constant-shape approximation; residuals
are not proven mispricing or profit.

Backtest supports only GOLDTEN-GOLDPETAL, GOLDTEN-GOLDGUINEA and
GOLDGUINEA-GOLDPETAL. Expiry reports are independent. Rupee P&L, costs and equity,
signed fractional 10g quantities, session holding intervals, 0?1 win rates and
percentage returns against twice per-leg notional are labeled in the response.
Realized and marked results, stale marks, outstanding positions, pending orders
and blocked/cancelled orders remain visible. Cost sensitivity holds completed
trades fixed; closed-trade cost tolerance excludes outstanding positions and
is not whole-strategy break-even. Purity and settlement assumptions remain
unverified and idealized.

All responses include global `data_as_of`, the returned data window, normalization
configuration, units and applied options. Empty selections (including unavailable
expiries) return empty lists and an explanatory message; invalid requests return
422 and unexpected failures return a safe 500. No caching or data writes occur.

## Step 10 offline snapshots (PowerShell)

From the repository root, refresh manually downloaded CSVs with the existing
loader, then export. Neither export nor verification needs an HTTP server.

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
python -m app.data.loader --dir data_cache/raw_csv
python -m app.export_snapshots
python -c "from app.export_snapshots import DEFAULT_OUTPUT, verify_snapshot_set; m = verify_snapshot_set(DEFAULT_OUTPUT); print(len(m['files']), 'verified response files')"
```

The exporter reads one explicit SQLite transaction, calls the existing endpoint
builders directly and validates their Pydantic response models. It stages strict
JSON and publishes immutable `frontend/public/snapshots/versions/<version>/`
files before atomically replacing `frontend/public/snapshots/manifest.json`.
Failure preserves the previous manifest and its referenced files. Old versions
are retained so a reader holding an older manifest can still load its files;
there is no automatic cleanup, and output grows with repeated exports. Unrelated
public files are untouched.

The manifest contains schema version, UTC generation time, historical date/window,
relative file paths, checksums, exact query parameters and supported request keys.
Meta, overview, prices and data-health use endpoint defaults. Every configured
supported spread pair has purity on/off; GOLDM pairs also have carry on/off.
Latest curves and roll-down cover every supported product with purity on/off.
Default same-expiry backtests have purity on/off. All expiry groups, quality flags
and outstanding positions remain intact. No portfolio aggregation is performed.

Request keys are compact, sorted JSON objects containing `endpoint` and
`parameters`. Omitted parameters resolve to the actual endpoint defaults;
optional date/product/expiry filters become explicit JSON nulls. Booleans are
JSON true/false, dates are ISO YYYY-MM-DD strings and numeric parameters use their
validated endpoint types. Data-health's omitted volume threshold resolves to
its configured default. Use `canonical_parameters`/`request_key` to reproduce
the matching rules. Unknown parameters are rejected. A custom configuration
without an exact manifest key must be unavailable offline: never use a default
snapshot under custom labels. No frontend matching/client code is added here.

Snapshots are historical and do not auto-refresh. Purity assumptions remain
unverified; settlement is not executable. Empty results, zero trades, invalid
rows, open/unresolved positions and stale marks remain honest API responses.
The command verifies schemas, strict JSON and checksums and prints active output
sizes and whether the database file stayed unchanged.

The [15 October audit](../docs/AUDIT_2026-10-15.md) records official MCX
quote/lot/delivery sources, provisional comparison-basis questions and the
original-CSV reconciliation. Delivery purity is not by itself proof of a quoted
price multiplier; defaults remain unchanged.

Backtest supports optional `sizing_mode=integer_lots` (default `fractional`).
Integer mode rounds each leg down at entry, reports unused target notional and
net gram exposure, and charges costs on actual turnover. Both modes remain
idealized settlement simulations. Only default fractional mode is snapshotted.

```powershell
Invoke-RestMethod 'http://localhost:8010/api/backtest?pair=GOLDTEN-GOLDPETAL&sizing_mode=integer_lots'
```

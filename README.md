# Auraxis

[Project status report: implemented features, verification and next steps](docs/PROJECT_STATUS_REPORT.md) — updated 30 October 2026. See [fresh local acceptance and release handoff](docs/LOCAL_ACCEPTANCE_2026-10-30.md) for PASS / NOT TESTED results and remaining hosting requirements.

Account security: `/app/security` adds authenticator MFA, password changes and offline recovery codes; `/app/recover` resets using a saved code. Alerts can explicitly sync rules to an account. See [security/sync behavior and limits](docs/ACCOUNT_SECURITY_AND_SYNC.md). Email ownership verification and email delivery are not configured.

Guided walkthrough: `/app/demo` follows comparison → calculation → costs → saved research using actual results and one common expiry. See the [presenter script](docs/HACKATHON_DEMO.md) and [validation worksheet](docs/USER_VALIDATION.md). Deployment remains pending; [hosting preparation](docs/DEPLOYMENT.md) excludes market data and preserves existing local services.

Historical [Alerts](docs/ALERTS.md) are available at `/app/alerts`. See the [completion checklist](docs/REMAINING_WORK_CHECKLIST.md) and [contract-basis review](docs/CONTRACT_BASIS_REVIEW_2026-10-28.md) for verified work and external blockers.

Historical research dashboard for MCX gold futures: GOLDM, GOLDTEN,
GOLDGUINEA and GOLDPETAL. Compare quote-unit-normalized prices, inspect
fixed-expiry maturity differences and explore settlement-based simulations.
This is a local prototype, not a publicly deployed trading service.

## Screens and stack

- `/`: landing and historical reference chart.
- `/app`: overview.
- `/app/relative-value`: comparisons and optional maturity matching.
- `/app/term-structure`: expiry curves and approximate roll-down diagnostics.
- `/app/backtest`: same-expiry simulation, costs and position reports.
- `/app/data-health`: ingestion and row-quality diagnostics.
- `/app/calendar`: read-only Data Coverage calendar and dated/undated file diagnostics.
- `/app/methodology`: assumptions and limitations.
- `/login`: local signup/login; account menu provides logout.

Frontend: React, TypeScript, Vite, Recharts and Framer Motion.
Backend: FastAPI/Uvicorn, pandas, NumPy, SQLAlchemy/SQLite, httpx and
pydantic-settings. Tests use pytest and Node's test runner; lint uses Ruff
and ESLint. Versions are recorded in dependency manifests and the npm lockfile.

## Setup (Windows PowerShell)

Use Python 3.14 and Node 24, the locally verified versions (see
`frontend/.node-version`). Backend code targets Python 3.11+, but pinned
dependencies must also support the selected interpreter. Run commands on
separate lines. Start at the repository root; do not recreate existing environments.

```powershell
Set-Location backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Set-Location ..\frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Set-Location ..
```

Optional activation from `backend`: `.\.venv\Scripts\Activate.ps1`.
Backend `.env` defaults include `DATABASE_URL=sqlite:///./auraxis.db`,
`DATA_CACHE_DIR=./data_cache`, `AUTH_DATABASE_PATH=./auth.sqlite3`,
`AUTH_COOKIE_SECURE=false`, `AUTH_SESSION_HOURS=24`, and
`CORS_ORIGINS=http://localhost:5180,http://localhost:5173`.
Frontend `.env` uses `VITE_API_BASE_URL=http://localhost:8010`.
Only safe `.env.example` files belong in Git. Vite variables are public build
configuration, never secrets. Hosted HTTPS needs secure cookies and reviewed
domain/session configuration; local HTTP settings are not production settings.

## Authorized data and database setup

**Raw market CSVs, local SQLite databases and generated offline snapshots are
excluded. MCX redistribution permission has not been established.** Existing
CSV test fixtures are synthetic; the historical HTTP test fixture is a small
user-supplied illustrative response, not a bundled market dataset.

An authorized user must manually obtain permitted Bhavcopy CSVs from MCX.
The old HTTP downloader remains disabled/unused after scripts were blocked;
do not bypass the block. From the repository root:

```powershell
Set-Location backend
New-Item -ItemType Directory -Force data_cache\raw_csv
```

Place authorized `BhavCopyDateWise_DDMMYYYY.csv` files there, then run:

```powershell
.\.venv\Scripts\python.exe -m app.data.loader --dir data_cache/raw_csv
.\.venv\Scripts\python.exe -m app.export_snapshots
```

The loader creates `bhav` and `data_health` SQLite tables and idempotently
upserts by `(symbol, expiry_date, trade_date)`. It validates file dates and
retains four configured gold futures, including zero-volume rows. No separate
migration command is needed. An empty directory is not a successful import.
Auth creates a separate database when needed.

The exporter shares API response builders and publishes versioned files plus
a manifest under `frontend/public/snapshots/`. Only exact manifest configurations
work offline; custom settings do not silently receive defaults. Generate approved
snapshots before building when offline data is required. A fresh clone builds
the UI, but meaningful charts, simulations and offline fallback require authorized
data. No real dataset or generated snapshot set is bundled in the checkout.

## Run locally

Use separate terminals, each initially at the repository root. Reuse existing
services if ports are occupied; do not start duplicate servers.

Backend terminal:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Production-build preview terminal:

```powershell
Set-Location frontend
$env:VITE_API_BASE_URL = 'http://localhost:8010'
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173/`. Backend health: `http://localhost:8010/health`.
For development instead of preview, from `frontend`:

```powershell
npm run dev -- --host localhost --port 5180 --strictPort
```

Changing a Vite API URL requires rebuilding the production frontend.
Local checks do not establish public deployment or production readiness.
Hosting configuration is prepared only; public deployment and acceptance remain
pending. See [deployment notes](docs/DEPLOYMENT.md).

## Authentication

Create an account through `/login`; no seeded account/password is distributed.
Salted PBKDF2 password hashes and hashed opaque sessions are stored in the
ignored auth database. The frontend uses HTTP-only session cookies; auth POSTs
require an allowed Origin. See [auth setup and limits](docs/LOGIN_UI.md).
Research APIs and static snapshots remain public demo resources: login does
not protect private market datasets. Authenticator MFA, password changes and
saved-code recovery are implemented; email verification and email-reset delivery
are not configured. Cross-site hosting needs cookie/domain review.
Never commit authentication databases or sessions.

## Available checks

From the repository root, using existing environments:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check app tests
Set-Location ..\frontend
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs tests/particles.test.mjs tests/phase1.test.mjs tests/routes.test.mjs tests/coverage.test.mjs tests/workspaces.test.mjs tests/profile.test.mjs
```

Backend tests use isolated fixtures/databases, without live MCX requests.
Frontend client tests read generated local snapshots: an authorized snapshot
set is required and is excluded from Git. Without it that suite cannot run as
shipped. `node --test tests/particles.test.mjs` is independent of snapshots.
Browser audit scripts also need their local services/browser setup. Private
screenshots/traces referenced in historical audit docs are intentionally excluded.

## Research limitations

- Local data is historical, not live: 14 sessions, 2026-09-14 to 2026-10-01.
  Those market files are not distributed in a fresh clone.
- Source notes support quote quantities/delivery qualities, but complete
  cross-product quoted-price equivalence remains unverified. Purity adjustment
  defaults OFF; ON is experimental. Delivery fineness alone does not establish
  a valid cross-product price multiplier.
- GOLDM maturity matching interpolates other expiries for analytics only;
  it does not create an executable synthetic contract.
- Settlement prices and simulated fills are not executable market fills.
  Interpret sizing, costs, liquidity checks, stale marks and open/unresolved
  positions with each report's applied assumptions. Realized and marked P&L differ.
- The short sample does not establish profitability, guaranteed profit,
  proven arbitrage or portfolio performance.
- Offline fallback covers exact exports and transport outages, not arbitrary
  inputs, API validation failures or live market access.
- Public deployment, hosted security and public acceptance remain pending.

The existing [LICENSE](LICENSE) applies to project code; it does not establish
market-data redistribution permission. No new license is introduced.

## Phase 1 comparison explanations

Relative Value includes **Explain this comparison** and **View calculation**.
The API provides optional source/calculation traces from its existing spread
path; frontend explanations use validated applied results. Historical snapshots
without traces still work, with calculation details explicitly unavailable.
See [Phase 1 implementation and verification](docs/PHASE1_EXPLANATIONS.md)
for compatibility, local integration checks and the remaining browser checklist.

Data Coverage uses `/api/coverage` with an explicit product/date range, limited
to 31 inclusive days. Observed rows and zero-volume/no-trade flags are distinct
from missing or expected coverage. No authoritative expected-contract roster or
official holiday calendar is integrated. Exact monthly offline snapshots are
exported for months with observations or persisted dated ingestion records;
old snapshots remain usable, but do not acquire calendar data automatically.
See [Data Coverage implementation and acceptance report](docs/PHASE2_DATA_COVERAGE.md).

## Saved Research Workspace

Signed-in users can save the **loaded applied configuration** from Relative
Value, Term Structure and Backtest, then open, rename, edit plain-text notes or
delete it at `/app/research`. Unsubmitted Backtest drafts are excluded. Reopening
reloads/recalculates using available data; numerical results are not frozen.
Explicit unavailable dates/expiries are not replaced with defaults.

`WORKSPACE_DATABASE_PATH=./workspaces.sqlite3` configures a separate private
SQLite store (relative paths resolve inside backend). It initializes lazily on
authenticated workspace access. Keep it separate from market/auth databases and
outside public directories. It is ignored by Git and excluded from snapshots.
Private CRUD requires the backend and an existing cookie session; it has no
offline fallback. Public analytics remain available without sign-in.

For API/version limits, private backup precautions, actual verification and the
remaining browser checklist, see [Phase 3 report](docs/PHASE3_SAVED_RESEARCH.md).
An isolated **real local HTTP** check (temporary auth/workspace stores, existing
market database read-only) is available from backend:

```powershell
.\.venv\Scripts\python.exe scripts/verify_workspaces.py
```

## My Profile

Signed-in account menus on Landing and the dashboard link to `/app/profile`.
Users can view their registered email, edit their name, open My Research and
sign out. Names support Unicode and are trimmed, with 1–100 characters and no
control characters. Only the name is editable; account identity, sessions and
saved research are preserved.

New signups record their actual UTC creation timestamp. Legacy accounts without
creation evidence return `created_at: null` and show **Unavailable**; no dates
are inferred or backfilled. Login requirements are unchanged.
Private profile requests require the backend and never use offline snapshots.
See [Phase 4 implementation and verification](docs/PHASE4_MY_PROFILE.md).

# Auraxis project report and next steps

Prepared: 20 October 2026 (IST).

## 1. Current position

Auraxis is an implemented local research prototype for comparing MCX gold
futures. It has a React frontend, FastAPI backend, SQLite historical data,
file-based ingestion, analytics, simulation reports, local accounts and
verified offline snapshots. It is not a live trading terminal or a publicly
deployed website. Public deployment and public acceptance checks remain pending.

Current local data, checked directly against SQLite and `/api/meta`:

| Item | Current value |
| --- | --- |
| Products | GOLDM, GOLDTEN, GOLDGUINEA, GOLDPETAL |
| Stored observations | 336 rows |
| Historical window | 14 September through 1 October 2026 |
| Trading sessions | 14 |
| Historical data as of | 1 October 2026 |
| Offline response files | 44, plus their manifest |
| Manifest-referenced payload size | 2,989,705 bytes; excludes manifest/older versions |
| Public frontend/API URLs | Not assigned or verified |

These are historical observations, not current market prices.

## 2. Implemented website

| Page | Route | Implemented purpose |
| --- | --- | --- |
| Landing | `/` | Problem explanation, historical reference chart, research navigation and limitations |
| Overview | `/app` | Historical data summary and normalized reference-price presentation |
| Relative Value | `/app/relative-value` | Configured pair/expiry comparisons, gap diagnostics, rolling statistics, quality status and optional maturity matching |
| Term Structure | `/app/term-structure` | Product expiry curves and approximate roll-down diagnostics with separate expiry histories |
| Backtest | `/app/backtest` | Same-expiry settlement simulations, costs, sizing, applied settings, marked/realized results and outstanding positions |
| Data Health | `/app/data-health` | Ingestion status and data-quality diagnostics, including untraded/zero-volume observations |
| Methodology | `/app/methodology` | Formulas, assumptions, offline coverage and research limitations |
| Login/signup | `/login` | Real local account registration, login and session handling |

Calendar and Alerts routes exist as unfinished placeholders, not completed
calendar/alert systems. They should not be presented as implemented features.

Presentation work includes the dark/gold theme, gradient/star background,
crow mascot/animations, full-screen crow loading presentation, responsive
layouts, readable diagnostic labels, expandable technical details and
scrollable tables. Prior desktop/mobile-emulation checks are bounded evidence,
not exhaustive device/accessibility certification.

## 3. Backend and data work completed

- Python backend with FastAPI/Uvicorn, settings from `.env`, logging, CORS
  and a health endpoint. pandas/NumPy support calculations; SQLAlchemy/SQLite
  provide market-data access. Existing dependencies are pinned/recorded.
- Manual Bhavcopy CSV loader: file/date validation, padded-symbol cleanup,
  FUTCOM filtering and configured contract quantities. It preserves zero-volume
  rows, computes gram quantities and warns about volume-text inconsistencies.
- Idempotent market storage keyed by `(symbol, expiry_date, trade_date)` in
  `bhav`, with file-level ingestion results in `data_health`.
- The old HTTP downloader remains disabled/unused after MCX blocked scripted
  access. No block bypass or live download service is provided.
- Price normalization preserves original values and missing prices, converts
  quote units to Rs per 10 g, and supports a separate experimental purity step.
- Pair comparisons preserve individual expiry histories and quality flags.
  Optional GOLDM maturity matching interpolates comparison expiries; it is
  analytics-only, not an executable synthetic instrument or financing model.
- Term-structure and approximate roll-down calculations retain invalid/missing
  diagnostics rather than inventing complete histories.
- Same-expiry simulations/reporting include sizing modes, configured costs,
  execution assumptions, open/unresolved positions, stale marks and distinct
  realized versus marked P&L. Separate expiry reports are not portfolio results.
- Read-only research endpoints: `/api/meta`, `/api/overview`, `/api/prices`,
  `/api/data-health`, `/api/spreads`, `/api/curve`, `/api/rolldown`, `/api/backtest`.

## 4. Offline snapshots

The exporter calls shared API response builders directly without requiring an
HTTP server. It uses a consistent database view, strict serialization,
checksums, exact parameter identities and versioned publication with a manifest.

Coverage includes foundation responses, every configured supported spread pair
with its supported purity/matching combinations, product curves/roll-down and
default same-expiry backtest configurations. Expiry series/reports remain
separate. Only exact supported configurations can be served offline.

The frontend distinguishes API results from historical offline snapshots.
Unsupported custom settings must be unavailable offline; HTTP validation/server
errors must not silently become successful saved default results.

## 5. Accounts and latest login work

Local signup/login, logout and cookie sessions are implemented. Authentication
uses a separate ignored SQLite database, salted PBKDF2 password hashes, hashed
opaque session tokens, HTTP-only cookies, Origin checks and local attempt limits.
There are no distributed default credentials. Research APIs and static snapshots
remain public demo resources; login is not private-data authorization.

The latest local change sends successful login/signup to Landing (`/`) instead
of Overview. It also shows validation/server errors near the submit button.
Earlier investigation found open browser tabs still running old bundles.

Previously in this work session, a temporary account was used against the real
backend in an isolated browser context: signup, session check, logout and login
succeeded, with login reaching `/` and session checks returning HTTP 200. The
temporary account was removed. This does not prove the owner's specific account
credentials work; the owner should confirm their own login on the latest build.

Not implemented: email ownership verification, password recovery, MFA or an
account-deletion interface. Hosted cookie/domain behavior needs separate review.

## 6. Verification: what is established

### Checks performed for this report

- Backend `/health`: HTTP 200 with status `ok`.
- `/api/meta`: current historical window/products and purity defaults inspected.
- SQLite read-only count/date query: 336 rows, 14 sessions, dates shown above.
- Landing, login and the six main dashboard routes: HTTP 200 from local preview.
  This confirms route serving, not complete interactive rendering.
- All 44 manifest-referenced snapshot files: valid JSON without non-finite
  constants, exact recorded sizes and matching SHA-256 checksums.
- Git working state and remote branch HEAD checked.

### Earlier recorded checks, not rerun for this report

- Full backend suite: 178 tests passed.
- Frontend suite: 56 tests passed using local snapshots.
- Ruff lint and format checks passed.
- Frontend typecheck, ESLint and production build passed; these were also rerun
  for the latest login-feedback change.
- Five isolated authentication tests passed, and real browser login flow was
  checked as described above.
- Earlier browser audits covered selected desktop/mobile-emulated layouts,
  purity/matching controls, draft/applied backtest settings, sizing and offline
  failure/recovery cases. They do not establish every possible input/device.

Earlier backend runs reported non-failing Starlette/httpx deprecation and
Windows pytest-cache warnings. No dependency changes were made for this report.
No fresh full visual audit or public deployment test was performed for it.

## 7. GitHub and deployment status

Repository: https://github.com/WhiteGod0227/Auraxis (existing public repository).
Local committed HEAD and remote `main` currently match:
`2d9d1f7912d3dedbbb127e3a030d73cb51384f80`.

**Important:** `frontend/src/pages/LoginPage.tsx` has newer uncommitted local
changes. Those login redirect/feedback fixes are not yet uploaded to GitHub.
This report is also a new local document until explicitly committed/pushed.
No commit or push was performed while creating this report.

Excluded from upload: environments/secrets, dependency/build directories,
market/auth databases and sidecars, raw market CSVs, generated snapshot payloads,
private browser evidence and logs. Existing source/tests and safe examples remain.
An authorized dataset/snapshot set is required for meaningful fresh-clone charts,
simulations, offline fallback and the snapshot-dependent frontend client tests.

Cloudflare Pages frontend and Railway backend configuration/build files are
prepared. Accounts/projects, billing authorization, persistent storage, data
provisioning, actual domains, Linux-container verification and public acceptance
are outstanding. No hosting service or paid resource has been provisioned here.

## 8. Limitations that must remain explicit

1. Historical data is not live; the latest loaded date is 1 October 2026.
2. Fourteen sessions do not establish profitability or robust strategy validity.
3. Complete cross-product comparison-basis verification remains provisional.
   Delivery quality alone does not prove a quoted-price multiplier, and delivery
   locations differ. Purity is OFF by default; ON remains experimental.
4. Different maturities are not interchangeable contracts. Interpolation is a
   diagnostic assumption, not executable arbitrage.
5. Settlement-based fills are assumptions; liquidity, costs and selected sizing
   affect simulations. Fractional sizing is not an actual integer-lot order.
6. Marked P&L differs from realized P&L; open/unresolved/stale outcomes matter.
7. Offline snapshots cover only exact supported historical configurations.
8. Market-data redistribution permission is unresolved. Code licensing does
   not grant permission to publish MCX data or derived snapshot payloads.
9. Local HTTP success is not public availability, production security,
   exhaustive accessibility or public deployment verification.

## 9. What you should do next, in priority order

### A. Finish the local handover

1. Open `http://localhost:5173/login` on the latest build and confirm your own
   account signs in and opens Landing. If it fails, record the visible error,
   page and click sequence; never share your password or session cookie.
2. Run one short demo through Overview, Relative Value, Term Structure,
   Backtest, Data Health and Methodology. Check the historical date/source,
   purity OFF default and applied settings. Avoid new features/redesign for now.
3. Decide when to commit/push the reviewed local login fixes and this report.
   They are not currently in the remote revision. Do not upload private data.
4. Keep a private backup of market data and, if accounts matter, the auth
   database. Test restoring backups before relying on hosted storage.

### B. Resolve research/data prerequisites

5. Confirm permission for every dataset/snapshot you plan to share publicly.
   Until then, retain the Git exclusions and do not upload market payloads.
6. Verify quote-unit, fineness, delivery-location and expiry assumptions against
   applicable official contract specifications before claiming complete
   comparability. Keep experimental purity labels until resolved.
7. If stronger research conclusions are needed, obtain a longer authorized
   sample and validate without selecting parameters to manufacture good results.
   This is a future research task, not a claim about the current prototype.

### C. Deploy only when a public website is actually needed

8. Personally configure hosting accounts, MFA and any billing/usage limits.
   Confirm costs before authorizing resources; keep tokens out of chat/Git.
9. Use the prepared deployment notes to verify the Linux build, provision
   persistent private SQLite storage/backups and configure real HTTPS domains,
   exact CORS origins, frontend API URL and secure account cookies. Review the
   cross-site session limitation before choosing frontend/backend domains.
10. Publish only authorized data. Verify actual public URLs in incognito:
    routes/direct refresh, API/CORS, login/logout, missing data, invalid inputs,
    exact offline fallback, unsupported offline settings and API recovery.
11. Record the deployed revision/data date and remaining failures. Only after
    those checks should the website be described as publicly accessible.

Password recovery/email verification, stronger hosted abuse controls and broader
accessibility/device testing are future hardening work if ongoing users are
planned; they are not requirements to pretend the local demo is already production.

## 10. Operating commands

Reuse running services. If stopped, open separate PowerShell terminals at the
repository root; do not type commands into a terminal occupied by Vite.

Backend:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Frontend production-build preview:

```powershell
Set-Location frontend
$env:VITE_API_BASE_URL = 'http://localhost:8010'
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

After placing authorized CSVs in `backend/data_cache/raw_csv`, refresh from
`backend` with the actual implemented commands, then rebuild the frontend:

```powershell
.\.venv\Scripts\python.exe -m app.data.loader --dir data_cache/raw_csv
.\.venv\Scripts\python.exe -m app.export_snapshots
```

Full setup/check commands: [root README](../README.md).
Deployment package and caveats: [deployment notes](DEPLOYMENT.md). Those notes
were written before the GitHub upload; their older statements that no repository
had been pushed are historical and superseded by section 7 of this report.
Likewise, older login documentation naming `/app` as the success destination
is superseded by the current local Landing redirect.

This reporting task changed documentation only. It did not modify application
behavior, market data, dependencies, running services or remote repositories.

# Phase 2: Data Coverage Calendar

Date: 22 October 2026 (IST). Scope: Data Coverage only. Phase 1 explanation and
calculation interfaces remain. No Saved Research Workspace or My Profile work.

## Routes and implementation

- Existing Calendar route `/app/calendar` now renders Data Coverage and is linked
  in the dashboard navigation. The public research design is retained; login is
  not required to view coverage.
- New read-only `GET /api/coverage`: uses the existing request-scoped connection,
  query-only SQLite lifecycle, JSON sanitization and safe API error handler.
- New backend files: `app/api/coverage.py`, `app/api/coverage_schemas.py`,
  `tests/test_coverage.py`. Existing `app/main.py`, exporter and exporter tests
  were extended. Ingestion and analytics formula files were not changed here.
- Frontend additions: `components/CoverageCalendar.tsx`,
  `components/CoverageDetails.tsx`, `lib/coverage.ts`, `tests/coverage.test.mjs`
  and `scripts/verify-coverage-integration.mjs`.
- Existing Calendar page, dashboard shared state/navigation, API client,
  TypeScript types, response validators and targeted calendar styles were
  extended. Route/branding regression tests and the Phase 1 integration script
  now include the calendar. Existing uncommitted Phase 1 work was preserved.
- Root/frontend/backend README updates are limited to this feature and checks.

## Endpoint and bounded queries

```text
GET /api/coverage?start=2026-10-01&end=2026-10-31
GET /api/coverage?start=2026-10-01&end=2026-10-31&product=GOLDTEN
```

`start` and `end` are required ISO YYYY-MM-DD dates. `start <= end` and inclusive
range length must be 1–31 days. Cross-month ranges within that bound are valid
API requests, though the UI requests full months. Product is optional/null for
all configured gold products; otherwise it must be configured/supported. Invalid
products, dates and ranges return HTTP 422. No matching observations or an empty
database are valid HTTP 200 responses with explicit messages/counts, not errors.
Unexpected failures use the existing safe HTTP 500 response.

Configuration echoes the exact range/product. `data_as_of` and `data_window`
describe the global stored market dataset, not the selected month's latest row.
All calendar dates in the requested interval are returned, including dates with
zero observations. Those are calendar labels, not invented market rows.

Response includes monthly/range totals, each day's summary, product breakdown,
actual observed expiries/source flags, dated ingestion pages, and a separate
database-wide undated-ingestion page. Private paths, arbitrary filenames, raw
free-form notes, exception messages and credentials are withheld. Ingestion file
names are restricted to the recognized Bhavcopy basename or a neutral label.

## Count definitions and unavailable diagnostics

| Count                       | Definition                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Observations                | Stored rows for selected product(s) in the date/range                                                                |
| Distinct observed contracts | Distinct `(product, expiry_date)` keys in that date/range; not an expected roster                                    |
| No trade                    | Stored `has_trade` is false                                                                                          |
| Zero volume                 | Stored `volume_lots == 0`, independent of the trade flag                                                             |
| Thin volume                 | Finite stored `volume_grams` below the applied configured threshold, including zero-volume rows                      |
| Invalid settlement          | Stored close is missing, non-finite or non-positive                                                                  |
| Dated ingestion records     | Records with an actual persisted `data_health.trade_date` matching the day; file-wide, independent of product filter |
| Undated ingestion records   | Persisted trade date is null; kept separate across the whole database                                                |

Diagnostic categories overlap. Summing their counts is not a unique affected-row
total. No-trade settlements remain stored observations and do not become missing
rows or executable prices. The above flags are not comprehensive data validation.

The actual market database contains only `bhav` and `data_health`; no authoritative
expected-contract roster or official trading calendar exists. Expected coverage
is explicitly unavailable, with expected/missing contract counts null. Observed
expiries on other dates are not treated as expected contracts. Not loaded does
not mean holiday; weekends receive no exchange-holiday classification either.

An ingestion date is file-declared persisted metadata, not proof of accepted
market rows. Null dates are never inferred from filenames or notes. Only the
latest status per filename is retained by the existing loader, not a full event
history. Raw warning notes are not structured row-level volume-mismatch data.
Ingestion output is capped at 100 records per date and 100 undated records;
full counts and explicit truncation remain available. Observations are not
truncated within the bounded requested date range.

## Frontend behavior

Month navigation/picker and All Products/product filter use validated API results.
The initial month follows historical `data_as_of`; if no metadata date exists,
the current month is a navigation default, not an invented observation date.
Each date button has text labels, a complete accessible label/native tooltip and
selected state. Arrow keys, Home/End and visible focus support date navigation;
the calendar and detail tables scroll within their containers when necessary.

Month/product/date live in the existing dashboard layout state. Navigating among
dashboard pages retains that state. Reload/leaving the dashboard layout starts
a fresh UI session; no saved workspace is implied. Month/filter request changes
hide prior results immediately. Source/configuration/date identity is checked,
late responses cannot become the current resource, and date selection reads
details only from the current validated monthly response.

Empty database, valid empty month/product/date, loading, HTTP error, malformed
response and unsupported offline configuration have distinct messages. The
selected-date panel shows applied date/product, observed counts and actual
expiries. File-wide and undated diagnostics are explicitly scoped. Data source,
historical window and export generation time remain visible.

## Offline compatibility

Exporter adds full-month snapshots for months containing supported observations
or reliably persisted dated ingestion records. Each month includes All Products
plus every configured product, including honest empty product selections.
Undated records do not create or select a month. An entirely empty/undated-only
database has no basis for monthly coverage snapshots; API empty views still work.

Current set: 54 response files plus manifest: existing 44 plus 10 coverage
configurations for September/October 2026 × All Products/four products. Existing
endpoint keys/schema version and prior immutable version directories remain.
The updated client accepts legacy manifests with no coverage entries; existing
pages still work and calendar requests explicitly become unavailable offline.
Older cached frontend builds should be reloaded before using the new feature.

Keys contain explicit ISO start/end and typed product/null, resolving omitted
product to null. Months, products and subranges are never silently substituted.
Checksums, strict JSON, consistent reads and staged manifest-last publication
reuse the existing exporter. Snapshots remain local/Git-ignored and were not
published externally. Browser transport failure is simulated only in integration
checks; the actual backend remains running.

## Actual verification results

| Check                                                                                                  | Result                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete backend suite                                                                                 | PASS: 198 tests                                                                                                                                                             |
| Complete frontend suite                                                                                | PASS: 83 tests                                                                                                                                                              |
| Repository Ruff lint and formatting                                                                    | PASS                                                                                                                                                                        |
| Frontend ESLint, Prettier, typecheck, production build                                                 | PASS                                                                                                                                                                        |
| Isolated no-network coverage tests                                                                     | PASS: product/date/range validation; empty views; counts; overlapping flags; unavailable expected coverage; null-date safety; record limits; export keys and read-only hash |
| Actual HTTP vs read-only local SQL                                                                     | PASS: all 10 current month/product configurations, daily counts and dated/undated file counts                                                                               |
| Actual client -> API -> validator -> calendar/detail rendering                                         | PASS for 10 configurations; rendering is server-render testing, not a browser claim                                                                                         |
| Actual served offline responses/checksums vs live responses                                            | PASS for all 54 configurations; unsupported coverage month and invalid product remain errors                                                                                |
| Phase 1 and other research pages                                                                       | PASS: full tests, live API/offline equality and actual route initial rendering; no formula/default changes                                                                  |
| Authentication                                                                                         | PASS: existing isolated auth tests; live guest 401/CORS preflight. No live account mutation performed in this phase                                                         |
| Browser desktop/mobile, native keyboard focus, navigation retention and interactive RV/auth regression | NOT TESTED: no controllable browser session was available                                                                                                                   |

The previously reported browser-launch restriction was not bypassed. HTTP 200,
server rendering and helper tests are not presented as interactive UI evidence.
Existing non-failing Starlette/httpx deprecation and Windows pytest-cache
warnings remain. No new dependencies were installed.

## Real historical coverage

Global data window: 2026-09-14 through 2026-10-01, 14 sessions, 336 observations.

| Month, All Products | Observations | Distinct observed contracts | Loaded dates | No trade | Zero volume | Thin volume | Invalid settlement | Dated files |
| ------------------- | ------------ | --------------------------- | ------------ | -------- | ----------- | ----------- | ------------------ | ----------- |
| September 2026      | 312          | 24                          | 13           | 0        | 0           | 26          | 0                  | 13          |
| October 2026        | 24           | 24                          | 1            | 1        | 1           | 4           | 0                  | 1           |

Thin-volume threshold: 2,000 g. One undated ingestion record is shown separately
in either month; it is not assigned to a date or product. Individual-product
filters and all daily counts were checked directly against SQLite queries.
Distinct monthly keys are observed coverage, not an expected-contract estimate.

The market database SHA-256 remains
`74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f`.
The private auth database hash also remained unchanged. No ingestion or market/
account records were written by this phase.

## Reproduce (PowerShell)

Use existing environments and separate terminals; reuse running services.
From the repository root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check ..
.\.venv\Scripts\python.exe -m app.export_snapshots
Set-Location ..\frontend
npm run typecheck
npm run lint
.\node_modules\.bin\prettier.cmd --check src tests scripts *.json *.js *.ts *.html README.md
node --test tests/client.test.mjs tests/particles.test.mjs tests/phase1.test.mjs tests/routes.test.mjs tests/coverage.test.mjs
npm run build
node scripts/verify-phase1-integration.mjs
node scripts/verify-coverage-integration.mjs
```

The HTTP scripts need the local backend on 8010, preview on 5173 and current
authorized snapshots; they do not download market data. New isolated calendar
tests require no live server. Existing snapshot-dependent tests retain their
documented local-data prerequisite.

## Remaining manual acceptance

Open http://localhost:5173/app/calendar on the latest build:

1. Desktop/mobile: inspect month grid, controls, legends, details and scrolling.
2. September/October, All Products and each product: change month/filter/date;
   check selected details and explicit empty states. Test clearing invalid month.
3. Keyboard: Tab to date, arrows/Home/End, Enter/Space; verify visible focus and
   selected state, readable tooltips and access to detail tables.
4. Visit Relative Value and return: month/product/date must persist. Switch
   filters/months quickly; loading/errors must not present prior data as current.
5. Simulate an owned backend transport outage: supported month/product must
   show Offline snapshot; an unexported month must be unavailable. Restore/retry.
6. Relative Value: expand Explain/View calculation, toggle settings and check
   current/source-matched results. Login: use the current functional build and
   verify signup/login/landing/account state/logout without sharing credentials.

Browser acceptance and public deployment remain pending; no new production
verification is claimed. Existing historical-data, provisional comparison basis
and short-sample limitations remain. No commits, pushes, deployment, unrelated
redesign, next-phase features or PPT work were performed.

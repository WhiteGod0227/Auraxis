# Auraxis frontend — local research prototype

Current local status, limitations and commands: [LOCAL_RUN_HANDOVER.md](../docs/LOCAL_RUN_HANDOVER.md).
Final audit classification: [FINAL_LOCAL_READINESS.md](../docs/FINAL_LOCAL_READINESS.md).

Local accounts: `/login` provides signup/login, cookie sessions and dashboard
Sign out. First create an account with Sign up; this is not a Google/email-provider
login. See [LOGIN_UI.md](../docs/LOGIN_UI.md) for setup and limitations.

From the repository root, using the existing installed dependencies:

```powershell
Set-Location frontend
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev -- --port 5180 --host localhost --strictPort
```

Open `http://localhost:5180/app`. Set `VITE_API_BASE_URL=http://localhost:8010`
in `.env.local` and restart Vite if the backend address changes. The client
uses port 8010 when the variable is omitted. Use localhost for the frontend:
the backend CORS origins permit localhost:5180 and localhost:5173.

The `/` route is Landing. `/app` is Overview. Relative Value,
Term Structure, Backtest, Data Health and Methodology are implemented.
Legacy Calendar/Alerts routes are preserved as placeholders but are not in
navigation. The sidebar collapses on desktop and opens from the phone menu;
Escape closes mobile navigation. Visible focus, skip navigation and an
accessible history table complement the chart.

Overview independently requests meta, overview and prices. Every dataset shows
its source and historical date; API availability does not mean live market data.
References and day changes use returned values and comparison dates. Histories
are fixed-expiry, unsmoothed and unfilled; untraded observations break chart
lines, remain in the original data/table and are disclosed in the caption.
Upcoming days remaining use the historical API values, not today's date.

## Verified offline behavior

Serve the frontend through Vite or a static web server; do not open `index.html`
as a local file. The existing `public/snapshots/manifest.json` is included in
production builds along with its immutable version directories.

Only API transport failures/timeouts activate snapshot lookup. HTTP errors
(including 422/500), malformed JSON and schema failures stay errors. Manifest
schema version 1, safe versioned paths, exact applied parameters, payload shape,
SHA-256 checksum, file size and historical date are validated. Integrity checks
require a secure browser context (localhost or HTTPS).

Typed client requests use JSON booleans/numbers and ISO date strings. Omitted
options resolve to actual endpoint defaults and optional filters to null. The
manifest's parsed canonical keys are compared by exact fields/typed values;
Python `2000.0` and JavaScript `2000` represent the same numeric value. Data
health's omitted volume threshold resolves to the manifest's exported default.
Unknown parameters are rejected. Custom configurations without an exact entry
raise `ClientError` with kind `offline-unavailable`; default data is never
returned under custom labels. Requests support AbortSignal cancellation and
bounded timeouts, with no automatic retries. Retry buttons retry each dataset
independently; cancelled/superseded requests cannot replace newer results.

Snapshots contain Overview/prices defaults with purity OFF. Analytics exports
include exact supported pair/product and purity/maturity-matching variants
listed in the manifest. Custom filters, integer sizing and other settings
without an exact snapshot are unavailable offline.

To refresh snapshots after manually adding CSVs, from the repository root:

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
python -m app.data.loader --dir data_cache/raw_csv
python -m app.export_snapshots
```

## Checks (PowerShell, from frontend)

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
```

Client tests compile the actual TypeScript using the installed compiler and
exercise real snapshot files. No test-runner dependency is added. Browser
verification uses installed Chrome's DevTools protocol, not Playwright or a
browser download. With Vite on 5180, the backend on 8010 and Chrome's debug
port on 9222, run `node scripts/verify-browser.mjs`. It checks real API cards,
keyboard/mobile navigation and blocked-backend snapshot fallback without
stopping the backend. Screenshots/report go to the ignored
`node_modules/.cache/auraxis-verification/` directory.

To start a dedicated headless Chrome session for the optional browser checks:

```powershell
$auraxisBrowserProfile = Join-Path $env:TEMP ('Auraxis-Step11A-' + [guid]::NewGuid().ToString('N'))
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -WindowStyle Hidden -ArgumentList @('--headless=new', '--remote-debugging-port=9222', '--no-first-run', ('--user-data-dir="' + $auraxisBrowserProfile + '"'), 'about:blank')
node scripts/verify-browser.mjs
```

Purity assumptions remain unverified. Close/settlement is not an executable
price. This dashboard is for educational and research purposes only.


## Relative Value (Step 11B)

The six configured pairs use validated `/api/spreads` responses, with all expiry
histories fetched and the selected expiry chosen locally. Initial selection is
the earliest expiry at least three calendar days after historical `data_as_of`,
or the latest available expiry. A selected expiry is preserved when available.
Window 5-30 is an observation count; minimum periods remains 5. Applied response
parameters and units are displayed, including endpoint liquidity defaults.

Default window 10 supports the exported purity variants and GOLDM carry variants.
Other windows require the API; unavailable offline requests show an explicit
message and a restore-default-window action, without substituting default data.
GOLDM comparisons remain analytics only, including synthetic bracket prices.
Charts keep missing values as gaps and separate expiry histories. The historical
band is descriptive, and z references are not trade recommendations.

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
node scripts/verify-relative-value.mjs
```

The browser script uses the same dedicated Chrome debug session described above;
API unavailability is simulated by blocking browser requests, without stopping
backend processes. No other analytics pages are implemented in Step 11B.


## Term Structure (Phase 2)

Open `/app/term-structure`. Curve and full roll-down responses load independently
through the validated client. Product defaults to GOLDTEN and purity defaults
OFF (experimental when enabled). Latest curves omit the date parameter to match canonical saved snapshots.
Historical curve choices use dates present in the product's roll-down
observations (including previous dates) or returned curve points, not a calendar.
Product changes reset to its latest curve. Historical date changes do not change
the full roll-down history. An unsupported historical request offline stays
unavailable until **Show latest saved curve** explicitly resets the date control.

Curve x positions use numeric calendar days to expiry. Untraded/missing points
break the traded line; untraded finite prices have hollow markers and all rows
remain in the table. Roll-down expiry selection is local, defaults to the first
expiry at least three calendar days after historical data_as_of (latest expiry
otherwise), and preserves a selected expiry when available. Invalid latest rows
remain latest. API values are used directly; full-precision reconciliation is
only a diagnostic. Purity assumptions remain unverified.

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
node scripts/verify-term-structure.mjs
```

Browser checks use the dedicated installed-Chrome debug session on 9222 described
above, frontend 5180 and backend 8010. Screenshots and reports are saved under
ignored `node_modules/.cache/auraxis-verification/`. Browser request blocking
simulates offline and mixed sources without stopping the backend. This phase
does not implement other pages or change backend analytics.


## Backtest (Phase 3)

Open `/app/backtest`. Only the three supported same-expiry pairs are offered.
Draft controls do not issue requests until **Run simulation**. Displayed results
show their returned applied configuration independently of draft edits. Expiry
selection uses the shared historical-data rule and filters all-expiry reports
locally. Reports are never aggregated into portfolio results.

Default settings are the endpoint defaults: window 10, minimum periods 5,
entry z 1, exit z 0.25, max hold 5 sessions, expiry buffer 3 calendar days,
minimum volume 2000 g, minimum OI 0 g, notional per leg Rs 1000000, cost 5 bps
per leg per side, purity OFF (experimental when enabled). Exit z must be below entry z. Reset changes the
draft; submit to apply it. Offline **Load saved defaults** restores draft and
applied defaults for the submitted pair/purity, using its exact saved response.
Custom offline configurations stay unavailable rather than receiving defaults.

Gross/net P&L, drawdown, valuation quality, accounting categories and fixed-trade
cost sensitivity come directly from the report. Completed, open and unresolved
positions remain separate. Zero completed trades have unavailable win rate and
average holding. Cost sensitivity excludes outstanding positions and is not
whole-strategy break-even. Reference capital is both leg notionals, not margin
capital; no annualized or factor statistics are introduced.

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
node scripts/verify-backtest.mjs
```

The browser script uses installed Chrome's dedicated debug session on port 9222
with frontend 5180/backend 8010, as described above. Browser API blocking tests
offline behavior without stopping the backend. Desktop/mobile screenshots and
reports go to ignored `node_modules/.cache/auraxis-verification/`.


## Data Health and Methodology (Phase 4)

Open `/app/data-health` for default read-only health diagnostics and independently
loaded meta. No custom threshold is introduced. Recorded results are latest
statuses per filename, not physical-file counts or processing-attempt history.
Rejections mean error or date_mismatch. Zero-volume, no-trade and thin-volume
categories overlap and are not combined. Lists display API totals, returned
counts and truncation; local product/date controls filter only returned items.
Unavailable checks and withheld details stay explicitly unavailable.

`/app/methodology` describes the actual implemented normalization, preceding
finite rolling windows, ddof=1, half-credit percentile ties, maturity selection,
product-date roll-down, database-calendar execution, sizing and reporting.
Normalization and endpoint default values come from validated responses.
The validated manifest lists exact supported offline configurations and its UTC
export timestamp separately from historical data_as_of. Static explanations
remain readable without metadata. No external specification verification was
performed; purity remains unverified.

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
node scripts/verify-health-methodology.mjs
```

Browser checks use installed Chrome debug port 9222, frontend 5180 and backend
8010. Screenshots/reports go to ignored node_modules/.cache/auraxis-verification.
Browser blocking/interception tests offline and partial failures without stopping
services. Landing, Calendar and Alerts remain outside this phase.


## Landing page and demo navigation (Phase 5)

Open `/` for the research landing page, `/app` for Overview, and use the sidebar
**Auraxis home** link to return. All six dashboard pages are reachable from the
landing/dashboard navigation. Calendar and Alerts retain their old URLs with an
explicit unavailable page, and are not feature claims or navigation links.

The landing page independently loads meta, the existing fixed-expiry price
histories, both default GOLDM-GOLDTEN carry responses, and the default
GOLDTEN-GOLDPETAL backtest through the shared validated client. All expiry
selection is local. Maturity selection first chooses the latest common finite observation date with
a valid maturity-matching bracket, then the nearest unexpired eligible A expiry on that
date. If only an earlier date is eligible, observation date and dataset-through
date are both displayed explicitly. Unequal dates,
missing brackets, mismatched configurations or different A prices do not produce
a paired comparison. Maturity matching changes the actual response row, with
separate source labels; it does not simulate convergence.

Honest results use the dashboard's historical three-day expiry selection rule,
never the best-performing expiry. Charts reuse the existing implementation and
preserve missing/untraded gaps. Failures retain usable static content and CTAs.
Offline behavior keeps exact manifest matching. No external fonts/assets are used.

The Backtest exit-signal z lookup now matches an executed entry by position/order
ID and then a unique executed exit by pair, expiry, direction, signal/exit dates,
reason and order namespace. It does not substitute execution-date z; absent or
ambiguous matching values remain unavailable.

```powershell
npm run typecheck
npm run lint
npm run build
node --test tests/client.test.mjs
node scripts/verify-backtest.mjs
node scripts/verify-landing.mjs
```

Browser checks use the existing dedicated Chrome debug session on 9222, frontend
5180 and backend 8010. Screenshots/reports are under the ignored frontend
node_modules/.cache/auraxis-verification directory. API request blocking simulates
offline conditions without stopping services.

Phase 6 recording instructions and verified historical numbers are in
[DEMO_GUIDE.md](../DEMO_GUIDE.md). The production preview was verified on port
5173, which is already permitted by backend CORS. Page verification scripts
also accept `AURAXIS_UI_URL` to target that preview:

```powershell
$env:AURAXIS_UI_URL = 'http://localhost:5173'
node scripts/verify-phase6-preview.mjs
node scripts/verify-landing.mjs
node scripts/verify-relative-value.mjs
node scripts/verify-term-structure.mjs
node scripts/verify-backtest.mjs
node scripts/verify-health-methodology.mjs
```

These browser checks require a dedicated Chrome DevTools session on port 9222.
The older `verify-browser.mjs` foundation check imports development source modules
and is intended for the development server, not the production preview.

The Backtest sizing control offers default idealized fractional quantities or
optional integer lots rounded down independently at entry. Sizing changes are
draft changes until Run simulation; quantities, unused target notional and net
gram exposure are available in row details. Integer mode has no offline snapshot;
restore saved defaults returns to fractional mode. Comparison-basis warnings
remain visible. See [the audit](../docs/AUDIT_2026-10-15.md) for source evidence,
reconciliation, checks and remaining verification limits.

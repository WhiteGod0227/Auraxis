# Local acceptance — 27 October 2026

Scope: current Auraxis frontend/backend integration and local browser acceptance. Deployment, publishing, commits, purchases and PPT work were excluded.

The exercised functional flows passed their focused final checks. This is a bounded local acceptance result, not a guarantee that every possible input, device, concurrency pattern or future run is fault-free.

## Environment and preservation

- Dedicated Chrome 156, separate temporary profiles/private contexts, supported Chrome DevTools Protocol. No pre-existing browser automation connector was available. Browser automation used native key/mouse events for designated focus/tooltip checks and DOM/control events for other flows; it was not a person operating a physical device.
- Desktop 1440×1000; mobile emulation 390×844. All eleven implemented routes opened at both sizes: Landing, Overview, Relative Value, Term Structure, Backtest, Data Health, Methodology, Data Coverage, My Research, My Profile and Login. Signup was exercised separately.
- Isolated production preview 5181 and backend 8011. Market data was copied using SQLite backup from a read-only connection; auth/workspace storage and all accounts were disposable. No real account was used or changed.
- Original backend 8010 PID 16060 and preview 5173 PID 41504 were preserved. Final health was `{"status":"ok","app":"Auraxis"}`; preview returned HTTP 200. Only verification-owned servers and browser contexts/processes were closed.
- Real market, auth and workspace database SHA-256 values were unchanged.

Disposable auth/workspace databases and the market backup were removed after verification; ignored scripts/results/screenshots were retained.

## Final acceptance matrix

| Area                | Result | Actual coverage                                                                                                                                                                                                                                                                          |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes/layout       | PASS   | Eleven routes at both viewport sizes; expected headings; no measured page-wide horizontal overflow; screenshots inspected. Dense tables scroll locally. This is sampled visual evidence, not exhaustive pixel certification.                                                             |
| Authentication      | PASS   | UI signup and valid login reach Landing; invalid login, duplicate signup, malformed email and required fields produce errors; cookie session survives refresh; logout removes private state. Duplicate account response intentionally uses the generic “Try logging in instead” wording. |
| Profile             | PASS   | Display, Cancel, whitespace validation, Unicode Save, persisted refresh, keyboard focus restoration; injected profile outage hides private fields and Retry account recovers the existing cookie session. Account-created remains unavailable rather than fabricated.                    |
| Private ownership   | PASS   | Second disposable account has no first-account workspaces. Recent isolated HTTP checks also covered ownership, revision conflicts and private cache headers.                                                                                                                             |
| My Research         | PASS   | Empty state, Save/reopen comparison/term/backtest settings, title/notes edits, Delete Cancel and confirmation; absent saved expiry remains unavailable without default substitution.                                                                                                     |
| Save behavior       | PASS   | Successful Save/Escape focus; failed Save retains draft and supports retry; duplicate pending submission produces one HTTP mutation.                                                                                                                                                     |
| Navigation/keyboard | PASS   | Native Enter on shared header links; mobile menu Enter/Escape/Close and visible focus; Save disclosures and Profile editing; calendar ArrowRight/Enter selects the next date.                                                                                                            |
| Relative Value      | PASS   | Default purity OFF; ON shows experimental status; GOLDM–GOLDTEN November expiry matching OFF/ON changes the actual result. Page return preserves selected controls and the associated result. Explanation/calculation disclosures open and show actual applied results.                  |
| Landing comparison  | PASS   | Matching buttons update the displayed GOLDM–GOLDTEN comparison.                                                                                                                                                                                                                          |
| Term Structure      | PASS   | All four products; latest and 30 September curves; contract selectors and returned roll-down rows; GOLDTEN October roll-down selection.                                                                                                                                                  |
| Backtest            | PASS   | Draft changes show Previous run; Run applies integer sizing; invalid negative numeric draft cannot replace the previous applied result; Reset/Run recovers defaults. Realized, marked, open and unresolved categories remain distinct.                                                   |
| Data Health         | PASS   | Product/date-order controls operate on returned diagnostic rows without changing global counts.                                                                                                                                                                                          |
| Coverage Calendar   | PASS   | Month/product changes load the selected range; missing days remain Not loaded rather than holidays; native day navigation works.                                                                                                                                                         |
| Chart tooltips      | PASS   | Eight chart instances at desktop/mobile widths: Landing and Overview reference history; Relative Value spread/z; Term Structure curve/roll-down; Backtest P&L/cost. Native mouse hover was used; mobile tooltip bounds remained inside the viewport in focused checks.                   |
| Loading/failure     | PASS   | Delayed comparison hides old result and disables Save. Injected HTTP 503 shows error; Retry restores results. Profile and Save have separate fault/recovery checks.                                                                                                                      |
| Offline/recovery    | PASS   | Supported public analytics use explicit offline provenance. Unsupported custom window remains unavailable, without silently returning default results. All six public analytics routes sampled offline and returned to connected results. Private Profile never used a public snapshot.  |
| Methodology         | PASS   | Technical disclosures and four existing MCX reference links remain accessible. Their presence is not fresh external contract verification.                                                                                                                                               |
| Runtime             | PASS   | No application runtime exceptions recorded in the completed browser runs. Deliberately blocked/intercepted requests are expected network failures, not evidence of an unhandled application exception.                                                                                   |

## Automated and actual HTTP evidence

The immediately preceding checks in this same audit were retained because this browser extension changed no application source:

- Backend pytest: **234 passed**; Ruff lint and format: **PASS**. Existing Starlette/httpx deprecation warning remains non-fatal.
- Frontend suite: **108 passed**; ESLint, TypeScript and production build: **PASS**.
- Local live/offline response equality: meta, overview, prices, data health, 18 spread configurations, eight curves, eight roll-downs, six backtests and ten coverage exports.
- **54 snapshot schemas/checksums valid and unchanged**; unsupported offline configurations and HTTP 422 behavior checked.
- Isolated real HTTP signup/session, Profile update, workspace CRUD, ownership/conflicts and logout passed; real stores were unchanged.
- Verification script formatting and Git whitespace checks passed. The only source-script correction was changing the stale expected UI label `Backend-recorded inputs` to the current `Inputs for` label; calculation/data assertions remain in place.

No application code, API behavior, analytics, market data or snapshot payload was changed in this acceptance extension.

## Focused rechecks and harness limitations

Raw browser runs include failed **harness assertions** and are not represented as a single all-green raw test suite. Focused rechecks covered the corresponding actual flows before the matrix above was marked PASS:

- Wait for new pair expiry options and full-page loading state before selecting a contract.
- Probe actual visible mobile chart coordinates instead of assuming the first hover coordinate hits a finite observation.
- Compare native option `.value` properties rather than assuming every option has an explicit HTML value attribute.
- Return booleans instead of DOM nodes from CDP assertions; avoid DOM serialization errors.
- Wait for asynchronous Save focus restoration before Escape and subsequent Save actions; rerun dependent rename/delete checks.
- Retain test credentials outside the page across reloads; use isolated fixture setup for account-dependent fault checks.
- Assert current calendar copy, generic duplicate-account text and the actual Retry account recovery path. Populate the password when isolating invalid-email validation so another invalid field does not replace the tested message.

One combined UI signup fixture timed out before creating an account. Other fresh UI signup runs passed; account-dependent checks were rerun with a controlled disposable fixture. The exact cause of that one setup timeout was not diagnosed. It is not claimed to prove an application signup defect or long-running reliability.

Local raw evidence, screenshots and harnesses remain under ignored `backend/.tmp/full-20261027/`; synthetic account screenshots were not published. Raw failed attempts are retained alongside focused successful rechecks. Screenshots sample tops of pages and hovered charts; physical-device appearance is not certified.

## Remaining limitations

- Deployment was deliberately **NOT TESTED / NOT PERFORMED**.
- Physical phones, Safari/Firefox/other browsers, assistive-technology certification, penetration testing and sustained load/soak testing were **NOT TESTED**. These require a separately scoped audit; no “everything is production verified” claim is made.
- Some headless captures show intermittent text raster/masking artifacts around animated/glass areas. Measured page/text bounds and focused header captures passed; a persistent user-visible clipping defect was not established. Native-device visual confirmation remains advisable.
- The original unexpected **SIGINT sender remains UNRESOLVED**. No unexpected test-server shutdown was observed; intentional cleanup signals only stopped verification-owned services. Browser acceptance does not fix or explain the old SIGINT.
- Historical 14-session data, unverified experimental purity, approximate maturity matching, settlement-fill assumptions and short-sample limitations remain. No profitability or complete comparison-basis verification claim is made.

Main local website remains <http://localhost:5173/> with backend <http://localhost:8010/health>.

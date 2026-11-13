# Final local browser acceptance

Update, 24 October 2026: a fresh dedicated-Chrome pass against an isolated
production preview is complete. See the
[current feature/browser report](FEATURE_CONNECTION_CHECK_2026-10-24.md#completed-browser-acceptance)
for PASS/NOT TESTED results, screenshots and cleanup evidence. The following
22 October report is retained as dated history. The original SIGINT cause remains
unresolved.

22 October 2026. This supersedes the earlier browser-unavailable report.
**Local browser acceptance passed.** The previously pending checks are now complete; the older SIGINT cause remains separately unresolved.

## Environment and isolation

- Chrome **155.0.8059.85**, native DevTools on **127.0.0.1:9222**.
  Dedicated temporary profile confirmed by process inspection. Created a fresh
  private CDP context and a verification-owned page; no unrelated targets accessed.
- Frontend **http://localhost:5181**, Vite 8.3.4 **development server**, API base
  **http://localhost:8011**. Initial isolated Uvicorn PID **47396**; remaining-check run PID **45480**. Loopback HTTP cookie
  configuration and CORS restricted to the test frontend.
- Desktop **1440 × 1000**, mobile emulation **390 × 844**, DPR 1.
  Mobile emulation is not a physical-device test.
- Market database copied via SQLite backup from a read-only source connection;
  disposable auth/workspace stores and synthetic accounts used throughout.
- Actual live React forms and browser requests were exercised through CDP DOM
  activation, control events and native text insertion. The follow-up enabled supported CDP focus emulation on the owned page, resolving its hidden/unfocused input state. Native key events were then observed with isTrusted=true. No security settings were disabled; DOM activation is not presented as native-keyboard evidence.
- Production build passed separately. This is not production/hosted acceptance.

## Current browser results

Each PASS applies to the exact observations described, not every possible variation.

| Flow                                 | Status | Evidence                                                                                                                                                                                                                      |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup/login → Landing               | PASS   | Synthetic signup and valid login arrive at /; signed-in account menu visible, including after opening mobile Menu                                                                                                             |
| Invalid credentials                  | PASS   | Remains on /login with “Email or password is incorrect.”                                                                                                                                                                      |
| Session refresh/logout               | PASS   | Direct Profile reload retains session; logout removes private workspace titles and protected Profile shows sign-in state                                                                                                      |
| Account isolation                    | PASS   | Another synthetic account sees zero workspaces and none of the first account's titles                                                                                                                                         |
| Profile display                      | PASS   | Current name, registered email, account-created Unavailable with honest explanation                                                                                                                                           |
| Profile Cancel/Save                  | PASS   | Cancel retains confirmed name; Unicode Save persists after refresh; a further complete update/logout/login sequence confirmed persisted updated name                                                                          |
| Shared account name                  | PASS   | Updated name visible in Landing/dashboard menus; desktop screenshots show the synthetic name                                                                                                                                  |
| Profile validation                   | PASS   | Blank name produces linked “Name must contain 1–100 characters.”; aria-invalid=true and error/help IDs                                                                                                                        |
| Failed Profile save                  | PASS   | Browser-blocked Profile endpoint shows explicit error, previous confirmed name retained, no false success                                                                                                                     |
| Save/reopen three research types     | PASS   | RV, Term Structure and Backtest created through forms and reopened from My Research                                                                                                                                           |
| Restored RV controls                 | PASS   | GOLDM-GOLDTEN, A expiry 2026-11-05, window 10, purity true and matching false restored                                                                                                                                        |
| Restored curve controls              | PASS   | GOLDTEN, explicit 2026-09-14 and 2026-10-30 selections restored; actual curve query includes explicit date, roll-down retains full history                                                                                    |
| Restored Backtest controls           | PASS   | Integer lots, GOLDTEN-GOLDPETAL, 2026-10-30 restored; applied summary and request agree                                                                                                                                       |
| Rename/notes/delete                  | PASS   | Rename and plain-text notes containing HTML-like text persist without HTML injection; delete cancellation retains workspace, confirmed deletion removes it                                                                    |
| Saved unavailable selection          | PASS   | A disposable saved Backtest explicitly selecting absent expiry 2099-12-30 opens as Unavailable, with no default report substituted and Save disabled; no real market data was changed                                         |
| Saved zero/null round trip           | PASS   | Browser save/reopen preserves exit=0, costs=0, volume=0, OI=0 and purity=false. Stored expiry filter is null and omitted from the actual request; a latest/null selection fixture restores latest mode without changing zeros |
| Explain/Calculation                  | PASS   | Expanded panels match selected pair, expiry, date and source. Backend trace A=149436, B=150020; UI final A/B, gap -584 and percentage -0.39 agree                                                                             |
| Purity/maturity toggles              | PASS   | Purity initially OFF with quote-size basis; ON visibly experimental. GOLDM matching toggles update actual requests/summary and retain Analytics only                                                                          |
| GOLDM comparison                     | PASS   | Purity ON, GOLDM-GOLDTEN A expiry 2026-11-05: unmatched gap ₹218.22 and matching effect -₹270.58 per 10 g; historical analytics, not fills                                                                                    |
| Rapid selections                     | PASS   | Delayed window-5 response followed by window 6 leaves controls/explanation at window 6 after the older response arrives; test fetch wrapper removed                                                                           |
| Coverage controls/retention          | PASS   | Month, product and date controls checked; month/product retained across in-app page navigation                                                                                                                                |
| Coverage honesty                     | PASS   | October shows 24 observations/contracts, one no-trade/zero-volume and four thin-volume flags; zero-volume GOLDGUINEA March contract remains. Empty 02 Oct is Not loaded, not a holiday; expected coverage unavailable         |
| Backtest draft/applied               | PASS   | Integer selection displays Previous run while fractional results remain applied; Run simulation removes warning, sends integer_lots and updates applied summary                                                               |
| Backtest outcomes                    | PASS   | Default October: 0 completed, 1 open, 0 unresolved; realized ₹0, marked net -₹991.70. Open-position table and honest empty unresolved section remain                                                                          |
| Supported offline research           | PASS   | Browser-scoped blocking of 8011 yields supported Overview/RV data labelled Offline snapshot                                                                                                                                   |
| Unsupported offline settings         | PASS   | Window 11 yields unavailable offline; old gap summary disappears rather than being relabelled                                                                                                                                 |
| Private outage/recovery              | PASS   | Offline Profile shows account-server/retry state, no previous private name or public snapshot fallback; unblocking/reloading recovers confirmed profile                                                                       |
| Dedicated HTTP-503/loading scenarios | PASS   | Held browser requests show loading explanation, old gap hidden and Save disabled. HTTP 503 shows a clear error/retry and no old result; removing interception and Retry produces HTTP 200 for the selected window             |
| Runtime exceptions                   | PASS   | Runtime.exceptionThrown collection empty at inspected checkpoint; intentional blocked-network failures expected. Not a claim that every console warning category was captured                                                 |

The long final name-update/logout/login browser script completed successfully;
its sanitized result was collected before stopping the owned harness.

## Pages, layout and keyboard

All seven research pages opened directly at both viewports: Landing /,
Overview /app, Relative Value /app/relative-value, Term Structure
/app/term-structure, Backtest /app/backtest, Data Health /app/data-health,
Methodology /app/methodology. Expected headings rendered; **no page-wide
horizontal overflow** was measured on any of the seven.

Their desktop/mobile screenshots were visually inspected. Sampled below-fold
comparison/curve charts, expanded explanation and open-position tables were also
inspected. A 1305 px calculation table stays inside a 320 px mobile wrapper with
overflow-x:auto; position tables similarly scroll locally. No sampled layout
overlap was observed. This is sampled visual evidence, not exhaustive pixel coverage.

**PASS:** native Enter opens Profile edit and focuses its input; Tab reaches Save,
Shift+Tab returns to the input, Space activates Cancel, and Save/Cancel return
visible focus to Edit name. Native events were recorded with isTrusted=true.
Focus outlines are gold, solid 2px with 4px offset. The earlier calendar key
checks remain valid and were not repeated.

**PASS:** dashboard menu opens with Enter/Space, focuses its first link and closes
with Escape or its Close navigation button, returning focus to the toggle. Landing
mobile Menu opens with Space; Tab reaches Problem and Escape returns to Menu.
Research delete confirmation follows Delete -> Confirm delete -> Cancel with Tab;
Space cancels and now returns focus to Delete. This is an inline group, not a
modal dialog, so no modal focus trap is advertised.

**PASS:** trusted mouse hover displayed tooltips on all eight chart instances:
Landing and Overview reference prices; spread and z-score; expiry curve and
roll-down; P&L and cost sensitivity. Desktop screenshots were visually inspected.
After the narrow-screen fix, all eight tooltip rectangles stayed fully inside the
390 x 844 emulated viewport. Curve bounds changed from right=405.08 (clipped)
to right=339, with all text retained and wrapped. No physical-device testing or
exhaustive accessibility certification is implied.

## Sanitized screenshots

**29 PNGs** in [evidence/final-browser-acceptance/](evidence/final-browser-acceptance/):
The original 18 captures are retained, plus 11 follow-up captures for hover tooltips, mobile tooltip containment and keyboard focus. The follow-up includes the synthetic research list; no private Profile/email/input screen was captured.
They contain public historical results, synthetic display names and disposable research titles. Private
Profile/email/input screens were not copied into this evidence folder; no real
accounts, passwords, cookies, session tokens or local paths appear in the captures.

Examples:
[Overview desktop](evidence/final-browser-acceptance/overview-desktop.png),
[Relative Value mobile](evidence/final-browser-acceptance/relative-value-mobile.png),
[Open positions mobile](evidence/final-browser-acceptance/backtest-chart-mobile.png).
Despite its filename, backtest-chart-mobile.png shows the open-position table.

## Final-state checks and retained evidence

| Check                        | Result                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Full backend pytest          | **234 passed**, 48.82 seconds in the preceding acceptance run; retained because no backend code changed |
| Repository Ruff lint/format  | Prior PASS retained; no Python changed                                                                  |
| Full frontend suite          | **105 passed**, zero failures/skips on the final focus/CSS changes (2.668 seconds)                      |
| TypeScript, ESLint, Prettier | PASS                                                                                                    |
| Production build             | PASS on final state; Vite 8.3.4, 655 modules, 917 ms                                                    |
| Existing snapshots           | Prior verification of all **54** retained; no snapshot files changed or regenerated                     |
| Real database hashes         | PASS; market/auth/workspace SHA-256 unchanged from this run's baseline                                  |

Existing Starlette/httpx deprecation and Windows pytest-cache warnings remain
non-fatal. Used the existing commands in
[Phase 4](PHASE4_MY_PROFILE.md#verification-commands), Frontend checks were rerun after the final CSS fix; earlier passed backend checks were not repeated. Documentation formatting and git diff --check were checked separately afterward.

## Changes, cleanup and unresolved issues

Three reproducible **FAIL** results were found and fixed within the requested
scope. Each now has a **PASS** recheck; no local checklist failure remains open:

| Defect                                        | Minimal fix                                                             | Recheck                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mobile Close navigation lost focus to body    | Reuse existing closeNavigation handler                                  | PASS: native Enter close returns visible focus to menu toggle; Escape path still passes |
| Delete-confirmation Cancel lost focus to body | Keep a ref to Delete and focus it after cancellation                    | PASS: native Enter/Tab/Space cancels and restores gold focus ring                       |
| Mobile curve tooltip clipped outside viewport | Bound narrow-screen tooltip width, wrap text within the existing styles | PASS: all eight mobile tooltip instances remain within viewport; values unchanged       |

Application files changed in this follow-up:

- frontend/src/layouts/AppLayout.tsx
- frontend/src/pages/ResearchPage.tsx
- frontend/src/styles/index.css

Also updated this report and added the follow-up screenshots. The ignored
remaining.mjs CDP harness and disposable stores remain under backend/.tmp/;
these are local verification artifacts, not uploadable project data. Existing
uncommitted work was preserved. No features, calculations, API schemas,
simulation defaults, real account data or market data were changed.

Disposed only the owned private browser context and stopped only its Node harness
and test services. **8011/5181 are closed**. User preview **5173 remains PID 39480**;
8010 was neither started nor stopped. Normal Chrome and the manually opened
dedicated browser were not closed. No broad process termination, installs,
commits, pushes, paid services, deployment or PPT work occurred.

## SIGINT: separate unresolved operational issue

Earlier unexpected SIGINT sender remains **UNRESOLVED**. User action is not assumed.
The remaining-check backend (PID 45480) stayed healthy throughout acceptance and
was intentionally stopped only during owned-session cleanup. Its signal_received
and shutdown log entries correspond to that deliberate cleanup, not a new
unexpected exit. Therefore SIGINT did not block this browser session, but browser
acceptance does not establish long-running service stability or fix the old issue.
See [shutdown investigation](BACKEND_SHUTDOWN_INVESTIGATION_2026-10-22.md).

## Remaining scope and verdict

No requested pending local-browser scenario remains blocked or NOT TESTED.
No further manual browser acceptance procedure is needed for this checklist.
Normal Chrome and the manually opened dedicated Chrome remain open; only the
owned private context was disposed. Existing preview 5173 remains PID 39480;
8011/5181 were confirmed closed and real market/auth/workspace hashes unchanged.

Public deployment remains pending and was outside scope. Historical 14-session
data, unverified experimental purity, analytics-only maturity matching,
settlement-fill assumptions and short-sample limitations remain applicable.
No public accessibility, production verification or SIGINT-resolution claim is made.

**Local browser acceptance passed** for the requested checklist and recorded
local configurations. The earlier SIGINT cause remains unresolved separately.

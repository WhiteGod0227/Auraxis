# Frontend/backend feature connection check

24 October 2026, IST. **PASS: exercised local frontend/backend flows and the
remaining browser acceptance checks.** The dedicated Chrome debug connection
became available; the browser results below replace the earlier connection blocker.
This is local acceptance, not public deployment verification.

## Service status

Initially neither the frontend nor backend was listening. Started the existing
production-preview script on **http://localhost:5173/** and the existing backend
launcher on **http://localhost:8010**. Final checks: preview HTTP 200, backend
health status ok. They remain running (preview PID 8148, backend PID 43312).
No duplicate servers or unrelated processes were stopped.

An isolated backend on 8011 used disposable auth/workspace files and a read-only
SQLite backup of the real market database. Its frontend was an actual production
build on 5181, built into ignored cache storage with API base 8011. Those two
verification-owned services were stopped afterward; main services stayed running.

## Feature results

The following table preserves the earlier live client/API and automated evidence.
Fresh browser interactions and rendering are recorded separately below.

| Feature                         | Backend connection           | Current evidence                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing                         | PASS                         | Its meta, price, comparison and backtest APIs validate through the real frontend client; main route/assets serve successfully                                                                                     |
| Overview/prices                 | PASS                         | Both purity modes, all four product filters and unfiltered prices validated; real API source required                                                                                                             |
| Relative Value                  | PASS                         | All six supported pairs, purity OFF/ON, matching OFF/ON: 24 live configurations validated against frontend schemas and applied-setting checks                                                                     |
| Explain / Calculation Breakdown | PASS, automated/API evidence | Live comparison responses include validated calculation traces; the full frontend explanation/component regression suite passed. Not a fresh visual panel check                                                   |
| Term Structure                  | PASS                         | All four products, both purity modes, curve and roll-down; an explicit historical curve date also validates                                                                                                       |
| Backtest                        | PASS                         | All three same-expiry pairs, both purity modes and fractional/integer-lot sizing validate through the real frontend client                                                                                        |
| Data Health                     | PASS                         | Actual health response validates; no import or market-data changes performed                                                                                                                                      |
| Data Coverage Calendar          | PASS                         | All-products/four product filters and empty November range validate; invalid ranges rejected                                                                                                                      |
| Methodology/limitations         | PASS, source/API evidence    | Route served; supporting metadata/comparison/backtest responses and snapshot catalogue validated. Explanatory content itself is frontend content, not a separate calculation service                              |
| Signup/login/logout             | PASS, isolated live HTTP     | Actual frontend auth client performed signup, invalid/valid login, session parsing and logout against the disposable backend                                                                                      |
| My Profile                      | PASS, isolated live HTTP     | Actual frontend Profile parser/update client; Unicode name update, shared session name, persistence after login again and protected reads after logout                                                            |
| Saved Research                  | PASS, isolated live HTTP     | Actual frontend applied-config builders and workspace client: all three types create/get/update/delete; exact configuration round trips, stale-revision conflict, two-user ownership isolation                    |
| Offline snapshots               | PASS                         | Actual frontend fallback client loaded and validated nine supported endpoint snapshots over HTTP; source explicitly Offline snapshot. Unsupported custom window rejected instead of returning relabelled defaults |
| Alerts                          | NOT IMPLEMENTED              | /app/alerts intentionally renders UnfinishedPage. There is no implemented alerts backend or working alerting feature                                                                                              |

Profile creation date remains Unavailable because the existing auth schema did
not record it. Password recovery, email changes, MFA and related account features
are outside the implemented scope; they were not invented or advertised as tested.

## Checks actually performed

- **90 connection cases, 90 PASS:** 73 main public API/configuration cases,
  nine isolated public cases, four invalid-input rejections, two credentialed CORS
  checks, and both compiled frontend API-base URLs. Real source api.ts/schemas.ts
  were executed with the installed TypeScript compiler; this is stronger than
  checking status 200 alone, but is still not browser interaction.
- **Eight private workflow groups PASS:** executed the actual frontend auth,
  profile, workspace clients, validators and applied-configuration builders over
  real HTTP to disposable storage. Test-only Node transport supplied its cookie
  jar and Origin; browser cookie/CORS enforcement is not inferred from Node.
- **10 offline checks PASS:** supported meta, overview, prices, health, spreads,
  curve, roll-down, backtest and coverage; unsupported custom settings rejected.
  API failure was simulated in the test fetcher without stopping main services.
- **234 backend tests PASS**, 46.13 seconds; repository Ruff lint and formatting
  pass, 68 files formatted. Existing Starlette/httpx and Windows cache warnings
  remain non-fatal.
- **105 frontend tests PASS**, zero failures/skips; TypeScript, ESLint, Prettier
  and normal production build pass (Vite 8.3.4, 655 modules, 3.69 seconds).
- Existing isolated HTTP verifier passed signup/session, three configurations,
  CRUD, revisions, ownership, Profile update and logout; all **54** existing
  snapshot schemas/checksums verified without regeneration.
- **12 SPA URLs and 407 existing built assets** served HTTP 200. This includes
  old assets retained in dist and the deliberately unfinished Alerts route;
  neither count proves all those URLs are implemented UI features.
- Main market/auth/workspace byte hashes match this audit's pre-test baseline.

Sanitized machine-readable evidence:
[public connections](evidence/feature-check-2026-10-24/connections.json),
[private client workflows](evidence/feature-check-2026-10-24/private-workflows.json),
[offline checks](evidence/feature-check-2026-10-24/offline.json).
No credentials, cookies, tokens, raw market-data payloads or personal account
details are included. Temporary test helpers/stores remain in ignored cache/.tmp
locations and must not be uploaded.

## Completed browser acceptance

Used the user's dedicated Chrome **156.0.8078.47**, debug connection
**127.0.0.1:9222**, in a newly owned private context. No unrelated browser targets
were accessed. The test frontend was a **production build** at localhost:5181,
connected to the isolated backend at localhost:8011. Disposable accounts,
auth/workspace stores and a SQLite market backup were used. Existing application
services on 8010/5173 and real account/database records were untouched.

The browser exercised actual React controls, forms and network requests. Native
CDP keyboard/mouse events were used for the keyboard and hover checks; supported
focus emulation was enabled only on the owned page. DOM activation/control events
used elsewhere are not represented as native keyboard checks.

| Browser check                        | Final result        | Actual observation                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seven research pages, desktop/mobile | **PASS**            | Landing, Overview, Relative Value, Term Structure, Backtest, Data Health and Methodology rendered at 1440 x 1000 and 390 x 844; screenshots visually inspected; no page-wide horizontal overflow.                                                                                                               |
| Direct page refresh                  | **PASS**            | All seven routes reloaded and rendered in the browser; Profile reload retained its session and saved name.                                                                                                                                                                                                      |
| Extra feature pages                  | **PASS**            | Calendar, My Research and My Profile opened; their mobile widths fit the viewport. No private Profile/email screenshot was exported.                                                                                                                                                                            |
| Native keyboard/focus                | **PASS**            | Profile Enter/edit, Tab/Shift+Tab, Space/Cancel, native text insertion and Enter/Save worked with trusted events; visible focus returned to Edit. Dashboard and Landing menus closed with focus restored; research delete cancellation returned focus to Delete; calendar ArrowRight advanced the focused date. |
| Hover tooltips                       | **PASS**            | All eight chart instances activated with trusted mouse movement at desktop/mobile sizes: Landing/Overview reference charts, spread/z-score, curve/roll-down, P&L/cost sensitivity. Sampled tooltip bounds stayed inside the viewport.                                                                           |
| Purity/maturity matching             | **PASS**            | Initial purity OFF; ON visibly experimental. GOLDM-GOLDTEN, A expiry 2026-11-05, purity ON: unmatched +Rs 218.22, matched -Rs 52.36. Analytics-only warning retained. These are not purity-OFF results.                                                                                                         |
| Missing matching counterpart         | **PASS**            | Browser blocking produced a different-source counterpart; the current API gap remained valid, but matching effect explicitly became Unavailable for this exact observation. No fabricated effect or Unavailable% suffix.                                                                                        |
| Explain / Calculation Breakdown      | **PASS**            | Expanded panels followed the selected comparison and API source. GOLDTEN-GOLDPETAL purity OFF: A 149436, B 150020, gap -584 per 10 g, approximately -0.39%.                                                                                                                                                     |
| Backtest applied/draft settings      | **PASS**            | Integer-lot draft showed Previous run while prior results remained labelled; Run simulation sent integer_lots, updated applied results/settings and removed Previous run. Invalid negative entry input did not replace the applied result.                                                                      |
| Backtest outcomes                    | **PASS**            | Default October GOLDTEN-GOLDPETAL: 0 completed, 1 open, 0 unresolved; realized net Rs 0; total marked net approximately -Rs 991.70. Zero completed trades remained an honest result.                                                                                                                            |
| Coverage controls/empty day          | **PASS**            | Month/product/date controls and native date keyboard worked; month/product persisted across in-app navigation. Empty 02 October displayed Not loaded, not an invented holiday.                                                                                                                                  |
| Save/reopen all three research types | **PASS**            | Real forms saved RV, explicit-date Term Structure and integer-lot Backtest configurations. Reopening restored exact selected controls/purity flags and current API result/source.                                                                                                                               |
| Research editing/deletion/isolation  | **PASS**            | Rename and HTML-like plain-text notes persisted; native Cancel preserved the item and returned focus; confirmed deletion removed it. A second account had zero first-account workspaces.                                                                                                                        |
| Missing saved expiry                 | **PASS**            | Synthetic 2099-12-30 selection displayed Unavailable, disabled Save and explicitly avoided substituting a default report.                                                                                                                                                                                       |
| Zero/null settings                   | **PASS**            | Exit threshold, costs and minimum volume stayed zero through save/reopen; latest/null expiry remained latest with an unfiltered query.                                                                                                                                                                          |
| Signup/login/logout                  | **PASS**            | Signup and valid login arrived at Landing. Invalid credentials showed an explicit message. Logout cleared protected Profile display; browser cookie/session requests reached the isolated backend.                                                                                                              |
| Profile validation/update            | **PASS**            | Blank name showed linked validation; Unicode update persisted after reload and shared Landing account name updated. Native Save also agreed with the subsequent Profile HTTP response.                                                                                                                          |
| Failed Profile update                | **PASS**            | Blocked endpoint retained the previously confirmed name with explicit error/advice; no false success.                                                                                                                                                                                                           |
| Loading and HTTP 503                 | **PASS**            | Pending comparison hid old gap/explanation and disabled Save. HTTP 503 displayed Retry without stale results; unblocking and Retry recovered.                                                                                                                                                                   |
| Rapid selection/race                 | **PASS**            | Delayed window-5 response followed by window 6 left controls/explanation on 6 after the older response completed.                                                                                                                                                                                               |
| Supported/unsupported offline        | **PASS**            | Browser-only API blocking loaded labelled Offline snapshot results. Custom window 11 displayed unavailable offline and removed the old gap. Main backend was never stopped for this test.                                                                                                                       |
| Private outage/recovery              | **PASS**            | Profile outage showed retry, no previous private name/details and no snapshot fallback; restored connectivity/reload recovered confirmed data.                                                                                                                                                                  |
| Runtime exceptions                   | **PASS**            | No Runtime.exceptionThrown events collected. Intentional blocked/aborted network requests occurred; this is not a claim of zero warnings in every console category.                                                                                                                                             |
| Public/physical-device acceptance    | **NOT TESTED**      | No public deployment exists; no physical mobile device or other-browser acceptance was performed.                                                                                                                                                                                                               |
| Alerts                               | **NOT IMPLEMENTED** | Existing placeholder has no working alerting backend; no feature was added.                                                                                                                                                                                                                                     |

The sanitized [browser evidence](evidence/feature-check-2026-10-24/browser-acceptance.json)
contains **63 final passing check groups** (some deliberately overlap for rechecks),
with **49 screenshots** under
[browser screenshots](evidence/feature-check-2026-10-24/browser/).
Examples: [mobile chart](evidence/feature-check-2026-10-24/browser/relative-chart-mobile-final.png),
[HTTP 503](evidence/feature-check-2026-10-24/browser/comparison-503.png),
[missing saved expiry](evidence/feature-check-2026-10-24/browser/backtest-unavailable-selection.png).

Initial harness failures were rechecked rather than called application bugs:
one hover coordinate missed the plot; saved-banner assertions used the wrong
wording; a DOM return could not serialize; PowerShell helper concatenation needed
explicit UTF-8; chart width needed to account for 16px padding on each side.
Corrected checks passed against the actual UI. No reproducible application defect
remained and no application code was changed during this browser follow-up.

Disposed only the owned browser context and stopped only verification sessions
(backend PID 22080 / preview PID 48792). Final **8011/5181 closed**;
main **8010 PID 43312** and **5173 PID 8148** remained unchanged and responded
health ok / HTTP 200. The manually opened dedicated Chrome remained running.
All three real SQLite byte hashes matched the fresh browser-run baseline.
No remaining requested local-browser check is blocked, so no manual workaround
is required for this checklist. Earlier [22 October acceptance](FINAL_BROWSER_ACCEPTANCE.md)
is retained as historical evidence, not relabelled as today's run.

## Limitations and scope

The earlier unexpected SIGINT sender remains **unresolved**. Main backend health
was good through this audit, which does not prove long-running stability or fix
the earlier shutdown issue. Only verification-owned services received deliberate
cleanup signals.

Data is historical (as of **2026-10-01**, **14 sessions**), not live. Purity
assumptions remain unverified/experimental and default OFF. Maturity matching is
analytics-only; settlements are not executable fills; a short sample does not
establish profitability. Public deployment remains pending.

No application behavior, analytics, settings, market data, dependencies or real
account records were changed. Only this report and sanitized audit evidence were
added; application builds and ignored disposable verification artifacts were
generated. No commits, pushes, deployment or PPT work occurred.

**Verdict:** exercised implemented frontend/backend connections and the requested
local-browser acceptance pass. No open FAIL was found in this follow-up. Alerts
remains unimplemented; public deployment and physical-device checks remain NOT
TESTED. The earlier unexpected SIGINT cause remains unresolved separately.

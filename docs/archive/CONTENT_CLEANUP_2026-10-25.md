# Auraxis content cleanup — 25 October 2026

Completed the user-facing cleanup without changing backend code, API schemas, calculations, simulation defaults, authentication semantics, market data or offline snapshots. Earlier unrelated working-tree changes were preserved. No commits, deployment, dependencies or PPT work.

## Page-by-page result

| Page              | Change                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing           | Removed redundant metadata below the action; retained dated source, units and settlement context beside results. Branding and crow remain.                                   |
| Overview          | Current prices/history first; compact provenance and on-demand calculation detail. Nonzero quality exclusions remain visible.                                                |
| Relative Value    | Short result context, readable applied settings, compact explanation/calculation disclosures and Save action. Actual selections, analytics-only and quality warnings remain. |
| Term Structure    | Curve/roll results first; readable filter/settings details, reconciliation and chart rules disclosed. Invalid diagnostics remain visible.                                    |
| Backtest          | Applied pair, expiry, sizing and costs remain beside results. Detailed interpretation/order logs disclosed; open/unresolved positions and stale outcomes retained.           |
| Data Health       | Summary and actual issues first; definitions, import breakdown and file logs disclosed. Unknown values remain distinct from zero.                                            |
| Methodology       | Short named topic summaries with accessible technical sections; existing source references retain incomplete-verification wording.                                           |
| Coverage Calendar | Short legend, consistent controls, calendar/date results first; coverage definitions/logs disclosed. Missing observations are not called holidays.                           |
| My Research       | One actionable empty state; no redundant zero-count pagination. Saved configuration/results distinction retained.                                                            |
| My Profile        | Short form labels/help; removed implementation narration without changing account editing.                                                                                   |
| Login/signup      | Removed session implementation paragraph; validation and signup password guidance remain.                                                                                    |

Shared improvements: compact Save form with selection context, Cancel/Escape/focus restoration; explicit compact API/offline provenance; experimental enabled-purity status; readable settings; locally scrollable tables. Removed repeated large purity banners while keeping material research warnings near results. Alerts remains its existing placeholder.

## Files changed for this cleanup

Under `frontend/src/components/`: `AccountMenu.tsx`, `BacktestTables.tsx`, `ComparisonExplanation.tsx`, `DataContext.tsx` (new), `HealthDiagnostics.tsx`, `SaveResearch.tsx`, `SourceBadge.tsx`, `SpreadCharts.tsx`.

Under `frontend/src/pages/`: `LandingPage.tsx`, `DashboardOverviewPage.tsx`, `RelativeValuePage.tsx`, `TermStructurePage.tsx`, `BacktestPage.tsx`, `DataHealthPage.tsx`, `MethodologyPage.tsx`, `CalendarPage.tsx`, `ResearchPage.tsx`, `ProfilePage.tsx`, `LoginPage.tsx`.

Also `frontend/src/layouts/AppLayout.tsx`, `frontend/src/styles/index.css`, `frontend/tests/routes.test.mjs`, `frontend/tests/phase1.test.mjs`, this report and local evidence. Some files already contained earlier uncommitted work; this list does not attribute their entire Git diff to this cleanup.

## Actual verification

| Check                                                  | Result                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Complete frontend tests                                | PASS — 108 tests, no failures/skips                                           |
| Typecheck                                              | PASS                                                                          |
| ESLint                                                 | PASS                                                                          |
| Targeted Prettier on changed frontend source/tests     | PASS                                                                          |
| Production build                                       | PASS — main preview bundle uses API port 8010                                 |
| Scoped Git whitespace check                            | PASS                                                                          |
| Browser acceptance                                     | PASS — 85 recorded assertions; desktop 1440×1000 and mobile emulation 390×844 |
| Real market/auth/workspace database SHA-256 comparison | PASS — all three unchanged                                                    |
| Main backend `/health`, production preview             | PASS — health ok, preview HTTP 200; original listener PIDs preserved          |
| Backend suite                                          | NOT RERUN — no backend changes in this cleanup                                |

Browser: dedicated Chrome 156 over CDP, private verification context, isolated backend 8011 and preview 5181, disposable accounts/storage and a market database backup. All eleven routes above were opened at both viewport sizes, plus signup. Final screenshots waited for the full-page loader/inert state and chart animations to settle. Native keyboard events checked focus/navigation/disclosures and native mouse events checked all eight chart tooltips at both widths; other assertions used DOM interaction/state inspection. This was browser acceptance, not merely HTTP checks.

Verified Save/reopen for comparison, term structure and backtest; empty My Research; unavailable saved expiry; purity OFF by default and experimental ON; matching changes; Backtest draft “Previous run” and applied integer sizing; Profile edit/cancel/save; logout and invalid authentication. Loading suppresses old output and disables Save. Injected HTTP failure/retry and Save failure/retry recover. Supported snapshots show offline provenance; unsupported window 11 reports unavailable without substituting defaults.

Reproducible defects fixed and rechecked: mobile header crow overflow, focus loss after asynchronous Save success/failure, and chart tooltip painting behind a legend. Final settled online pass recorded no runtime exceptions or unexpected console errors. Deliberately injected network failures were kept separate from application errors. Earlier harness timing, CORS and DOM-serialization errors were corrected before recording final results.

The broad formatter attempt included pre-existing generated build artifacts and was stopped without rewriting unrelated output. Its warnings are not represented as a whole-repository formatting pass.

## Before/after evidence

| Screen         | Before                                                                  | After                                                                                 |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Relative Value | [Before](evidence/content-cleanup-2026-10-25/before-relative-value.png) | [After](evidence/content-cleanup-2026-10-25/browser/after-relative-value-desktop.png) |
| Backtest       | [Before](evidence/content-cleanup-2026-10-25/before-backtest.png)       | [After](evidence/content-cleanup-2026-10-25/browser/after-backtest-desktop.png)       |
| Term Structure | [Before](evidence/content-cleanup-2026-10-25/before-term-structure.png) | [After](evidence/content-cleanup-2026-10-25/browser/after-term-structure-desktop.png) |

Local evidence: [acceptance results](evidence/content-cleanup-2026-10-25/acceptance.json), 52 sanitized PNGs including mobile, tooltips and error states. Profile screenshots remain in ignored disposable verification storage rather than public evidence. Evidence follows the repository's existing ignore rules; it has not been uploaded.

## Handover and limits

Open <http://localhost:5173/>; hard-refresh if an older bundle is cached. Main backend 8010 and preview 5173 remain running. Only verification-owned services on 8011/5181 and verification-owned private browser contexts were cleaned up; dedicated Chrome and normal browser/services were preserved.

Public deployment, physical devices, other browsers and long-running reliability: NOT TESTED. Historical data covers 14 sessions; it is not live and cannot establish profitability. Purity remains unverified/experimental. Settlement simulations are not executable market fills; maturity matching is an analytical approximation. Existing MCX references were exposed, not freshly reverified.

The previously reported unexpected SIGINT sender remains **UNRESOLVED**. No unexpected shutdown occurred during this isolated run; successful browser acceptance does not establish that the shutdown cause is fixed. Intentional cleanup signals targeted only services created for this verification.

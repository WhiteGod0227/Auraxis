# Priority fixes — 15 October 2026

**Historical chronology:** earlier pending states/test counts describe their audit stage. Use [FINAL_LOCAL_READINESS.md](FINAL_LOCAL_READINESS.md) for current classification. Later label fixes and browser evidence supersede earlier entries.

## Comparison basis and defaults

Purity adjustment is experimental and OFF by default in analytics, API endpoint defaults, frontend controls and default offline snapshots. Explicit purity-enabled scenarios remain available. No formulas, market rows, simulation costs or thresholds were changed.

Earlier official-source inspection is recorded in AUDIT_2026-10-15.md. That evidence supports lot/quote grams GOLDM 100/10, GOLDTEN 10/10, GOLDGUINEA 8/8 and GOLDPETAL 1/1; delivery fineness 995/999/999/999; GOLDM expiry around the fifth and the others at month-end, subject to working-day rules. Current attempts to reopen the MCX PDFs were inaccessible. Delivery fineness does not establish that the experimental price multiplier makes all quotes economically equivalent. GOLDM's delivery-premium clause is not universal quote equivalence; delivery locations also differ. Full comparison-basis verification remains incomplete. Existing recorded expiries are preserved.

Official documents referenced by the prior audit:
- https://www.mcxindia.com/docs/default-source/about-us/gold-mini-august-2026-contract-onwards8a79913a-e8de-4136-9f0b-25d31dc163c4.pdf
- https://www.mcxindia.com/docs/default-source/about-us/gold-ten-july-2026-contract-onwards.pdf
- https://www.mcxindia.com/docs/default-source/about-us/gold-guinea-july-2026-contract-onwards.pdf
- https://www.mcxindia.com/docs/default-source/about-us/gold-petal-july-2026-contract-onwards.pdf

UI calls expiry interpolation “Maturity matching”; existing API parameter names remain compatible. The Relative Value summary compares matching on/off using identical pair, expiry, date and price basis. Missing comparisons remain unavailable.

## Presentation and applied results

- Dashboard routes retain the background gradient but omit moving white particles; landing retains them.
- Secondary text contrast increased. Liquidity check and Source trade flag use Passed/Failed; absent reasons say No reason provided. Raw diagnostics remain in technical details.
- Relative Value shows the selected result first, including pair, expiry, gap, matching effect and quality.
- Backtest results identify applied pair, expiry, sizing mode and costs. Edited controls mark the output “Previous run—apply changes to update”. Position sizing explanations follow the applied mode.
- Loading/retry/error transitions do not label a previous response as current. Unexpected API failures retain safe JSON500 and allowed-origin CORS headers so they are distinguishable from network unavailability.
- Historical, analytics-only, unresolved/stale and 14-session limitations remain visible.

## Actual verification

- Backend: 173 tests passed. Repository Ruff lint passed; backend Ruff format check passed (38 files).
- Frontend: typecheck, lint, 54 tests and production build passed. Particle route tests are server-rendered component tests, not browser visual tests.
- Reused preview http://localhost:5173 and development service. Restarted only the identified Auraxis backend on port8010 after its reload process served stale metadata; live metadata now confirms purity default OFF.
- All seven frontend routes returned HTTP200 app shells on direct refresh. This establishes local routing fallback, not rendered browser behavior.
- Actual API rejected unsupported product, zero rolling window, unsupported GOLDM backtest and invalid entry/exit ordering with422.
- Missing historical curve date returned no points without substituting latest data.
- A client pointed at an unavailable local API used an exact supported offline snapshot; a custom window without a snapshot failed explicitly.
- Isolated tests cover failed/malformed HTTP responses, no inappropriate fallback and allowed-origin server-error headers.
- All44 active snapshot payloads validated as strict JSON, checksums matched, and bytes agreed with shared response builders against the current database. Served preview snapshot checksums also matched.
- Database SHA256 unchanged: 74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f.

Verified observation: 2026-10-01, GOLDM-GOLDTEN, A expiry2026-11-05, purity OFF: matching OFF -381.00 Rs/10g; matching ON -651.5806451613025; matching effect ON minus OFF -270.5806451613025. These differ from prior purity-enabled figures because the default basis changed. Historical window remains2026-09-14 through2026-10-01,14 sessions.

## Pending checks

There is no public deployment. Public URL refresh and failure checks remain pending until a URL is supplied. Browser automation/visual inspection was unavailable; no visual checks are claimed. Manually open all seven routes on desktop/mobile, confirm summary and contrast, toggle purity/matching, edit Backtest settings and check the Previous run message, switch sizing modes and inspect explanations, then retry after a simulated API outage. No dependency installation, deployment, commits or market-data modifications were performed.

## Final checklist follow-up — 15 October 2026

Actual outage test completed: stopped only the identified Auraxis backend8010 processes, invoked the real frontend client against that unavailable backend and the running production-preview snapshots, and confirmed supported default GOLDTEN-GOLDPETAL returned source “Offline snapshot” with purity=false. Custom window11 returned offline-unavailable rather than default output. Restarted backend in finally; /health confirmed status ok. Preview/development services were left running. This tests actual client behavior during an actual outage, not browser badge rendering.

Frontend client/component regression suite rerun:54 passed,0 failed. No new features or redesign changes in this follow-up.

Still blocked/unperformed: rendered desktop/mobile checks on all seven pages, interactive click-through of matching/backtest/sizing, browser screenshots, presentation claim edits, PPTX layout/link inspection and submission. No browser-control tools or connected document sessions were available; no PPTX was found in the repository. User has been asked for the presentation path/link, submission destination/deadline and hosting target if public deployment is required. No public URL was created or added to a presentation; localhost must not be described as a public deployment. No submission has occurred.

Presentation claim guard: label displayed numbers with purity setting, historical date, pair/expiry and matching mode. For2026-10-01, GOLDM-GOLDTEN A expiry2026-11-05, purity OFF: matching OFF -381.00; matching ON -651.58; effect -270.58 Rs/10g. Do not combine these with prior purity-enabled figures. Say comparison basis remains experimental/incompletely verified and the14-session sample does not establish profitability.

## User-confirmed handover constraints

Deadline supplied by user:15 October2026,11:59PM IST. Submission platform:Unstop; exact submission URL not supplied. PPTX is outside the repository and will be provided separately. Public deployment is not currently required for the Idea & PPT round. Keep PPTX editing, deployment and submission pending; do not guess hosting targets or portal URLs.

### Local manual acceptance checklist — pending browser access

Open production preview and inspect each route at desktop (approximately1440x900) and mobile (approximately390x844): /, /app, /app/relative-value, /app/term-structure, /app/backtest, /app/data-health, /app/methodology. Check body text, chart axes/tooltips, table horizontal scrolling, control/button visibility and absence of page-wide horizontal overflow. These rendered checks have not been performed by the agent.

Relative Value: confirm purity initially OFF; enable it and check Experimental label. Select GOLDM-GOLDTEN, A expiry2026-11-05 and purity OFF. Confirm matching OFF gap -381.00 and ON -651.58, effect -270.58 on2026-10-01. Missing comparison must say unavailable.

Backtest: run default GOLDTEN-GOLDPETAL expiry2026-10-30. Edit a setting; old output must say Previous run—apply changes to update. Run again and compare applied settings with the new request. Switch integer/fractional sizing; compare control descriptions and applied-result explanations, remembering old output still belongs to its previous applied mode until rerun.

Actual backend-outage client behavior and backend restoration were verified above; visible browser offline badges/retry controls remain unverified. Do not stop unrelated services. No newly discovered visual issues are asserted because browser inspection is unavailable.

## Actual browser verification completed after user opened Chrome debugging session

The user launched a separate Chrome test profile and exposed its localhost9222 debugging interface. Connected to that already-open production-preview tab; no further browser launch, install or restriction bypass was performed. Browser was driven through DevTools protocol. These are actual rendered-browser checks with screenshots, not a repeat of the unit suite, and not physical mobile-device testing.

All seven routes opened at1440x1000 desktop and390x844 mobile emulation. Inspected captured full-page images for text, controls, charts and table layout. All14 pages had document width equal to viewport width; no runtime exceptions were recorded. Tables use contained scrolling. Long mobile pages and dense tables still require scrolling; not every cell/tooltip/button permutation was inspected.

Verified control actions:
- Relative Value default purity unchecked. Clicked Purity adjustment: enabled (experimental) appeared in summary. Restored OFF.
- Selected GOLDM-GOLDTEN, Fixed expiry2026-11-05. Matching ON showed -651.58, OFF -381.00, effect -270.58 Rs/10g for2026-10-01. Analytics only remained visible.
- Browser-only fault injection returned503 for the comparison request with carry_adjusted=false; missing counterpart showed Unavailable for this exact observation plus Retry comparison, not fabricated matching effect. Removed interception afterward.
- Backtest default October report showed realized0 and marked -991.70. Edited z_entry1 to1.5: Previous run—apply changes to update appeared. Clicked Run simulation: applied configuration became1.5 and old-run warning cleared.
- Selected integer_lots and ran: applied configuration and summary said Integer lots (rounded down); marked result -235.73 for this custom z_entry1.5 run. Do not use this custom number as the default demo result. Restored defaults and submitted, then left browser on landing.

### Observed issues — reported, no redesign or calculation changes

1. Overview (/app), desktop and mobile: after opening the page with default purity OFF and reading below Fixed-expiry price histories, caption still states Rs per10g ·999 purity. This conflicts with quote-size-only normalization and must not be used as proof of verified purity equivalence. Evidence: overview-desktop.png and overview-mobile.png.
2. Relative Value (/app/relative-value): select GOLDM-GOLDTEN; earliest expiry2026-10-05 lacks an interpolation bracket. During missing-comparison503 test, summary renders Price gap: Unavailable per10g (Unavailable% of B). Correctly preserves unavailable data, but the percent suffix is awkward. Evidence: relative-comparison-unavailable.png. The503 response was deliberately injected in the browser only, not a real backend outage.
3. Term Structure detailed diagnostic table still exposes technical headers and true/false in Valid; readable but inconsistent with requested friendly labels. Evidence: term-desktop.png.

Evidence directory: docs/evidence/2026-10-15-browser/. report.json records widths, route controls and exceptions; interaction-report.json records actual before/after summaries; additional-report.json records missing comparison and caption issue. Full-page screenshots are tall; crop relevant portions for slides instead of shrinking entire pages.

These findings supersede the earlier statement that browser visual checks were unavailable. PPTX remains unprovided; screenshots have not been inserted into a deck, no PPTX has been finalized, no public deployment or Unstop submission occurred. No claim of complete visual or contract-spec verification is made.

## Three presentation issues fixed and browser-rechecked

Supersedes the three open presentation findings above. Only frontend display text/markup changed; no calculations, API behavior, data or new controls were added.

- Overview chart caption now follows response.purity_adjustment: OFF shows Rs per10g, quote-size conversion only; ON shows Experimental purity adjustment enabled and unverified assumptions. Actual default OFF checked in desktop/mobile Chrome. Overview has no purity control: its ON branch was additionally checked using an actual API purity=true response delivered through a temporary browser-only response interception. Interception was removed and defaults restored.
- Relative Value summary appends percent notation only to finite numeric percentages. Missing GOLDM October interpolation result now says (Unavailable), never Unavailable%. Valid November percentages and purity OFF/ON labels were checked on desktop/mobile.
- Term Structure table headers now say Trade activity and Decomposition check; boolean diagnostic cells show Passed/Failed. Main reconciliation sentence uses readable labels. Raw formulas, backend explanation and field-name mapping remain accessible inside expandable technical sections. Purity toggled ON then OFF on desktop/mobile and headers verified.

Typecheck, lint and final production build passed. Actual browser rechecks completed at1440x1000 and390x844 emulation without recorded runtime exceptions. Refreshed screenshots and checks.json are in docs/evidence/2026-10-15-browser/ui-label-fixes/. Three viewport-sized readable captures are overview-readable.png, relative-readable.png and backtest-readable.png; full-page mobile and diagnostic-state evidence is separate. Previous screenshots remain historical evidence, not the current UI. Production preview was rebuilt and reused, not duplicated. Public deployment remains pending/not performed.

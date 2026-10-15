# Final local readiness audit — 15 October 2026 (IST)

**Later appearance correction:** the user explicitly restored the screenshot-style gradient and stars on every page. The historical zero-dashboard-particle check below is superseded; current route tests require all three star layers. Reduced-motion support remains. Do not reapply particle removal from the earlier checklist.

This is the current reconciled status. Earlier phase reports remain historical evidence; their resolved findings, default-purity settings and former browser-unavailable notes are not a current pending list. No deployment, account/billing setup, Linux-container work, market-data edits or parameter tuning occurred in this audit.

## 1. Findings and classification

| Item | Current classification | Evidence / action |
| --- | --- | --- |
| Historical seven-route desktop/mobile fit and basic controls | **Verified**, bounded coverage | Prior actual Chrome captures at1440×1000 and390×844 emulation; not physical devices or every UI permutation |
| Incorrect purity caption, Unavailable%, raw Term Structure labels | **Verified — previously fixed** | `ui-label-fixes/checks.json`, caption scenario check and refreshed screenshots; not pending bugs |
| Four market records → normalized prices → maturity comparison → HTTP API | **Verified** | Independent read-only Decimal arithmetic, CSV line references and current API agreement in `calculation-trace.json` |
| Default Backtest accounting, both sizing modes, signal and execution chronology | **Verified** for selected existing run | Current DB inputs and API reports reconcile; no completed trades manufactured |
| Backtest accessible control names | **Failed → fixed → browser checked** | Numeric inputs' raw aria-labels overrode their readable visual labels. Inputs/sliders now have friendly names; cross-field errors are associated and mark relevant controls invalid |
| Relative Value chart's historical numeric alternative | **Failed → fixed → browser checked** | Existing quality table had flags only. Its per-row expandable chart values now expose spread, mean, sample standard deviation and z, preserving nulls; region is keyboard-scrollable |
| Visible input/select keyboard focus | **Verified after narrow CSS fix** | Explicit focus-visible outline added without redesign; actual Tab navigation check passed |
| Dashboard moving particles | **Failed checklist requirement → fixed** | Latest attached checklist requires landing-only particles, superseding the earlier all-pages-stars request. Gradient/translucent panels unchanged; two route render tests pass |
| Rapid selection, loading/failure state and failed-request retry | **Verified** in current browser sequence | Delayed old requests ignoring abort were injected before module initialization; newer selection survived. Prior result disappeared while loading/failing; successful retry recovered |
| Offline exact-match/error handling | **Verified** from prior browser/actual-outage evidence plus focused client tests | Existing exact snapshot source/date evidence reused; new HTML200 and API-recovery regressions pass |
| Current browser regression | **Verified after reconnect** | User reopened the interrupted debugging Chrome. Full focused sequence completed; reduced motion, exact offline source/error, retry recovery and trace UI verified in browser-regression.json |
| Counterpart request state | **Previously misleading; fixed and verified** | A pending counterpart previously read Unavailable. Now Loading comparison is shown until completion; independently delayed response verified in comparison-loading.json |
| Full economic comparison-basis/contract-spec verification | **Unverified research limitation** | Prior official-document evidence does not prove quoted-price equivalence. No fresh official-source retrieval or certification is claimed |
| Physical devices, screen readers, exhaustive accessibility/browser coverage | **Unverified** | Mobile emulation and bounded keyboard checks do not establish WCAG compliance |
| Public deployment/acceptance, hosting/billing, Linux container | **Out of scope** | Still pending; not publicly accessible or production-verified |

No newly discovered calculation discrepancy or critical local-demo blocker was established. The initial browser interruption was not diagnosed as an application failure; remaining checks were subsequently completed after the user reopened Chrome. No report labels a research limitation resolved merely because its wording changed.

## 2. Independent comparison trace

Observation2026-10-01; GOLDM–GOLDTEN; fixed A expiry2026-11-05. Source file `BhavCopyDateWise_01102026.csv` agrees with the selected SQLite records:

| Product | Expiry | CSV line | Stored close | Quote grams | Raw Rs/10g |
| --- | --- | --- | --- | --- | --- |
| GOLDM | 2026-11-05 | 6208 |149055 |10 |149055 |
| GOLDTEN |2026-10-30 |6449 |149436 |10 |149436 |
| GOLDTEN |2026-11-30 |6450 |150834 |10 |150834 |
| GOLDPETAL (conversion cross-check) |2026-10-30 |6443 |15002 |1 |150020 |

Conversion: close ×10 /quote_grams. Purity OFF does not multiply by fineness. Experimental ON applies999/995 to GOLDM, producing149654.216080402010…; GOLDTEN remains unchanged under configured999 purity.

Matching OFF chooses October30, six calendar days before A, versus November30 twenty-five days after A. Matching ON uses both same-observation brackets: upper weight6/31, lower25/31; B=149436+(6/31)×(150834−149436)=149706.580645161290… . It is not extrapolation or a tradeable synthetic contract.

| Purity | Matching | Spread A−B, Rs/10g | Percentage100×(A−B)/B | Display |
| --- | --- | --- | --- | --- |
| OFF |OFF |−381 |−0.254958644503…% |−₹381.00; −0.25% |
| OFF |ON |−651.580645161290… |−0.435238479399…% |−₹651.58; −0.44% |
| Experimental ON |OFF |+218.216080402010… |+0.146026446373…% |₹218.22;0.15% |
| Experimental ON |ON |−52.364564759280… |−0.034978131578…% |−₹52.36;−0.03% |

Matching effect ON−OFF=−270.580645161290… Rs/10g, displayed−₹270.58, on identical pair/date/A-expiry/purity basis. Live API float results agree with independent Decimal results at rel_tol1e−10, abs_tol1e−8. Display rounding does not enter calculations. Current browser traceUI and comparison-loading.json verify the displayed OFF matching-ON case and effect. Earlier browser interaction evidence also covers OFF matching-OFF and experimental ON state; those prior checks are explicitly reused.

This checks arithmetic/source-record correspondence, **not** full official comparison-basis validity. Delivery fineness is not automatic economic equivalence; quote location/contract terms remain material.

## 3. Backtest reconciliation

Default supported GOLDTEN–GOLDPETAL, expiry2026-10-30, purity OFF, entry threshold1, exit0.25, cost5bps/leg/side, target notional Rs1,000,000/leg, maximum hold5sessions. Signal2026-09-25 independently recomputes z≈1.5772494977 using only preceding available observations (nine in this startup window), sample standard deviation and current signal-date spread. Entry2026-09-28 is the next available database session, not same-close execution. Orders execute after their signal date. Source review and prior isolated `test_future_changes_preserve_orders_fills_and_ledger` cover causal processing; no future-data mutation was performed on the real DB.

| Mode | Signed A/B lots | Entry normalized A/B | Gross marked | Entry costs | Net marked |
| --- | --- | --- | --- | --- | --- |
| Fractional |−6.7353220494 /+67.0915800067 |148471 /149050 |8.2974829568 |1000 |−991.7025170432 |
| Integer round-down |−6 /+67 |148471 /149050 |709 |944.7305 |−235.7305 |

Marks2026-10-01: A149436, B150020. Gross=Σ signed quantity_10g×(mark−entry); costs=Σabs(quantity×entry)×5/10000. Integer B67lots means6.7units of10g. Both reports have0completed,1open,0unresolved, realized net0; win rate/average completed holding remain null. Marked net is unfinished, not realized profit. Existing tests/evidence preserve missing/stale valuations and separate unresolved positions; this real run has no valuation gaps or completed exits, so it cannot empirically validate a closed-trade exit or profitable cost tolerance.

Prior browser checks verified draft edits do not relabel applied results, Run updates settings, and sizing explanation follows applied mode. Current cross-field validation check retained the previous-run warning without submitting invalid thresholds. Cost sensitivity remains closed-trades-only with no completed trades; it is not whole-strategy break-even.

## 4. Checks actually run / evidence reused

New/current checks:
- Read-only DB/CSV/HTTP arithmetic audit, both purity and matching settings, two sizing modes: passed. Script `docs/evidence/final-local-audit/trace.py`; strict JSON result `calculation-trace.json`.
- Focused Node tests:2particle route render tests,11existing selected race/error/default/null regressions,2new HTML200/API-recovery cases passed. These counts describe selected checks, not a new full-suite run.
- TypeScript check and rebuilt local preview passed. Frontend ESLint and repository Ruff passed after audit-script formatting/lint corrections. No complete backend suite was repeated because backend implementation did not change.
- Live unsupported expiry returns honest empty series; insufficient initial history keeps rolling mean/z null; invalid zero window returns422; metadata defaults purity OFF with14sessions. See `http-edge-checks.json`.
- Local Vite may return an HTTP200 HTML shell for a nonexistent snapshot path. Client regression proves this cannot become successful offline JSON; it fails typed validation/integrity. Public host routing behavior is outside this audit.
- Current browser sequence passed delayed-request race, no stale result on503, retry recovery, keyboard expansion of chart values, relevant-field validation/labels, visible focus, mobile menu Escape/focus return and keyboard horizontal table scrolling in the completed focused run. Reduced-motion emulation disabled all three Landing star animations; dashboard had zero particle layers. Supported offline requests showed Offline snapshot and historical dates, unsupported window11 stayed unavailable, and retry after transport recovery returned API data.

Reused, not rerun wholesale: prior173backend/54frontend suite results; source/loader336-row audit;44snapshot schema/checksum/shared-builder equality; seven-route desktop/mobile screenshots; missing-comparison503 handling; actual backend-stop supported/offline and unsupported-custom behavior; prior purity/matching/backtest controls. Those are dated evidence, not claims of exhaustive current coverage.

Current source DB remains336bhav and15data_health records. SHA-256 before/after: `74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f`. Market rows, database, snapshots, thresholds and analytics formulas were preserved.

Refreshed screenshots at `docs/evidence/final-local-audit/`:
- `relative-history-desktop.png` —1440×1000 viewport, full-page capture after keyboard expansion.
- `backtest-validation-desktop.png` —1440×1000 viewport, entry0.5 /exit1 draft validation; old applied result remains identifiable.
- `relative-history-mobile.png` —390×844 **emulation**, full-page capture; keyboard-focused horizontal region.

The checked-in `frontend/scripts/verify-final-local-audit.mjs` is the focused actual-browser regression harness, requires the existing user-opened localhost9222 test browser, and contains browser-only delays/fault injection. It does not change backend data. Successful final JSON is written only if all assertions finish; interrupted runs must not be reported as full passes. After reconnect, the complete run succeeded with zero recorded runtime exceptions and produced browser-regression.json. The added pending-counterpart check was additionally verified in a separate focused browser run, recorded in comparison-loading.json; the reusable harness now includes it.

## 5. Files changed / limits

Frontend source only: `StarBackground.tsx`, `BacktestPage.tsx`, `RelativeValuePage.tsx`, `styles/index.css`. Focused tests/harness: `tests/particles.test.mjs`, `tests/client.test.mjs`, `scripts/verify-final-local-audit.mjs`. Documentation: frontend/backend README corrections, handover/current-status pointers, this report and evidence. Backend analytics/API code unchanged.

Research limitations remain:14historical sessions, not live quotes; unverified economic purity basis; synthetic maturity comparison; settlement execution/cost/sizing assumptions; unfinished positions; partial persisted data-health diagnostics; exact limited offline configurations. No complete fee/margin/delivery validation, trading signal certification, profitability proof, physical-device testing or exhaustive accessibility certification is claimed.

## 6. Exact local commands (PowerShell)

Reuse running services; open a separate free terminal for each service only if absent. No commands should be typed into an occupied Vite process.

Backend:
```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Frontend local build preview:
```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
$env:VITE_API_BASE_URL = 'http://localhost:8010'
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Optional dev mode instead of preview:
```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
npm run dev -- --host localhost --port 5180 --strictPort
```

Local demo: http://localhost:5173/ . Health: http://localhost:8010/health . These are local URLs, not public deployment.

## 7. Local demo readiness

**Yes, for the existing bounded historical-demo flows**, based on prior seven-page evidence, current arithmetic reconciliation, narrow fixes, rebuilt preview and successful checks above. No known critical calculation/state blocker was found. The interrupted browser sequence was completed after reconnect. This remains bounded local browser/emulation coverage, not exhaustive manual accessibility testing or public acceptance.

Public deployment remains **pending and out of scope**. Do not call the website publicly accessible, production-ready or fully validated.

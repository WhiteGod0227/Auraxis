# Auraxis Phase 6 demo handover

Ready for a historical research demo. Verified on 14 October 2026 against the existing database, without refreshing data or changing backend calculations. Data covers **14 September to 1 October 2026**, 14 sessions and 336 contract observations. Dataset through: **1 October 2026**. API availability is not live market data.

## PowerShell startup

Keep an already running server; do not launch a duplicate on its port. Run these in separate terminals. No activation or execution-policy change is necessary.

Backend (terminal 1):

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

Development frontend (terminal 2):

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
npm run dev -- --host localhost --port 5180 --strictPort
```

Production preview (terminal 3, verified for this handover):

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Use **http://localhost:5173/** for recording; development is http://localhost:5180/. Health: http://localhost:8010/health. Preview port 5173 is already allowed by backend CORS; the usual preview port 4173 is not configured. Leave backend and frontend running while recording. No data import or snapshot export is needed for this verified dataset.

Pages: `/`, `/app`, `/app/relative-value`, `/app/term-structure`, `/app/backtest`, `/app/data-health`, `/app/methodology`. Calendar and Alerts remain explicitly unavailable and outside the implemented navigation.

## Ready-to-read Hinglish narration (about 2 minutes 40 seconds)

Current health, preview and development checks all returned HTTP 200. The running API values were rechecked during recording preparation and match the Phase 6 values below. Automatic approval review rejected launching a fresh verification browser; the prior Phase 6 browser evidence is retained, but this preparation does not claim a new browser walkthrough. Confirm the visible checks below during rehearsal. Timings are pacing targets: rehearse once at your normal speaking speed.

### 0:00-0:20 — Landing and problem

**Route:** `http://localhost:5173/`

**Clicks:** Show the heading and historical-date label. Click **Open Dashboard**, then **Relative Value** in the sidebar.

**Speak:** “Same gold. Different contracts. Is the gap real? Auraxis mein hum gold contracts ko ek common price basis par compare karte hain. Yeh live prices nahi hain: data 14 September se 1 October 2026 tak, sirf 14 sessions ka hai.”

**Before proceeding:** Heading, source badge and historical data as of 01 Oct 2026 visible; no loading/error notice.

### 0:20-0:50 — Relative Value and carry comparison

**Route:** `http://localhost:5173/app/relative-value`

**Clicks:** Choose **Pair: GOLDM-GOLDTEN**, then **Fixed expiry (A): 05 Nov 2026** (`2026-11-05`). Keep **Window (observations): 10** and **Purity adjustment** checked. Uncheck **Carry-adjusted comparison**, wait for the reading, then check it and wait again. Keep the same expiry.

**Speak:** “GOLDM ki expiry baaki products se alag hoti hai. Yahan observation 1 October aur GOLDM expiry 5 November hai. Carry off par gap plus 218 rupees 22 paise hai; carry on par minus 52 rupees 36 paise. October aur November contracts se maturity comparison banta hai. Yeh analytics-only diagnostic hai, directly executable trade ya arbitrage proof nahi.”

**Before proceeding:** Both readings use 01 Oct 2026 and 05 Nov 2026. Off: +Rs 218.22; on: -Rs 52.36. Carry-on B bracket: 30 Oct / 30 Nov 2026; `executable_pair=false`. Purity remains enabled.

### 0:50-1:15 — Term Structure and approximate roll-down

**Route:** `http://localhost:5173/app/term-structure`

**Clicks:** Select **Product: GOLDTEN**, **Curve date: Latest available**, with **Purity adjustment** checked. Scroll to roll-down; choose **Roll-down contract: 30 Oct 2026** (`2026-10-30`). Show the latest decomposition.

**Speak:** “Term Structure mein har expiry ka alag price dikh raha hai. Latest curve 1 October ki hai. October contract ka daily price change 1,114 rupees hai. Estimated roll-down minus 42 rupees 61 paise, aur baaki residual 1,156 rupees 61 paise hai. Yeh approximate breakdown hai, guaranteed return ya cash payment nahi.”

**Before proceeding:** Latest curve dated 01 Oct 2026, six GOLDTEN points. Roll observation 01 Oct versus 30 Sept: raw change Rs 1,114; estimated roll-down -Rs 42.61; residual Rs 1,156.61; decomposition valid.

### 1:15-1:55 — Backtest, costs and open position

**Route:** `http://localhost:5173/app/backtest`

**Clicks:** Keep **Pair: GOLDTEN-GOLDPETAL**, **Purity adjustment** checked. Confirm defaults: entry z **1**, exit z **0.25**, cost **5 bps per leg per side**, minimum volume **2000 g**, maximum hold **5 sessions**. Do not move sliders. If settings were changed, click **Run simulation**. Select **Selected report expiry: 30 Oct 2026**. Show the summary, then **Open positions (1)**. Keep this pair throughout the segment.

**Speak:** “Yeh default settlement-based simulation hai. October report mein zero completed trades, ek open position aur zero unresolved positions hain. Realized net zero hai, kyunki koi trade close nahi hua. Marked net minus 991 rupees 70 paise hai; incurred entry cost 1,000 rupees hai. Open position ka marked value final profit ya loss nahi. Settlement-based fills aur fractional sizing assumptions hain; actual execution alag ho sakta hai. Zero completed trades par win rate unavailable hai.”

**Before proceeding:** Applied results confirm the pair, purity true and defaults. Expiry 30 Oct 2026: realized Rs 0.00; total marked -Rs 991.70; costs Rs 1,000; completed 0/open 1/unresolved 0. Win rate and average completed holding show Unavailable; open-position row visible.

### 1:55-2:20 — Data Health and Methodology

**Routes:** `http://localhost:5173/app/data-health`, then `http://localhost:5173/app/methodology`

**Clicks:** Click **Data Health**; show recorded-file counts and zero-volume/no-trade diagnostics. Click **Methodology**; scroll to normalization/purity assumptions.

**Speak:** “Data Health mein 14 successful file records aur ek error record hai. Ek zero-volume GOLDGUINEA observation retain ki gayi hai. Methodology mein formulas aur assumptions documented hain. Purity assumptions abhi MCX contract specifications se verified nahi hain; unavailable checks clearly unavailable dikhte hain.”

**Before proceeding:** 15 recorded files, 14 sessions, 336 observations; one GOLDGUINEA zero-volume/no-trade observation. Purity verification is unverified. Do not guess the withheld error-note cause or combine overlapping quality counts into unique issues.

### 2:20-2:40 — Limitations and closing

**Route:** `http://localhost:5173/app/methodology`

**Clicks:** Scroll to limitations and offline coverage; finish here with labels readable.

**Speak:** “Supported defaults ke liye verified offline snapshots available hain. Custom setting ka exact snapshot na ho toh unavailable dikhta hai. Yeh short historical sample hai, live trading system nahi. Settlement prices executable quotes nahi hain. Auraxis comparison ko explain karta hai; is demo se profitability establish nahi hoti.”

**Before finishing:** Limitations and exact offline support visible. No guaranteed-profit or verified-contract-spec claim. Expiry reports remain independent.

Numbers above are rounded for narration; calculations retain original precision. Keep reports separated by expiry. GOLDM-GOLDTEN initially selects another expiry in Relative Value; explicitly choose 5 November to reproduce the landing comparison. Do not pick a report because its P&L looks better.

## Recording checklist

- Open **http://localhost:5173/** and reuse the running services. Shell commands belong in a separate terminal, never beneath a running Vite process.
- Use a readable desktop viewport, preferably 1440 × 900 or larger, at 100% zoom. Keep date, source and unit labels visible.
- Close unnecessary panels, DevTools and notification popups. Use recording software already available; do not install software or change system/security settings.
- Make a short microphone test recording and replay it to check volume, clarity and background noise.
- Follow the exact route/control sequence above, waiting for each carry-toggle response before speaking about its value.
- Review the video before submission: clear audio, readable text, correct carry-toggle behavior, selected expiry and visible open position.

**Recording is manual:** no video or microphone recording was made by this preparation. Open your existing recorder, select the production-preview browser window, and start the short microphone test first.

The following are optional rehearsal checks rather than extra steps in the timed recording:

- Use the production preview at 100% zoom, preferably a 1440-pixel desktop viewport. Close DevTools before recording and keep source/date labels visible.
- Follow the page order above. Keep default windows, thresholds, liquidity and cost settings; change only the indicated pair/expiry/carry controls. Click Run simulation after changing the Backtest draft.
- Show losses and outstanding positions honestly. The default report has no completed trades, so win rate, average holding and closed-trade cost tolerance are unavailable.
- For the unresolved example, GOLDTEN-GOLDGUINEA expiry 30 September has one unresolved-expiry position, stale expired marks, one blocked exit order with two attempts, and an unknown final outcome.
- If demonstrating offline mode, block only backend requests in the browser. Keep the preview serving snapshots. Restore requests afterward; do not disable browser security or alter CORS.
- Offline custom window 11 or Backtest cost 6 must say unavailable; restore saved defaults. An explicit historical curve date is not the latest saved curve: use the offered latest-saved-curve action.
- API HTTP 422/500 or malformed responses remain errors, without snapshot substitution. Metadata and panel sources can differ; show the source for the actual panel.

## Verification evidence

- Backend: **154 pytest tests passed**; repository Ruff lint passed; backend Ruff format check passed (36 files).
- Frontend: typecheck, ESLint, production build and **49 tests passed**.
- Production preview: all seven pages passed loading, online, empty, error, mobile and keyboard checks. Existing page-specific browser checks passed exact supported offline variants, unsupported configurations/default restoration, mixed sources, historical curve recovery and unresolved-position preservation. Backtest exit-signal lookup regression passed. No application runtime exceptions were observed.
- Health and all eight API response endpoints were checked over HTTP, including purity/carry variants and invalid GOLDM backtest HTTP 422. JSON nulls and separate realized/marked/open/unresolved results were retained.
- All **44 snapshot payloads** passed schema, strict JSON and SHA-256 checks and exactly matched existing response builders on a consistent database view. Counts: 4 foundation, 18 spreads, 8 curves, 8 roll-down, 6 backtests. Manifest generation remains `2026-10-13T18:00:46.634240Z`; regeneration was unnecessary.
- SQLite stayed unchanged: 69,632 bytes; 336 `bhav` rows; 15 `data_health` rows; before/after SHA-256 `74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f`.

Local browser reports and screenshots are under `frontend/node_modules/.cache/auraxis-verification/` (ignored, not published). Start with `phase6-preview-report.json`, `phase6-backend-snapshots.json`, `phase6-final-landing-viewport.png`, `relative-value-desktop.png`, `term-structure-desktop-rolldown.png`, `backtest-desktop.png`, `data-health-desktop-viewport.png` and `methodology-desktop-viewport.png`. The preview driver records three cancelled CDP interceptions during deliberate reloads; these are test-driver cancellation messages, not application runtime exceptions.

## Scope and limitations

The necessary fix was the landing comparison ordering: latest eligible shared observation first, nearest eligible A expiry second, with explicit observation/dataset dates and tested earlier-date fallback. Browser verification scripts now accept the production preview URL. Backend analytics, defaults, database and snapshots were not changed in this phase.

Offline support is exact: six spread pairs with purity on/off, and carry on/off additionally for the three GOLDM pairs; four curve and roll-down products with purity on/off; three same-expiry Backtest pairs with purity on/off; foundation defaults. Other settings need a working API. Purity values are problem-statement assumptions, unverified against MCX specs. GOLDM maturity interpolation is analytics-only. Zero-volume settlements are not traded prices. Invalid diagnostics, null values, stale marks and outstanding positions remain visible.

No blocking defect was found in the verified scope. Four health diagnostic categories are explicitly unavailable: row-level validation, structured volume mismatches, MCX specification verification and raw response/block diagnostics. These and Calendar/Alerts are limitations, not completed features. The short historical sample cannot support a reliable profitability conclusion. Backend tests emitted non-blocking installed-tool deprecation/cache warnings; no dependencies or security settings were changed.

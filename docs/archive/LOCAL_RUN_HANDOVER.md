# Auraxis — frozen local prototype handover

Status as of 15 October 2026 (IST): current website changes are frozen. Do not add features, redesign, tune analytics or change market data as part of this handover. This file is the current consolidated run guide; older phase-specific README descriptions may describe superseded defaults.

**Public deployment: PENDING / NOT PERFORMED.** No public frontend or backend URL exists in this handover. Localhost addresses below are accessible on the local machine only. A successful production build and local Vite preview do not establish public accessibility or production verification.

## Start locally with PowerShell

Existing dependencies and `backend/.venv` are assumed installed. Use separate terminals for backend and frontend. Reuse services already listening; do not launch duplicate servers or type commands into an occupied Vite terminal.

Check the ports first:

```powershell
Get-NetTCPConnection -LocalPort 8010,5173,5180 -State Listen -ErrorAction SilentlyContinue
```

Backend, terminal 1:

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

This uses the existing interpreter directly; virtual-environment activation and execution-policy changes are unnecessary. Backend settings come from `backend/.env` and environment variables; restart the backend if settings change. The default database is the existing backend SQLite database. Allowed frontend origins are `http://localhost:5173` and `http://localhost:5180`; retain those in `CORS_ORIGINS` if overriding settings.

Built frontend preview, terminal 2, when no preview is already running:

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
$env:VITE_API_BASE_URL = 'http://localhost:8010'
npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Open **http://localhost:5173/**. This is a local production-build preview, not a public deployment or production server. `VITE_API_BASE_URL` is embedded at build time; changing it requires rebuilding. The command above does not overwrite existing environment files.

Optional development server, in another free terminal instead of using it as the demo preview:

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
$env:VITE_API_BASE_URL = 'http://localhost:8010'
npm run dev -- --host localhost --port 5180 --strictPort
```

Open http://localhost:5180/. Run only the frontend mode you need; existing dev and preview services can be reused if both are already running. Stop an owned foreground service with Ctrl+C in its own terminal. Do not terminate unrelated processes.

Check health from a free terminal:

```powershell
Invoke-RestMethod 'http://localhost:8010/health'
```

Expected: `status` is `ok`, `app` is `Auraxis`.

## Current behavior and evidence

Later requested addition: `/login` now supports real local signup/login/logout
and cookie-session restoration. See [LOGIN_UI.md](LOGIN_UI.md). Accounts use a
separate ignored auth database; existing public historical research/demo access
remains available. Earlier audit counts describe their recorded stage.

- Seven routes: `/`, `/app`, `/app/relative-value`, `/app/term-structure`, `/app/backtest`, `/app/data-health`, `/app/methodology`.
- Purity adjustment defaults OFF; enabled scenarios are explicitly experimental. The purple gradient and translucent dark panels remain across pages. Latest explicit appearance preference: retain the Landing purple gradient, animated stars and translucent panels on ALL pages. Do not remove dashboard stars based on older audit checklists. Reduced-motion support remains in place.
- Latest label fixes were checked in actual Chrome at desktop 1440×1000 and mobile emulation 390×844. Missing results remain unavailable; percentage suffixes appear only on finite numeric values. Technical Term Structure fields remain in expandable sections.
- Local browser checks covered purity/matching, applied-versus-draft Backtest settings, Run simulation and sizing changes. An actual backend-stop client test verified exact supported snapshot fallback and rejection of unsupported offline settings; backend health was restored afterward. Browser-only fault injection separately checked missing comparison handling.
- Latest frontend typecheck, lint and production build passed. Earlier complete suites passed 173 backend and 54 frontend tests; these are recorded results, not newly rerun freeze checks.
- Latest audit/evidence: [FINAL_LOCAL_READINESS.md](FINAL_LOCAL_READINESS.md) and `docs/evidence/final-local-audit/`. Earlier label evidence: `docs/evidence/2026-10-15-browser/ui-label-fixes/`. Detailed chronology: `docs/PRIORITY_FIXES_2026-10-15.md`. Older screenshots describe earlier states and must not be taken as current UI evidence.

## Remaining known limitations

1. **Historical, not live:** dataset window is 14 September–1 October 2026, 14 sessions; data_as_of is 1 October 2026. API availability does not mean live quotes. No short-sample profitability or convergence claim is established.
2. **Comparison basis remains provisional:** delivery fineness and quote/lot units do not establish full cross-contract economic equivalence. Purity adjustment is experimental and OFF by default. Full contract-spec/comparison verification is incomplete; delivery locations and other contract differences matter.
3. **Maturity matching is analytics only:** GOLDM comparisons can interpolate across other expiries. Synthetic marks are not executable prices, matched contracts or guaranteed opportunities. Missing brackets/comparisons remain unavailable.
4. **Simulation assumptions:** settlement-based next-session execution, configured costs and sizing are modeling assumptions. Fractional sizing is idealized; integer lots round down. Neither models complete live execution, market impact, exchange margin or all real trading constraints. Applied results belong to the last submitted settings, not edited draft controls.
5. **P&L categories differ:** realized and marked P&L are distinct. Open, unresolved and stale/unavailable marks remain visible; marked outcomes are not final realized performance. No portfolio aggregation, guaranteed arbitrage or proof of profitability is implied.
6. **Offline coverage is exact and limited:** only exported parameter combinations are supported. Unmatched custom settings are unavailable offline. HTTP errors and malformed responses remain errors; transport failure is what permits exact snapshot fallback. Snapshots do not update themselves.
7. **Data-health coverage is incomplete:** some validation details were not persisted. Unavailable checks are not zero issues; truncated diagnostic lists are not complete datasets. The recorded rejected-file entry and retained zero-volume observation remain honest historical records.
8. **Browser coverage is bounded:** mobile checks used Chrome device emulation, not physical devices. Dense tables require contained scrolling. Not every device, browser, tooltip, accessibility path or parameter combination was inspected.
9. **Public deployment remains pending:** no deployed HTTPS origin, public API/CORS connection, public direct-refresh routing, incognito public checks, production security/load/operations validation or public availability has been verified. Do not describe this prototype as publicly accessible or production-verified.

The original freeze handover changed documentation only. Subsequent narrow accessibility/checklist fixes are recorded in [FINAL_LOCAL_READINESS.md](FINAL_LOCAL_READINESS.md). Data, snapshots, formulas and thresholds remain unchanged. Public deployment is pending and outside the local audit.

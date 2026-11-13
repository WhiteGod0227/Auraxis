# Phase 1: comparison explanations and calculation provenance

Scope confirmed by the owner: Explain This Comparison and Calculation Breakdown,
plus integration/authentication regression checks. Data Coverage, Saved Research
and Profile are later phases and were not implemented here.

## How to use

Open `/app/relative-value`, select a pair and A expiry, then expand:

- **Explain this comparison**: actual contracts/date, normalized settlement gap,
  applied purity/maturity settings, liquidity/source flags, statistical meaning
  and reasons for unavailable readings. It never equates a lower settlement
  with undervaluation or a trade instruction.
- **View calculation**: raw settlement observations, original quote quantities,
  unit/purity factors, actual B component expiries, calendar-day differences,
  backend interpolation weights and the preceding finite-observation count.
  Formula descriptions accompany existing backend results, not a second frontend
  calculation engine. Expand technical details for unrounded values/raw codes.

Both sections use the latest validated response for the current selection.
Loading/error/empty states cannot show a previous explanation. Opposite maturity
mode comparisons must match pair, A expiry, observation, A normalized price,
data-as-of and source; offline generations must match too. Failed or mismatched
counterparts remain unavailable. Original quality/eligibility is never overridden.

Relative Value's pair/window/purity/maturity/preferred-expiry state is owned by
the existing dashboard layout. Navigation between dashboard pages retains it;
full reload or leaving the layout starts a fresh session of UI selections.
No persisted workspace or personal research storage is implied.

## Backend changes and compatibility

`compute_spreads(..., include_calculations=True)` records provenance from the
same selected normalized rows/interpolation path and rolling loop that produce
the existing result. Default callers, including simulations, retain their old
DataFrame columns. Regression tests compare all original columns with and
without traces.

`/api/spreads` now requests this optional trace. Each row/latest reading adds
`calculation` with:

- A source and selected B sources: symbol, actual expiry/trade date, original
  close, quote grams, unit factor, configured purity/applied purity factor,
  unit-normalized/applied close and original trade/liquidity fields.
- B weights actually reached by the interpolation path. An invalid/untraded
  interpolation has no calculated weights; they are not invented afterward.
- Exact count of preceding finite percentage spreads used in that window and
  a statistical status: insufficient history, missing current spread, zero
  variance, undefined variance or available statistics.

The Pydantic model, TypeScript types and frontend validator were updated
together. Supplied malformed/non-finite traces, mismatched source identities
and response configurations are rejected. Missing/null traces are allowed for
legacy snapshots. Existing fields, formulas, defaults and eligibility are retained.

The optional addition is backward-compatible with the existing snapshot schema.
Older saved responses remain valid for explanations supported by their existing
fields. Raw inputs/history counts cannot be reconstructed from old results;
the calculation panel clearly says unavailable. They require an authorized
snapshot refresh for offline traces.

Current local snapshots were regenerated using the existing exporter, preserving
older version directories. All 44 supported response configurations remain;
separate expiry series/backtest reports and exact configuration matching remain.
Snapshot data stays Git-ignored; no public redistribution permission is asserted.

## Checks performed

- Complete backend suite: 184 passing tests, including six new provenance tests
  and the existing five isolated authentication tests.
- Frontend suite: 73 passing tests: existing 56, nine Phase 1 helper/client/render
  cases and eight actual-route initial-render cases. Route rendering is a React
  server-render test, not a browser/layout claim.
- Repository Ruff lint/format, frontend ESLint/typecheck, frontend Prettier and
  production build passed. Existing formatting-only issues in 12 frontend files
  were normalized without changing dependencies or package-lock semantics.
- Live HTTP authentication: signup 201, login/session 200, logout 204, revoked
  session 401, correct CORS and HttpOnly cookie. Only the temporary check account
  was removed afterward. This does not verify the owner's specific credentials.
- Actual frontend client calls against the running backend validated all 44
  supported configurations. Actual served snapshots matched all 44 live payloads
  exactly, including calculation traces. Snapshot checksums are verified by the
  client; unsupported custom offline settings and HTTP 422 remained errors.
- The actual explanation component rendered from live validated responses for
  each returned spread expiry group. Eight local routes returned HTTP 200;
  this additional HTTP check is not proof of interactive UI correctness.
- Market SQLite SHA-256 before/after remains
  `74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f`.
  Exporter reports unchanged database. No market data or analytics parameters
  were tuned.

Verified real observation: GOLDM-GOLDTEN, A expiry 2026-11-05, observation
2026-10-01, purity OFF: matching OFF spread -381; ON -651.5806451613025;
on-minus-off effect -270.5806451613025 Rs per 10 g. Recorded B weights
0.8064516129032258 / 0.1935483870967742; preceding count 10. These figures are
verification evidence, not hard-coded application output or trade recommendations.

Existing non-failing warnings remain: Starlette/httpx deprecation and a Windows
pytest-cache warning. No dependencies were installed to suppress these warnings.

## Reproduce (PowerShell)

From the repository root, using existing environments:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check ..
Set-Location ..\frontend
npm run typecheck
npm run lint
.\node_modules\.bin\prettier.cmd --check src tests scripts *.json *.js *.ts *.html README.md
node --test tests/client.test.mjs tests/particles.test.mjs tests/phase1.test.mjs tests/routes.test.mjs
npm run build
node scripts/verify-phase1-integration.mjs
```

The last command requires the existing local backend on 8010, preview on 5173
and current authorized snapshots. Its fixed November/October verification sample
assumes the current local dataset; update that test selection if the dataset is
replaced. The script is an HTTP/client/component check, not browser automation.
To refresh authorized offline data, from `backend`:

```powershell
.\.venv\Scripts\python.exe -m app.export_snapshots
```

Rebuild the frontend afterward. Full fresh-clone/data instructions remain in
the root README. Do not publish raw inputs/databases/snapshots without permission.

## Browser verification still required

No controllable browser session was available on localhost:9222 during this
phase. A previous attempt to launch a debugging browser was blocked by tool
policy; no alternate launch/bypass was attempted. Desktop/mobile interactions,
screenshots, native focus behavior and navigation retention are therefore **not
claimed as browser-verified** here. They remain this focused manual checklist:

1. On desktop and mobile, open Landing, Overview, Relative Value, Term Structure,
   Backtest, Data Health, Methodology and Login. Check fit, charts and navigation.
2. Sign in on the latest build: button must say Log in, not Preview login.
   Confirm Landing/account name, refresh session and sign out. Never expose
   credentials in screenshots. Local HTTP auth checks do not replace this check.
3. Relative Value: GOLDM-GOLDTEN, A expiry 2026-11-05. Open both sections;
   toggle purity and matching. Verify applied basis/date/source and weights.
4. Change pair/expiry/window quickly. Previous explanations must disappear
   during loading/failure. Visit another dashboard page and return; selections
   should be retained and the explanation must match the refreshed result.
5. Check no-bracket/no-trade/insufficient-history observations and unavailable
   fields. Only actual numeric percentages receive a percent suffix.
6. Keyboard: Tab to each summary, Enter/Space to expand it, then reach the
   horizontally scrollable source table and retry controls. Verify focus and
   readable technical details without page-width overflow.
7. Simulate an owned backend transport outage: supported defaults must be
   Offline snapshot with real historical date/trace; custom window 11 must be
   unavailable. Restore backend and retry; confirm API source returns.

Local backend/preview are left running. No deployment, commits, pushes, external
AI service, new dependencies, workspace/profile/calendar feature or PPT work
was performed as part of Phase 1.

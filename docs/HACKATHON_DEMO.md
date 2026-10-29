# Three-minute Auraxis walkthrough

Open `/app/demo`: Landing → Take the 3-minute tour; sidebar → Guided Demo. It uses actual API results or exact local exports. Results are not chosen for profitability. Common expiry selection uses the existing date-based rule; explicit unavailable expiries are preserved.

## Presenter script

- **0:00–0:25 — Problem.** Gold futures quote different quantities and expire on different dates. A gap needs an explanation before it becomes a research finding. Intended users are students and market researchers; usefulness remains a hypothesis until feedback is collected.
- **0:25–1:00 — Compare.** Show GOLDTEN/GOLDPETAL, common expiry, observation date and prices per 10 g. Read the displayed gap. Do not call it profit or executable arbitrage.
- **1:00–1:40 — Explain.** Open Explain this comparison and View calculation. Trace raw quotes, quantities, conversion and dates. If an older snapshot lacks a trace, say so. Use the local API or regenerate authorized local exports separately.
- **1:40–2:25 — Test costs.** Read applied cost/sizing, gross marked P&L, costs and net marked P&L. Distinguish completed/open/unresolved positions. State zero completed trades directly. Unfinished positions are not realized profit.
- **2:25–3:00 — Save.** Use a disposable presenter account, save applied settings with a question as notes, open My Research and reopen. Settings are saved; results are recalculated. Close with the missing evidence.

## Rehearsal

Reuse backend and preview; do not start duplicates. Visit `http://localhost:5173/app/demo`. Follow all steps, change expiry, check consistent settings and refresh step 4. Signed-out Save returns through login to the same step/expiry. Keep credentials/screenshots private.

Authorized local snapshots support exact defaults during transport outages when present. Private saving always needs the backend. Deployment excludes snapshots and does not promise hosted offline data. A backup video may be recorded locally; none is created or published here.

## Next evidence

Private backup now available: `deployment-private/demo-backup/auraxis-demo.webm` (42 seconds, silent captions, 1280×800). Playback and seeking were verified. It contains local historical market displays and must not be published without permission. `frontend/scripts/record-demo.mjs` recreates it using a dedicated Chrome CDP session on 9223. No private account flow is fabricated in the recording.

Focused browser check: from `frontend`, run `node scripts/verify-demo.mjs` with existing local services and a dedicated Chrome CDP session on port 9223. All private auth/workspace requests are intercepted using synthetic responses, so real accounts are never mutated. Public analytics use the local API and existing authorized exports. Evidence remains ignored under `node_modules/.cache/demo-review`.

Acquire additional permitted Bhavcopy CSVs manually, retain originals privately and use the existing loader. Do not bypass the disabled downloader. Check loader/analytics/coverage before regenerating local exports. Do not invent sessions, outcomes or permissions. Contract-basis verification remains external research; purity stays off.

Use [the validation worksheet](USER_VALIDATION.md) for three to five interviews. No endorsement or measured time saving is claimed. Hosting requirements are in [deployment preparation](DEPLOYMENT.md).

## Implementation verification — 28 October 2026

- TypeScript/production build, ESLint and 115 frontend tests passed, including demo routes, login return validation and deployment privacy guards.
- Focused Chrome checks passed at 1440, 390 and 320 px: four steps, retained expiry, calculation trace, keyboard focus, no page-wide overflow, login return, Save/list/reopen, unavailable expiry, empty data, mismatched dates, HTTP 503 and recovery. No runtime exceptions recorded. Private account/workspace responses were intercepted synthetic fixtures; this does not certify real hosted cookies or persistence.
- Existing authorized local exports supported the focused offline walkthrough. No exports were regenerated or uploaded.
- Data-free deployment package check passed with 18 files and a DO NOT PUBLISH marker. No CSVs, databases or snapshots included.
- Existing backend 8010 and preview 5173 retained their original PIDs and responded successfully. Docker/Linux container execution and hosted acceptance remain unverified.

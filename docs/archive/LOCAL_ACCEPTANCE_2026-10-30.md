# Local acceptance and release handoff — 30 October 2026

This is a fresh local verification, not hosted acceptance. Public deployment remains pending. Real market exports, account databases, environment secrets and browser captures stay private.

| Requested area | Result | Evidence and boundary |
| --- | --- | --- |
| Login → Overview → comparison → curve → backtest → Saved Research → Profile → logout | PASS | Fresh Chrome run at 1440 and 390 px; real cookie authentication and saves against disposable private stores on port 8011. Public analytics read the local service on 8010. Real account settings were not edited. |
| Prices, charts and metadata | PASS | Eight public research endpoints respond successfully; 54 local snapshot files pass schema/checksum validation. Dataset remains historical, through 1 October 2026. Missing optional legacy ingestion tables produce unavailable diagnostics rather than SQL errors. |
| Compact UI and essential context | PASS, sampled | Overview reference values, dates and units checked at both widths; compact As-of label restored. Methodology and data-health routes open. This is not an exhaustive editorial or accessibility audit. |
| Desktop/mobile-width browser acceptance | PASS | 49 checks, including 16 chart tooltip checks, keyboard navigation, mobile-menu Escape/focus return, actual saves/reopen, profile persistence and logout. No runtime exceptions recorded. |
| Error, retry and offline recovery | PASS | Injected HTTP 503 remains an error; Retry recovers. Exact supported snapshots load on transport failure; unsupported settings remain unavailable. Six public routes separately pass offline and API recovery. |
| Automated regressions | PASS | Backend 247; frontend 126. Production build, ESLint and backend Ruff lint/format pass. |
| Data-free deployment package | PASS | 18 files; market CSVs, databases and snapshots excluded. Local check marker explicitly says DO NOT PUBLISH; this is not an assigned deployment. |
| Private backups | PASS | SQLite online backups for market/accounts/research pass integrity checks; restricted raw/snapshot ZIPs pass archive integrity. Kept under ignored `deployment-private/backups/release-20261030/`. Local copies are not encrypted by the backup procedure and are not off-device disaster recovery. |
| Source checkpoint/publication | Release step | Publish only the reviewed Git index after `verify_release_source.py` passes. Git history and the final handoff identify the actual commit/push outcome; no market package is published. |
| Physical phones, Firefox/Safari, screen readers | NOT TESTED | Mobile-width Chrome does not establish physical-device or cross-browser acceptance. |
| Docker/Linux startup, hosted login, TLS, persistent volumes, restart/rollback | NOT TESTED | Docker and authenticated hosting are unavailable. |
| Public market-data use | PENDING | Appropriate permission remains unresolved; no restricted data or recording may be uploaded. |

No failing application assertion was recorded in the completed fresh browser run. Backend pytest emitted the existing Starlette/httpx deprecation and a local pytest-cache write warning; neither failed the tests. Earlier dated runs and their artifacts are separate evidence.

## Repeat the local browser checks

Use a dedicated headless Chrome session with CDP on 9223, the frontend preview on 5173 and FastAPI on 8010. Start `backend/scripts/run_security_qa.py` for disposable private stores on 8011; do not substitute real account stores. Then, from `frontend`:

```powershell
$env:ACCEPTANCE_DATE='20261030'
node scripts/verify-acceptance.mjs
node scripts/verify-offline-routes.mjs
```

Artifacts are ignored under `frontend/node_modules/.cache/acceptance-20261030/`. They can contain historical displays and must stay private. Stop only verification-owned Chrome and the disposable 8011 service afterward. Preserve the normal local services.

Before a source push, stage reviewed source and run:

```powershell
backend/.venv/Scripts/python.exe backend/scripts/verify_release_source.py
git diff --cached --check
```

The scanner reads exact indexed blobs, rejects private paths and credential patterns, and prints filenames only. It is a bounded check of the index, not a complete secret or Git-history audit.

## External requirements

Provide authenticated Docker-capable hosting, accepted costs, private persistent storage, an HTTPS origin and permission covering intended market-data use. Configure secrets privately through the host. Then follow [hosted acceptance](DEPLOYMENT.md), including actual login, frontend/API routing, secure cookies, storage persistence and backup restoration. No paid resources were created and nobody was contacted.

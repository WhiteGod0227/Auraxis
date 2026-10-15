# Auraxis deployment package — Cloudflare Pages + Railway

**Status: prepared locally, NOT DEPLOYED.** Accounts/projects/billing have not been configured. No paid resource, purchase, remote upload, commit or push is authorized by this package. Public frontend URL: **not assigned**. Public API URL: **not assigned**. Public acceptance: **pending**. Local preview is not production verification.

Current app features, analytics, SQLite and exported snapshots remain frozen. Existing local preview `dist` is separate from the deployment output `frontend/dist-deploy`.

## Account setup — owner performs login/billing

1. Create/sign in to a Cloudflare account, verify email and enable MFA. Open Workers & Pages → Create application → Pages. Prefer **Direct Upload** for this package because no repository push is requested. Select the free static Pages option; do not create paid Workers resources. Choose an available project name; `frontend/wrangler.toml` currently proposes `auraxis`, which is not a reserved or assigned public URL. Change its name to match the actual project before using Wrangler later. Git-integrated Pages is an alternative only when explicitly choosing repository access; set root `frontend`, Node `24.11.0`, build command `node scripts/build-deployment.mjs`, output `dist-deploy` and the actual API origin below.
2. Create/sign in to Railway, verify email and enable MFA. Configure billing personally only when ready; no payment method or token belongs in chat, code or screenshots. Review plan, usage controls and alerts. **Stop before creating a billable service/volume until you have accepted the cost.** The proposed Hobby service/volume is not guaranteed free.
3. When ready, provide connected project/service access or authenticate a local CLI yourself. No Cloudflare/Railway CLI or Docker is currently available in this workspace; this preparation did not install any. A browser dashboard upload can publish the frontend without installing Wrangler. Backend deployment route (private repo, private image or authenticated CLI upload) must be selected then; no repository has been pushed here.

## Railway configuration after owner authorizes resources

- Source root `/backend`; Dockerfile `Dockerfile`, config-as-code path `/backend/railway.json` when using the whole repository source. If uploading only the backend directory, use `/railway.json`. Verify the resolved settings in the deployment dashboard.
- Docker image uses Python `3.14-slim`, existing pinned requirements and `app/` only. `.dockerignore` excludes credentials, SQLite, raw CSV and tests. Linux image build is **not yet verified** because Docker is unavailable locally. Python minor matches the existing local environment; base-image patch/digest is not pinned and should be recorded for the eventual release.
- Docker CMD starts one Uvicorn worker on `0.0.0.0:$PORT`, without reload. Railway supplies PORT. Do not replace this with a Windows shell command. Config specifies one replica, `/health`, a 120-second health timeout and up to three failure restarts. Choose an available region close to users; do not enable multi-region replicas/serverless sleep for the demo.
- Attach one persistent volume at `/data` only after billing authorization. This attachment is a dashboard provisioning step, **not** created by `railway.json`.
- Set backend service variables privately:

| Variable | Required value |
| --- | --- |
| `APP_NAME` | `Auraxis` |
| `DATABASE_URL` | `sqlite:////data/auraxis.db` |
| `DATA_CACHE_DIR` | `/data/data_cache` |
| `CORS_ORIGINS` | Exact assigned frontend HTTPS origin, no trailing slash; comma-separated if additional approved origins are needed |

Enable a Railway HTTPS public domain only when deploying. Record its actual URL; do not invent one. Set CORS to the actual Pages origin once assigned, then restart backend. No credentials go in frontend variables. CORS is not access control; the API is read-only but publicly reachable, and expensive custom analytics may require future platform resource/rate controls.

### Private SQLite provisioning

The database is intentionally absent from the image and Git. Before declaring the deployment usable, prepare a consistent SQLite backup, transfer it through the chosen authenticated private administrative channel and place it at `/data/auraxis.db`. Never put it in `frontend/public`, a public download URL, a public image or a token-bearing build argument. An initial service can serve honest empty API data until this transfer is complete; `/health` confirms liveness only, **not** data readiness. If Railway SSH is used, first confirm its current upload/volume workflow; do not guess SCP support or command flags.

Prepare an ignored backup locally, without modifying the source database, using existing Python packages (PowerShell, from repo root). It refuses to overwrite an existing backup:

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
@'
import sqlite3
from pathlib import Path
from sqlalchemy.engine import make_url
from app.core.config import BACKEND_DIR, get_settings
url = make_url(get_settings().database_url)
assert url.get_backend_name() == 'sqlite' and url.database not in (None, ':memory:')
source = Path(url.database)
if not source.is_absolute():
    source = BACKEND_DIR / source
assert source.is_file(), 'Source database missing'
target = BACKEND_DIR.parent / 'deployment-private' / 'auraxis.db'
target.parent.mkdir(exist_ok=True)
assert not target.exists(), 'Backup already exists; preserve it or choose a new destination'
with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
    with sqlite3.connect(target) as dst:
        src.backup(dst)
        assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('Private backup ready; not uploaded.')
'@ | .\.venv\Scripts\python.exe -
```

After private provisioning: verify remote SQLite integrity, `bhav`/`data_health` counts, metadata dates and API responses against local data. Current expected window is 2026-09-14 through 2026-10-01, 14 sessions; as_of 2026-10-01. Back up before refreshes; retain a known-good restore point. No loader runs during server startup/build. A remote data refresh, snapshot refresh and frontend release must be coordinated; API and offline source labels/dates must remain honest.

## Frontend build and Pages publication

No new dependencies are required for the build script. On a clean build host, use `npm ci` with the existing lockfile first. Existing local dependencies can be reused. The script validates snapshots, uses the actual HTTPS API origin, and builds a separate clean output so local `dist` and old source snapshots are not removed.

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
$env:VITE_API_BASE_URL = Read-Host 'Paste the actual assigned HTTPS API origin'
node scripts/build-deployment.mjs
```

Do not publish if this fails. `VITE_API_BASE_URL` is public build-time configuration, not a secret. This build guard rejects absent origins, localhost, credentials/query/path and reserved example domains; it does not prove that the supplied origin resolves or hosts the API. Actual public checks remain required.

For package verification **before accounts exist**, this command deliberately uses a reserved, nonfunctional API address and writes `DEPLOYMENT_NOT_CONFIGURED.txt`:

```powershell
node scripts/build-deployment.mjs --local-check
```

**Never publish this local-check build.** Once an actual API domain exists, run the normal build command again; the clean output removes the marker. For dashboard Direct Upload, upload the **contents of `frontend/dist-deploy`** or a zip with `index.html` at its root, not the repository. Do not include `.env`, backend, raw CSV, SQLite or evidence screenshots.

Cloudflare-specific files copied into output:
- `_redirects`: `/app` and `/app/*` → `/index.html` with200, preserving direct page refresh.
- `404.html`: disables implicit catch-all SPA handling for missing assets/snapshot files; a missing JSON file should remain404 rather than return app HTML.
- `_headers`: revalidate normal files, no-store manifest, immutable hashed assets/versioned snapshots, nosniff and referrer policy.
- `wrangler.toml`: optional future CLI config; project creation/account login/billing are not performed by this file.

Only the manifest-referenced snapshots are validated, but existing version directories are preserved. Review total file count/size against the selected host's limits before upload. Keep previous release assets/version directories during rollback planning so cached tabs/old manifests do not lose their files. No CSP is imposed without checking the actual API origin and existing styles/scripts.

## Public acceptance — pending until real URLs exist

Record actual frontend/API origins, deployed revision/artifact and data generation. Check all seven routes in an incognito browser, desktop/mobile, direct refresh, TLS and missing-file404. Confirm real API requests/CORS, purity OFF default and experimental ON labels, matching results, Backtest applied/draft state and sizing. Verify metadata matches the seeded database, all served snapshot checksums and manifest cache headers.

Temporarily stop **only the deployed owned backend** or use browser-only transport fault injection: supported defaults must be Offline snapshot; custom settings without an exact snapshot must show unavailable. Restore backend and verify recovery. HTTP422/500/malformed responses must remain errors. Check missing data, unknown routes, invalid parameters and absence of old output presented as latest. Inspect logs for safe errors, verify volume data across restart/redeploy, and test backup restore. Health200 alone is insufficient.

Existing historical/short-sample, unverified purity, synthetic maturity matching, settlement fills, fractional/integer sizing, open/unresolved/stale outcomes and limited offline coverage remain limitations. No production-readiness/public-access claim until the actual deployed service passes its recorded acceptance checks.

## Current blockers and references

Accounts/projects, owner-configured billing, authorized access, actual domains, private database transfer and Linux container build remain outstanding. No public acceptance tests have run. These are deployment blockers, not fabricated service URLs or observed remote failures.

Local verification completed:
- Separate clean TypeScript/Vite deployment build passed; ESLint passed after excluding generated `dist-deploy` output (source lint rules unchanged).
- 44 manifest-referenced snapshot files passed JSON parsing, byte-size and SHA-256 checks before and after packaging.
- Railway JSON and Wrangler TOML parsed; configured Railway keys were checked against the official current schema.
- Missing, localhost, reserved placeholder and credential-bearing API origins were rejected by the normal build command.
- Local-check artifact: 150 files, 9,874,540 bytes, including retained snapshot versions and an explicit DO NOT PUBLISH marker. No `.env`, SQLite or raw CSV files were present.
- Existing SQLite SHA-256 remained `74b169f31ac907bd04b03d83682f271703d5ad0fbbd41b44e0be83e1d2b9355f`. No data/snapshot regeneration, dependency installation or service restart was performed.
- Docker/Linux image installation, Cloudflare rewrite/header behavior and public connectivity are **not verified** by these local checks. They require the future build/deployment environment. No public URLs are assigned.

Followed official configuration references:
- https://docs.railway.com/config-as-code/reference
- https://docs.railway.com/builds/dockerfiles
- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/configuration/redirects/
- https://developers.cloudflare.com/pages/configuration/headers/

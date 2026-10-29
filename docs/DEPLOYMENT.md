# Deployment preparation - pending

Updated 28 October 2026. No hosting account or public API URL exists. No remote upload, publication, resource creation or billing action has been performed. Existing backend 8010 and preview 5173 remain the local workflow.

## Data boundary

Redistribution permission remains unresolved. **Do not publicly upload raw CSVs, databases or snapshots.** Do not seed a publicly reachable API with the real dataset until permission covers that use. Auth and workspace stores always remain private.

Deployment mode disables Vite's public directory. Packaging copies only `404.html`, `_redirects` and `_headers`, and rejects snapshot directories, CSVs, databases, environment files and symlinks in output. Local snapshots and normal `dist` are preserved. A fresh clone can build a data-free package without market exports.

From `frontend`, with existing dependencies:

```powershell
node scripts/build-deployment.mjs --local-check
```

This creates `dist-deploy` with `DEPLOYMENT_NOT_CONFIGURED.txt`. **Do not publish this check artifact.** After HTTPS hosting exists, rebuild with the assigned HTTPS API origin or the explicit same-origin option:

```powershell
$env:VITE_API_BASE_URL = 'same-origin'
node scripts/build-deployment.mjs
```

`same-origin` sends `/api/...` to the frontend origin. A static host alone cannot handle this: configure a reverse proxy to FastAPI. Builds check format, not reachability. Vite variables are public, never secrets.

## Prepared full-stack topology

`deploy/compose.yaml` defines FastAPI, private persistent storage and an Nginx frontend/API proxy. The frontend image excludes market data. Sharing one origin avoids cross-site session cookie restrictions. **Container execution is unverified: Docker is not installed here.**

Required infrastructure: Docker-capable Linux hosting, persistent disk, domain/HTTPS ingress and authenticated owner access. Compose exposes only `127.0.0.1:8080`; the host HTTPS ingress must forward to it. FastAPI stays internal. Do not publish plain HTTP with production cookies.

When infrastructure exists, copy `deploy/.env.example` to ignored `deploy/.env`, replace the placeholder origin, then run from repository root:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml config
docker compose --env-file deploy/.env -f deploy/compose.yaml up --build -d
```

These commands have not been run. Review costs before provisioning. Preserve the private volume during upgrades: it holds accounts and research.

## Required FastAPI variables

| Variable | Hosted setting |
| --- | --- |
| `APP_NAME` | `Auraxis` |
| `PORT` | Host-assigned; Compose uses `8000` internally |
| `DATABASE_URL` | `sqlite:////data/auraxis.db` |
| `DATA_CACHE_DIR` | `/data/data_cache` |
| `AUTH_DATABASE_PATH` | `/data/auth.sqlite3` |
| `WORKSPACE_DATABASE_PATH` | `/data/workspaces.sqlite3` |
| `AUTH_COOKIE_SECURE` | `true` with HTTPS |
| `AUTH_SESSION_HOURS` | `24` |
| `CORS_ORIGINS` | Exact frontend HTTPS origin, no trailing slash; comma-separated only for intended additional origins |

All `/data` paths require private persistent disk. Separate market/auth/workspace stores; never expose that directory through static hosting. Use one replica/worker with SQLite. An empty market database returns unavailable analytics; `/health` proves liveness only. Use disposable accounts for acceptance and verify private backups/restore.

## Railway alternative

Existing `backend/Dockerfile` and `backend/railway.json` remain available. Select backend source root, attach a private volume at `/data`, and configure every variable above. Owner authentication and accepted plan/volume costs are required before provisioning. Linux build, remote startup, memory requirements and persistence remain unverified.

Cookies use `SameSite=Lax`. A frontend on Pages/Sites and API on an unrelated Railway domain is cross-site; CORS alone does not make saves work. Prefer the supplied same-origin proxy. Split deployment needs deliberate same-site custom domains and browser acceptance. Sites cannot run this Python/FastAPI backend.

## Hosted acceptance

1. Record HTTPS URLs, revision, artifact and permitted data source/window.
2. Build Linux images; verify health, logs, restart and persistent disk.
3. Verify direct refresh of `/app/demo?step=4`, other routes, missing asset/JSON 404s, and absence of publicly served market files.
4. With permitted or explicitly synthetic data, verify schemas, dates and arithmetic. Empty data must stay unavailable.
5. With disposable accounts, test login/signup, demo return, profile, Save/reopen, ownership and logout over HTTPS. Inspect secure cookies and private no-store responses.
6. This release excludes snapshots; transport outages show unavailable unless approved snapshots are deliberately added later. HTTP errors must remain errors.
7. Complete browser/mobile, TLS, backup restore and rollback checks before claiming public acceptance.

## Exact outstanding requirements

- Owner-created hosting account, authenticated locally or via an approved connector. No credentials in chat.
- Selected plan, accepted costs and persistent disk.
- Assigned HTTPS domain/ingress and proxy routing.
- Docker-capable build environment for container checks.
- Permission covering intended market-data use, or an explicitly synthetic dataset approved for demonstration. Until then no real data is packaged or uploaded.

These requirements do not prevent the local walkthrough from using existing authorized local data.

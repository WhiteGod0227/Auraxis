# Phase 3: Saved Research Workspace

Date: 22 October 2026 (IST). Scope: authenticated saved configurations and
plain-text notes only. My Profile is not implemented. Existing Phase 1/2 dirty
work is preserved. No analytics formulas, simulation defaults, dependencies,
market rows, public snapshots, PPT files, commits or deployment were changed.

## Routes and files

New UI route: `/app/research` (My Research), visible in signed-in navigation and
the account menu. Save research is connected on Relative Value, Term Structure
and Backtest. Existing normal login still returns to Landing; a workspace
sign-in link can return to an allowlisted internal research route. External or
unknown return destinations fall back to Landing.

New backend files: `app/api/workspaces.py`, `app/api/workspace_schemas.py`,
`tests/test_workspaces.py`, `scripts/verify_workspaces.py`.
Updated: `app/core/config.py`, `.env.example`, `app/api/auth.py`, `app/main.py`
and backend README. Authentication extracts the existing session lookup into
`current_user`; `/api/auth/me` retains its response and behavior.

New frontend files: `components/SaveResearch.tsx`,
`components/WorkspaceBoundary.tsx`, `pages/ResearchPage.tsx`,
`lib/workspaces.ts`, `lib/workspaceContext.ts`, `lib/sessionStore.ts`,
`lib/useAccount.ts`, `tests/workspaces.test.mjs`.
Updated: `App.tsx`, `layouts/AppLayout.tsx`, `components/AccountMenu.tsx`,
`pages/LoginPage.tsx`, the three analytics pages, `lib/auth.ts`, `lib/types.ts`,
targeted workspace styles, `tests/routes.test.mjs`, root/frontend README.

## Storage and API

`WORKSPACE_DATABASE_PATH=./workspaces.sqlite3` (default) resolves relative to
backend. Lazy additive `CREATE TABLE IF NOT EXISTS` follows the existing auth
store convention. No separate migration framework is installed. Workspace
storage is separate from auth/market files. Paths equal to either database or
under frontend/public are refused. The existing SQLite ignore patterns cover
the file, journals and WAL sidecars. The Docker image copies source only.

All endpoints require a valid existing HttpOnly cookie session. Ownership is
derived server-side; owner/timestamp/id fields in create/update inputs are
rejected. Origin must exactly match configured CORS origins for mutations.
Missing and other-owner IDs both return identical 404 responses. Requests have
private/no-store cache controls (including errors), and notes are not logged.
Validation errors do not echo submitted fields or values. Unexpected errors do
not expose private paths, SQL or stack traces.

| Method / path                            | Request / behavior                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| POST `/api/workspaces`                   | Create; 201 with server UUID, owner, timestamps and revision 1.             |
| GET `/api/workspaces?limit=20&offset=0`  | Owner-scoped list. Limit 1–50, offset 0–10000. Includes total/limit/offset. |
| GET `/api/workspaces/{id}`               | Owner-scoped read. UUID IDs required.                                       |
| PATCH `/api/workspaces/{id}`             | `revision`, `title`, `notes`; only metadata changes.                        |
| DELETE `/api/workspaces/{id}?revision=1` | Required revision; success 204.                                             |

Title: 1–120 characters, nonblank and stored trimmed. Notes: optional on create,
default empty string, max 5000 characters; plain text, not HTML/Markdown. UI uses
React text rendering and textareas, not raw HTML insertion. Pagination order is
`updated_at DESC, id ASC`; paging through concurrently edited data is not a
frozen list. Lists can be reloaded. Edits/deletion use an atomic write transaction
and revision check; a stale tab gets 409 and must explicitly reload before
retrying. Read errors for incompatible saved versions are actionable 409s;
no untested automatic migration occurs. Configurations themselves are immutable:
open, change settings, then save a new workspace to create another configuration.

Example create body (send from an authenticated session, with allowed Origin):

```json
{
  "title": "October comparison",
  "notes": "Personal research notes",
  "configuration_version": 1,
  "configuration": {
    "kind": "relative_value",
    "query": {
      "pair": "GOLDM-GOLDTEN",
      "expiry": null,
      "start": null,
      "end": null,
      "window": 10,
      "min_periods": 5,
      "carry_adjusted": false,
      "purity": false,
      "min_volume_grams": 2000,
      "min_oi_grams": 0
    },
    "expiry": { "mode": "explicit", "value": "2026-11-05" }
  },
  "saved_context": { "data_as_of": "2026-10-01", "source": "API" }
}
```

Version 1 requires a complete supported per-page parameter set; malformed,
unknown or incompatible settings and extra fields are rejected. Rolling windows
are bounded to 1–1000, minimum periods cannot exceed window; holding sessions
1–10000, expiry buffer 0–10000. Floats must be finite and nonnegative where
applicable; notional and entry threshold positive, exit below entry. Sizing must
be `fractional` or `integer_lots`. These are storage validation bounds; analytic
formulas and endpoint defaults were not changed. Numeric zero, boolean false and
null filters survive round trips.

## Applied settings and reopen behavior

- Relative Value stores the validated response's full spreads request: pair,
  expiry/start/end filters, window/minimum periods, matching, purity and both
  liquidity thresholds, plus displayed expiry selection mode.
- Term Structure stores separate curve and roll-down requests: product/purity,
  curve date (null means latest), roll-down expiry/start/end, and independent
  curve-contract/roll-down selection modes. Saving requires both loaded results
  with matching data_as_of/source, rather than inventing one mixed-source context.
- Backtest stores all response-applied settings, including rolling parameters,
  entry/exit thresholds, holding/buffer, both liquidity thresholds, notional,
  costs, actual sizing mode, purity, requested report filter and selected expiry
  mode. Draft changes are explicitly excluded and a notice explains that.

Save is disabled without a valid selected loaded result, during a replacement
request, or while saving. Synchronous submission guards prevent double clicks;
failed saves never show success. The public response client continues validating
requests/responses. No analytics calculations are duplicated in the workspace.

Reopen uses `?workspace=<id>`, retrieves private configuration first, validates
version/parameters, then mounts the correct page with those settings. No default
analytics request is displayed as the saved configuration while retrieval is
pending. Exact date/expiry queries and selections remain exact; missing selections
show unavailable rather than another contract. Local selectors allow an explicit
new choice. Default expiry mode remains `latest` with null value until a contract
is explicitly selected/preserved. This means the page's existing nearest eligible
selection relative to historical data_as_of (three-day buffer), not an invented
continuous series. Curve `date: null` remains latest mode, not the saved as-of date.

Opened pages display saved versus current data_as_of/source and state that results
are reloaded/recalculated, not frozen. Historical context is informational only;
it is never a credential or fetch URL. No market responses, images, trades or
session tokens are stored in workspaces.

## Private lifecycle and offline behavior

Private CRUD uses credentialed fetch with `cache: no-store`, a timeout and no
snapshot fallback. Lists, notes and retrieved configurations remain in memory;
none are written to localStorage, sessionStorage, service-worker/public caches
or snapshots. Session/account identity changes increment an in-memory epoch,
unmount private forms/lists/restored pages and discard old in-flight responses,
including responses whose JSON body finishes after the change. Logout/401 clears
state immediately; session is rechecked on focus and every 60 seconds. Same-origin
tabs receive an identity-change notification through BroadcastChannel without
notes, credentials or user data. Public analytics need no account.

After successful private retrieval, analytics can use the existing exact verified
offline configuration with an honest Offline snapshot label. Unsupported custom
settings, including unavailable integer-lot snapshots, remain unavailable.
Refresh while backend is offline cannot retrieve a private workspace. Saving a
configuration from an offline analytic response still requires backend access.
An explicitly chosen analytic default recovery button is a user action, not a
silent substitution on workspace restore.

## Backup and operational limits

Keep workspace/auth storage private, outside public assets, Git and image build
contents. Files are not encrypted at rest by this phase; protect filesystem
access and backups. Back up auth and workspace databases together using SQLite's
backup mechanism during a coordinated no-write window, or stop writes and copy
closed databases. Never copy only the main file during active WAL transactions.
Owner IDs reference the auth store: replacing/resetting auth independently can
break ownership mapping. Do not restore one user's private store under another
auth database. Persistent hosting volumes, HTTPS cookie/CORS validation and
public acceptance remain deployment work; nothing was deployed here.

No sharing, result archiving, account deletion, quotas, profile editing, research
recommendations or automatic schema migration is added. A malformed/incompatible
stored record produces an actionable error; repair/migration requires an explicit
future versioned operation, not guessing. Existing historical-data, experimental
purity, maturity/liquidity, settlement-fill and short-sample limitations remain.

## Verification

Commands from backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check ..
.\.venv\Scripts\python.exe scripts/verify_workspaces.py
```

Commands from frontend:

```powershell
node --test tests/client.test.mjs tests/particles.test.mjs tests/phase1.test.mjs tests/routes.test.mjs tests/coverage.test.mjs tests/workspaces.test.mjs
npm run typecheck
npm run lint
.\node_modules\.bin\prettier.cmd --check src tests scripts *.json *.js *.ts *.html README.md
npm run build
```

Final automated results: **211 backend tests and 95 frontend tests passed**.
Repository Ruff check and Ruff formatting passed; frontend typecheck, ESLint,
Prettier and production build passed. `git diff --check` passed. Existing
non-fatal Starlette/httpx deprecation and Windows pytest-cache warnings remain;
no dependency changes were made to suppress them. Test coverage includes
all three per-page configurations, false/zero/null, latest/explicit dates,
integer sizing, auth, two owners, spoofing, CRUD, deterministic pagination,
revision conflicts, validation, private errors, applied-vs-draft settings,
pending/failed saves, duplicate submissions, stale private responses, session
clearing, unsafe return URLs, plain-text rendering, unavailable expiry selection
and prior public analytics/offline/calendar/explanation/navigation regressions.

The HTTP verifier starts its own temporary local server on an OS-assigned port,
uses two disposable accounts and private stores, exercises actual public analytic
responses and private CRUD, then stops only that server and removes temporary
accounts/storage. It verifies byte hashes of existing market/auth databases and
the unchanged snapshot manifest, and validates every referenced snapshot schema
and checksum. It does not add accounts to the user's existing auth store.

Browser acceptance is **NOT TESTED**: no browser-control tool or existing
debugging session was available. HTTP and server rendering do not establish the
reported login-button browser flow, visual fit, focus behavior or mobile layout.
Manual checklist at `http://localhost:5173`:

1. Disposable signup/login → Landing/account menu; public pages still work.
2. Save each loaded research type; verify explicit/latest choices, notes,
   source/as-of and applied Backtest sizing/costs. Edit a draft without Run and
   verify saved settings still match the displayed run.
3. My Research → reopen each, edit title/notes, cancel/confirm named deletion.
4. Two tabs edit the same revision; stale update/delete must request reload.
5. Change controls while loading, double-submit and test backend unavailability;
   no stale or failed success. Missing explicit selection must stay unavailable.
6. Logout/session expiry/another-account login clears private views and notes.
7. Desktop/mobile and keyboard: labels, focus, buttons, expanding details,
   horizontal charts/tables; check Landing, Overview, Relative Value, Term
   Structure, Backtest, Data Health, Methodology, Calendar and authentication.

Public deployment/acceptance remains pending. No public production claim is made.

## Actual local acceptance and handover

- PASS: real local HTTP verifier, all three applied configuration types, two
  disposable accounts, CRUD, ownership denial, conflicts, cache controls and
  logout. The verifier's owned temporary server/storage were cleaned up.
- PASS: 54 existing snapshot response schemas/checksums and manifest verified
  unchanged; workspaces absent from the public export registry.
- PASS: existing market/auth database byte hashes unchanged. Main auth records
  and sessions were not used for disposable tests or changed by them.
- PASS: existing Phase 1 and Coverage integration scripts: actual API → client
  validation → explanation/calendar server rendering, exact served-offline
  equality, invalid requests and unsupported offline cases. Coverage verified
  10 exact configurations. These are not browser interaction tests.
- PASS: production build refreshed; existing preview reused at
  `http://localhost:5173`. HTTP route availability alone is not a visual check.
- PASS after the user's restart: main backend `http://localhost:8010/health`
  returned `status: ok`; OpenAPI includes workspace create/list/read/update/delete
  routes. Actual guest list/read requests return 401 with `private, no-store`.
  Public metadata remains accessible without authentication. No main-store
  accounts were added for this verification.
- PASS after restart: the preview's My Research route serves the current on-disk
  production bundle, containing the workspace client and navigation. The isolated
  real HTTP verifier and both existing integration scripts passed again against
  the available local services. The restart blocker is resolved; no duplicate
  project service was started.

Normal backend startup command, from backend (reuse the running service):

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Both local services remain running; refresh the browser to load the current UI.
Browser acceptance remains NOT TESTED, and the earlier reported login-click issue
is not certified resolved by HTTP tests. No My Profile work was started.

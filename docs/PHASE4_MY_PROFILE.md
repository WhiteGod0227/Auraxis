# Phase 4: My Profile

Update, 28 October 2026: new-account UTC timestamp support is now implemented;
legacy accounts remain undated. See [current fixes and verification](BACKEND_FIXES_2026-10-28.md).
The following report is historical evidence from 22 October.

22 October 2026 (IST). Scope: own-profile display, name edit, My Research link
and existing logout. No other account features, analytics/default/data changes,
dependencies, PPT work, commits, pushes or deployment.

## Files and routes

- New UI route `/app/profile`, linked from the shared account menu on both
  Landing and dashboard layouts. Signed-out access uses the existing login flow
  with an allowlisted internal return route. Normal login still defaults to Landing.
- New frontend files: `src/pages/ProfilePage.tsx`, `src/lib/profile.ts`,
  `src/components/SignOutButton.tsx`, `tests/profile.test.mjs`.
- Updated frontend files: `src/App.tsx`, `src/components/AccountMenu.tsx`,
  `src/lib/auth.ts`, `src/lib/sessionStore.ts`, `src/lib/workspaces.ts`
  (safe return allowlist only), `src/styles/index.css` (profile text wrapping),
  `tests/routes.test.mjs`, `tests/workspaces.test.mjs` (module loading order), README.
- Backend: updated `app/api/auth.py`, `app/main.py`; new `tests/test_profile.py`;
  extended `scripts/verify_workspaces.py`. Root/backend README updated.

## API and account data

`GET /api/auth/profile` uses the existing authenticated `current_user` lookup.
Response: `{"user":{"id":1,"name":"Name","email":"name@example.test","created_at":null}}`.
Only the session's own identity is returned. `PATCH /api/auth/profile` accepts
only `{"name":"Updated name"}` and returns the confirmed profile. No client ID
or email can target another account. Extra fields, including email, IDs, roles,
password hashes and timestamps, return sanitized 422 errors. An allowed exact
Origin is required for writes; the existing cookie protection is reused.

Names are trimmed and must contain 1–100 Unicode code points after trimming.
Blank, non-string, control/surrogate, line/paragraph separator and unsafe Unicode
format-control input is rejected before trimming. ZWJ/ZWNJ are allowed for normal
joined names. The same name validation is reused for future registrations.
Normal accented, Indic, CJK and RTL names are supported. SQL uses placeholders;
only the `name` column for the session user is updated. User ID, registered email,
password hash, sessions and workspace rows are not changed.

The actual current auth schema has no account-creation timestamp. This phase
deliberately adds no migration or timestamp field to storage. Profiles return
null and the UI displays **Unavailable** with an explanation. This also applies
to future registrations under the unchanged schema. No date is inferred from
workspaces, login times or the current clock. The frontend validates timezone-
qualified ISO timestamps should a future explicitly versioned backend add them;
it never fabricates one. Adding future creation-date storage remains separate work.

401 means no valid session; 403 means Origin denied; invalid name/protected fields
return 422. Unexpected errors use the existing sanitized account-service error.
All profile responses, including errors, use private/no-store caching. Responses
never include password hashes, session tokens, SQL, private paths or stack traces.

## UI and session behavior

Profile shows name, read-only registered email and account-created availability.
Edit name has accessible labels, linked validation, pending state, Save and Cancel.
Cancel restores the current confirmed name without a request. Navigating away
discards unsaved edits, matching the existing local editing convention. Focus is
returned to Edit name after Save/Cancel. No avatar upload or unsupported account
controls are advertised, and no email-verification badge is shown.

Duplicate submissions use the existing exclusive-action guard. Success is only
shown after the server confirms the update. A failed update preserves the shared
confirmed name and editable draft; the error identifies previously loaded profile
information rather than claiming it is current. A successful update immediately
publishes the name to shared in-memory account state. A later session read and
page refresh retrieve the persisted name. A response started before a successful
name update cannot overwrite it with the older name.

My Research links to `/app/research`. The shared Sign out button calls the existing
logout endpoint and only clears the account on confirmed logout. On 401, account
switching or session revalidation failure, private profile/workspace components
are unmounted and old-account responses are rejected using the existing epoch.
Late JSON bodies and errors cannot resurrect or clear another signed-in account.
Account state is checked on focus and every 60 seconds; same-origin account
changes use the existing BroadcastChannel notification without private payloads.

No profile payload is stored in localStorage, sessionStorage, public snapshots or
shared caches. No offline profile fallback exists. A profile read outage clears
private state and shows an explicit retry/sign-in state. Public research APIs
remain public. Existing snapshot schemas and analytic calculations are unchanged.

## Verification commands

From backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check ..
.\.venv\Scripts\python.exe scripts/verify_workspaces.py
```

From frontend:

```powershell
node --test tests/client.test.mjs tests/particles.test.mjs tests/phase1.test.mjs tests/routes.test.mjs tests/coverage.test.mjs tests/workspaces.test.mjs tests/profile.test.mjs
npm run typecheck
npm run lint
.\node_modules\.bin\prettier.cmd --check src tests scripts *.json *.js *.ts *.html README.md
npm run build
```

The HTTP verifier creates its own temporary local server and disposable auth/
workspace storage. It exercises real signup/login, profile retrieval, Unicode name
update, session read with the new name, unchanged session cookie/workspaces,
other-user isolation and logout. Temporary accounts/storage are removed. The
user's real profile is not edited. It validates all 54 existing public snapshot
schemas/checksums and confirms no private endpoint is exported. Separate hash
checks cover the real market/auth/workspace files, including any existing records.

Automated results and current-service verification are recorded below. Existing
Starlette/httpx deprecation and Windows pytest-cache warnings are non-fatal;
no dependencies were changed to suppress them.

## Browser acceptance and remaining limits

**NOT TESTED:** browser login clicks, Save/Cancel interactions, desktop/mobile
layout, native focus and cross-page navigation. No browser-control tool or
existing debugging session was available. HTTP and server-rendering tests are not
browser interaction evidence; prior phases' browser acceptance remains pending.

Use the single controlled manual acceptance procedure below. It uses separate
ports, a private browser window and disposable private storage; it does not
require restarting the user's backend or changing the existing preview.

No email changes, password recovery/changes, MFA, verification, avatar uploads or
account deletion are implemented. Creation timestamps remain unavailable because
the store never recorded them. Public deployment remains pending; no public
production-verification claim is made. Stop after Phase 4.

## 1. Features implemented

- Own-profile route, protected GET/PATCH, read-only registered email and honest
  creation-date Unavailable state.
- Unicode name Edit/Save/Cancel, field-linked validation, pending/error/success
  handling and duplicate-submit protection.
- Shared name refresh, My Research link, shared logout action, safe return
  navigation, session-expiry/account-change clearing and stale-response rejection.
- Private/no-store requests with no offline profile fallback. No unrelated
  account features or analytics changes.

## 2. Checks actually passed

- PASS: full backend suite **234 tests**; repository Ruff check and formatting.
- PASS: full frontend suite **105 tests**, typecheck, ESLint, Prettier and
  production build. Includes name-edit state transitions (Cancel/failure/pending),
  shared-name update, response races, session expiry, safe return navigation,
  profile/account-menu server rendering and all prior regression tests.
- PASS: current actual isolated HTTP run on OS-selected port **64081**, PID
  **47596**, with disposable auth/workspace files and test-only loopback cookie/
  Origin settings. No service was started on 8010. Signup/login → profile → Unicode name update →
  session reflects new name → logout. Session cookie and saved workspaces remain
  unchanged after the edit; a second user's profile is unchanged. The temporary
  server/accounts/storage were removed, not added to the real auth store.
  Protected-field/name validation and untrusted-Origin denial were also checked
  over HTTP. Cleanup set only the locally constructed server's exit flag and
  joined its owned thread; no process was found/stopped by name or listening port.
- PASS: real market/auth/workspace files retain their phase-start byte hashes.
  The actual auth `users` schema was inspected read-only: only id, name, email and
  password_hash exist. No migration/backfill or real-user edit was performed.
- PASS: all 54 existing public snapshot schemas/checksums; private profile and
  workspace endpoints remain absent from the export registry. No snapshots were
  regenerated or modified.
- PASS: existing production preview on port 5173 reused and rebuilt; current
  profile route availability/current bundle verified without starting another preview.
- PASS: `git diff --check`. No commits, pushes, deployment or dependencies added.

## 3. Checks blocked / not tested

- Browser desktop/mobile layout, native keyboard focus and real browser
  login/name-edit/Cancel/refresh/logout/workspace navigation: **NOT TESTED**.
  Browser controls and an existing debugging session were unavailable. This
  includes earlier phases' pending browser acceptance; SSR is not a substitute.
- The user's main backend on 8010 was not started, stopped, reconfigured or used
  for mutable tests. Its long-running stability is **NOT VERIFIED**. Main-service
  acceptance was intentionally excluded by the current verification scope.
- Prior attempts to start the main backend were tool-policy blocked. The current
  isolated verifier startup **was allowed and passed**; isolated HTTP checks are
  therefore not blocked or merely inferred from older evidence. No policy bypass
  or alternate retry of a rejected startup was used.
- Public deployment and hosted acceptance remain pending.

## 4. Unresolved SIGINT issue

[Shutdown investigation](BACKEND_SHUTDOWN_INVESTIGATION_2026-10-22.md) records
SIGINT received by PID 36528 about 5.5 seconds after startup. The user reports
no keyboard, copy or Stop action. The signal sender remains **UNRESOLVED**;
manual user action is not assumed. Earlier PID 8616 lacks the same lifecycle
evidence. The diagnostic traceback was cleaned up, but unexpected shutdown is
not claimed fixed. Isolated API test success does not prove its resolution.

## One controlled manual acceptance procedure

This is an optional single acceptance session, not another request to restart
the existing backend. Use two **new, clearly named test terminals**, separate
ports 8011/5181 and a new InPrivate/incognito browser window. The private window
keeps test cookies separate from the user's normal login. If either port is in
use, stop this procedure; do not terminate its owner. Existing backend/preview
processes stay untouched. No installs or production build changes are needed.

Test terminal A, PowerShell:

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
if (Get-NetTCPConnection -State Listen -LocalPort 8011 -ErrorAction SilentlyContinue) {
    throw 'Test port 8011 is occupied; leave its owner untouched.'
}
$profileCheckDir = Join-Path ([System.IO.Path]::GetTempPath()) ('auraxis-profile-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileCheckDir | Out-Null
$env:AUTH_DATABASE_PATH = Join-Path $profileCheckDir 'auth.sqlite3'
$env:WORKSPACE_DATABASE_PATH = Join-Path $profileCheckDir 'workspaces.sqlite3'
$env:AUTH_COOKIE_SECURE = 'false'
$env:CORS_ORIGINS = 'http://localhost:5181'
.\.venv\Scripts\python.exe scripts/run_local_backend.py --port 8011
```

Only the new private files receive account/workspace writes. Existing market
data is read through the API's query-only database path. Environment overrides
are confined to this new terminal; `.env` is not edited.

Test terminal B, PowerShell:

```powershell
Set-Location 'C:\Desktop\Auraxis\frontend'
if (Get-NetTCPConnection -State Listen -LocalPort 5181 -ErrorAction SilentlyContinue) {
    throw 'Test port 5181 is occupied; leave its owner untouched.'
}
$env:VITE_API_BASE_URL = 'http://localhost:8011'
npm run dev -- --host localhost --port 5181 --strictPort
```

In the private browser window, open `http://localhost:5181` and follow once:

1. Create a disposable account with non-personal test details. Sign out and log
   in again. Landing and dashboard menus should both link to My Profile.
2. Profile: email read-only, creation date Unavailable. Edit a Unicode name,
   Cancel, then edit/Save. Name must update in both menus and persist on refresh.
   Blank/control/overlong input must fail; repeated Save must not duplicate work.
3. My Research: save/reopen a loaded comparison and verify its selections. Check
   Relative Value explanation/calculation, Calendar and Backtest. Historical,
   unverified-purity and simulation limitations must remain visible.
4. Check mobile viewport, long text, keyboard Tab/focus and Save/Cancel controls.
   Sign out; direct profile/research routes must require sign-in and show no
   earlier private information. Log back into the disposable account.
5. To check outage and finish, press Ctrl+C **only in test terminal A**. Refresh
   the test Profile page: show a backend error/retry state, no offline profile or
   falsely current private details. Stop only test terminal B, close the private
   window and the two test terminals. Existing services remain untouched. Retain
   only the identified temporary test folder if evidence review is needed; never
   upload it. Closing these terminals discards their environment overrides.

If the isolated backend exits unexpectedly before step 5, stop the acceptance
session and inspect the matching run in `backend/logs/backend_lifecycle.jsonl`.
Do not repeatedly restart it or mark the SIGINT issue resolved. Record each
browser check as PASS/FAIL/NOT TESTED with the exact action and visible outcome.
